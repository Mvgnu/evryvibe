import { instagramMediaId } from "../core/media";
import { z } from "zod";
import type { Page } from "playwright";
import { join } from "node:path";
import { instagramSourceSchema, type PostPackage } from "../core/model";
import { downloadImage, recognizeImage, validateMediaUrl } from "./media";
import {
  checkInstagramResponse,
  DailyRestError,
  InstagramAccessError,
} from "./pacing";
import { activeVideoLocators, sampleVideoFrames } from "./video";
const itemSchema = z.object({
  pk: z.string().regex(/^\d+$/),
  media_type: z.union([z.literal(1), z.literal(2)]),
  image_versions2: z.object({
    candidates: z
      .array(
        z.object({ url: z.string(), width: z.number(), height: z.number() }),
      )
      .min(1),
  }),
  caption: z.object({ text: z.string() }).nullish(),
  accessibility_caption: z.string().nullish(),
  expiring_at: z.number().nullish(),
  story_link_stickers: z.unknown().optional(),
  story_cta: z.unknown().optional(),
  story_bloks_stickers: z.unknown().optional(),
  story_feed_media: z.unknown().optional(),
});
const candidateSchema = z
  .object({ pk: z.string().regex(/^\d+$/) })
  .passthrough();
const reelSchema = z.object({
  user: z.object({ username: z.string() }),
  items: z.array(candidateSchema),
});
export type StoryItem = z.infer<typeof itemSchema>;
export function storyInventory(
  documents: unknown[],
  accountUrl: string,
): z.infer<typeof candidateSchema>[] | null {
  const handle = new URL(accountUrl).pathname.replaceAll("/", "").toLowerCase();
  const stack = [...documents];
  const found = new Map<string, z.infer<typeof candidateSchema>>();
  let matched = false;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const record = z.record(z.string(), z.unknown()).safeParse(node);
    if (record.success) {
      const user = z
        .object({ username: z.string() })
        .safeParse(record.data.user);
      if (
        user.success &&
        user.data.username.toLowerCase() === handle &&
        Array.isArray(record.data.items)
      ) {
        // A malformed item fails this source instead of silently reducing coverage.
        const reel = reelSchema.parse(node);
        matched = true;
        for (const item of reel.items)
          if (
            typeof item.expiring_at !== "number" ||
            item.expiring_at > Date.now() / 1000
          )
            found.set(item.pk, item);
      }
    }
    for (const child of Object.values(node))
      if (child && typeof child === "object") stack.push(child);
  }
  return matched ? [...found.values()] : null;
}
export async function embeddedDocuments(page: Page): Promise<unknown[]> {
  const texts = await page
    .locator('script[type="application/json"]')
    .allTextContents();
  return texts.flatMap((text) => {
    try {
      const value: unknown = JSON.parse(text);
      return [value];
    } catch {
      return [];
    }
  });
}
export function storyCaption(item: StoryItem): string {
  const lines = [item.caption?.text, item.accessibility_caption].filter(
    (text): text is string => !!text,
  );
  const stack: unknown[] = [
    item.story_link_stickers,
    item.story_cta,
    item.story_bloks_stickers,
    item.story_feed_media,
  ];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node)) {
      if (
        typeof value === "string" &&
        ["url", "webUri", "href"].includes(key)
      ) {
        try {
          const url = new URL(value);
          const mediaHost = ["cdninstagram.com", "fbcdn.net"].some(
            (host) =>
              url.hostname === host || url.hostname.endsWith(`.${host}`),
          );
          if (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !mediaHost
          )
            lines.push(`Story link: ${url.href}`);
        } catch {}
      }
      if (
        typeof value === "string" &&
        ["text", "title", "username"].includes(key)
      )
        lines.push(`${key}: ${value}`);
      if (
        typeof value === "string" &&
        key === "media_code" &&
        /^[A-Za-z0-9_-]+$/.test(value)
      )
        lines.push(`Shared post: https://www.instagram.com/p/${value}/`);
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return [...new Set(lines)].join("\n");
}
export async function* captureStories(
  page: Page,
  accountUrl: string,
  options: {
    temporary: string;
    beforePost: () => Promise<void>;
    shouldCapture?: (url: string) => Promise<boolean>;
    checkAccess: () => Promise<void>;
    checkRestriction: () => void;
    assertActive?: () => void;
    onProgress?: (
      index: number,
      total: number,
      status: "started" | "captured" | "skipped" | "failed",
    ) => void;
  },
): AsyncGenerator<PostPackage> {
  const handle = new URL(accountUrl).pathname.replaceAll("/", "");
  options.assertActive?.();
  const response = await page.goto(
    `https://www.instagram.com/stories/${handle}/`,
    { waitUntil: "domcontentloaded", timeout: 30000 },
  );
  if (response) checkInstagramResponse(response.status());
  await options.checkAccess();
  options.checkRestriction();
  let items = storyInventory(await embeddedDocuments(page), accountUrl);
  if (items === null) {
    // Server data can arrive in a later hydration script.
    await page.waitForTimeout(1500);
    await options.checkAccess();
    items = storyInventory(await embeddedDocuments(page), accountUrl);
  }
  if (items === null) {
    const text = await page.locator("body").innerText();
    if (
      /story (is no longer|isn't|is not) available|no (active )?stories|Diese Story ist nicht mehr verfügbar/i.test(
        text,
      )
    )
      return;
    // A redirect to the exact venue profile means Instagram has no active reel.
    if (
      new URL(page.url()).pathname.replace(/\/$/, "") ===
      new URL(accountUrl).pathname.replace(/\/$/, "")
    )
      return;
    throw new Error(
      "Instagram did not supply an attributable story inventory; cannot claim full story coverage",
    );
  }
  const failures: string[] = [];
  for (const [index, candidateItem] of items.entries()) {
    options.assertActive?.();
    options.onProgress?.(index + 1, items.length, "started");
    try {
      const item = itemSchema.parse(candidateItem);
      options.checkRestriction();
      const postUrl = instagramSourceSchema.parse(
        `https://www.instagram.com/stories/${handle}/${item.pk}/`,
      );
      if (options.shouldCapture && !(await options.shouldCapture(postUrl))) {
        options.onProgress?.(index + 1, items.length, "skipped");
        continue;
      }
      await options.beforePost();
      options.checkRestriction();
      options.assertActive?.();
      const candidate = [...item.image_versions2.candidates].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0];
      if (!candidate) throw new Error("Story has no source image");
      const imageUrl = validateMediaUrl(candidate.url);
      const pieces: string[] = [];
      const path = join(options.temporary, `story-${item.pk}.jpg`);
      await downloadImage(imageUrl, path);
      const posterText = await recognizeImage(path);
      pieces.push(
        `[Story ${item.pk}: ${item.media_type === 2 ? "video poster" : "still image"}; media ID ${instagramMediaId(postUrl, 1)}]\n${posterText}`,
      );
      if (item.media_type === 2) {
        const videoResponse = await page.goto(postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        if (videoResponse) checkInstagramResponse(videoResponse.status());
        await options.checkAccess();
        const view = page.getByRole("button", {
          name: /^(View story|Story ansehen)$/i,
        });
        if (await view.count()) await view.click({ timeout: 10000 });
        await page
          .locator("video")
          .filter({ visible: true })
          .first()
          .waitFor({ timeout: 15000 });
        const videos = await activeVideoLocators(page.locator("body"));
        if (videos.length !== 1)
          throw new Error("Cannot identify one active story video");
        const video = videos[0];
        if (!video) throw new Error("Missing story video");
        const pause = page.getByRole("button", {
          name: /^(Pause|Pausieren)$/i,
        });
        if (await pause.count()) await pause.click({ timeout: 5000 });
        const current = instagramSourceSchema.safeParse(page.url());
        if (!current.success || current.data !== postUrl)
          throw new Error(
            "Story advanced before video capture; retry exact story",
          );
        pieces.push(
          ...(await sampleVideoFrames(video, {
            sourceUrl: postUrl,
            label: `Story ${item.pk}`,
            assertSource: async () => {
              options.checkRestriction();
              if (instagramSourceSchema.safeParse(page.url()).data !== postUrl)
                throw new Error(
                  "Story advanced while sampling; item incomplete",
                );
            },
          })),
        );
      }
      options.checkRestriction();
      options.assertActive?.();
      yield {
        postUrl,
        accountUrl,
        caption: storyCaption(item),
        ocrText: pieces.join("\n\n"),
        capturedAt: new Date().toISOString(),
      };
      options.onProgress?.(index + 1, items.length, "captured");
    } catch (error) {
      options.onProgress?.(index + 1, items.length, "failed");
      if (
        error instanceof InstagramAccessError ||
        error instanceof DailyRestError
      )
        throw error;
      const reason =
        error instanceof z.ZodError
          ? "Malformed story media metadata"
          : error instanceof Error
            ? error.message
                .split("\n")[0]
                ?.replace(/https?:\/\/\S+/g, "[source URL]")
            : "Story capture failed";
      failures.push(`${candidateItem.pk}: ${reason}`);
    }
  }
  if (failures.length)
    throw new Error(
      `Some stories could not be collected (${failures.join("; ")}); other available items were attempted`,
    );
}
