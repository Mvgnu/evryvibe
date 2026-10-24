import { instagramMediaId } from "../core/media";
import { chromium, type BrowserContext, type Page } from "playwright";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { instagramPostSchema, type PostPackage } from "../core/model";
import type { Source } from "./runner";
import { downloadImage, recognizeImage, validateMediaUrl } from "./media";
import { captureStories, embeddedDocuments } from "./stories";
import { z } from "zod";
import { activeVideoLocators, sampleVideoFrames } from "./video";
import { captionFromDocuments, captionFromMetadata } from "./post-caption";
import {
  checkInstagramResponse,
  collectionDefaults,
  DailyRestError,
  InstagramAccessError,
  sleep,
} from "./pacing";
export function normalizePostUrl(value: string, accountUrl: string): string {
  const url = new URL(value);
  const match = /^\/([A-Za-z0-9._]+)\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(
    url.pathname,
  );
  if (match) {
    if (
      `/${match[1]?.toLowerCase()}/` !==
      new URL(accountUrl).pathname.toLowerCase()
    )
      throw new Error("Post profile prefix does not match source");
    url.pathname = `/${match[2]}/${match[3]}/`;
  }
  return instagramPostSchema.parse(url.href);
}
export async function openInstagram(
  headless: boolean,
): Promise<BrowserContext> {
  process.umask(0o077);
  const path = resolve(
    process.env.EVRYVIBE_INSTAGRAM_STATE_DIR ?? ".local/instagram",
  );
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  return chromium.launchPersistentContext(path, {
    headless,
    args: ["--disk-cache-size=33554432", "--media-cache-size=67108864"],
    viewport: { width: 1280, height: 1000 },
  });
}
async function checkAccess(page: Page) {
  if (
    /\/(accounts\/login|challenge|checkpoint)\//.test(
      new URL(page.url()).pathname,
    ) ||
    (await page
      .locator('input[name="username"], input[name="password"]')
      .count())
  )
    throw new InstagramAccessError(
      "Instagram login/checkpoint required; run instagram:login; collection paused for 24 hours",
    );
  const text = await page.locator("body").innerText();
  if (
    /Please wait a few minutes|Try again later|We restrict certain activity|Too many requests|Versuche es später erneut|Bitte warte einige Minuten/i.test(
      text,
    )
  )
    throw new InstagramAccessError(
      "Instagram rate limit or activity restriction; collection paused for 24 hours",
    );
  if (
    /This account is private|Sorry, this page isn't available|The link you followed may be broken|This page isn't available|Dieses Konto ist privat/i.test(
      text,
    )
  )
    throw new Error("Instagram profile/post is private or unavailable");
}
// Adapts the legacy crawler's profile → permalink → scoped media flow. No legacy
// credentials, shared cookies/history, disabled-security flags or LLM extraction.
export async function capturePost(
  page: Page,
  postUrl: string,
  accountUrl: string,
  options: { sampleVideo?: boolean } = {},
): Promise<{
  caption: string;
  imageUrls: string[];
  imageSlides: { url: string; slide: number; mediaId: string }[];
  videoOcrText?: string;
}> {
  const canonical = normalizePostUrl(postUrl, accountUrl);
  // The observed /reel/ route redirects to an unrelated scrolling /reels/
  // feed. Instagram's same-shortcode /p/ permalink retains the isolated source.
  const permalink = canonical.replace("/reel/", "/p/");
  const sourceCode = new URL(canonical).pathname.split("/")[2];
  const response = await page.goto(permalink, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  if (response) checkInstagramResponse(response.status());
  await checkAccess(page);
  await page.locator("article, main time").first().waitFor({ timeout: 15000 });
  await checkAccess(page);
  const articles = page.locator("article");
  const candidates = [];
  for (const article of await articles.all()) {
    const links = await article
      .locator("a[href]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href") ?? ""),
      );
    const matches = links.some((link) => {
      try {
        return (
          new URL(
            normalizePostUrl(new URL(link, canonical).href, accountUrl),
          ).pathname.split("/")[2] === sourceCode
        );
      } catch {
        return false;
      }
    });
    if (matches) candidates.push(article);
  }
  if (candidates.length === 0 && (await articles.count()) === 0) {
    // Observed current Instagram layout has no article; anchor the scope on the
    // source permalink timestamp, then stop at the first media-bearing ancestor.
    await page.evaluate(
      ({ canonical, accountUrl }) => {
        const expectedCode = new URL(canonical).pathname.split("/")[2];
        const expectedAccount = new URL(accountUrl).pathname
          .replaceAll("/", "")
          .toLowerCase();
        const scopes = new Set<Element>();
        for (const time of document.querySelectorAll("main time")) {
          const link = time.closest("a");
          if (!link) continue;
          const target = new URL(link.href);
          if (
            !["instagram.com", "www.instagram.com"].includes(target.hostname) ||
            target.port
          )
            continue;
          const match =
            /^\/(?:(?<account>[A-Za-z0-9._]+)\/)?(?:p|reel)\/(?<code>[A-Za-z0-9_-]+)\/?$/.exec(
              target.pathname,
            );
          if (
            !match?.groups ||
            match.groups.code !== expectedCode ||
            (match.groups.account &&
              match.groups.account.toLowerCase() !== expectedAccount)
          )
            continue;
          let node = time.parentElement;
          while (node && node.tagName !== "MAIN") {
            const media = Array.from(node.querySelectorAll("img, video")).some(
              (image) => {
                const box = image.getBoundingClientRect();
                return (
                  box.width > 200 &&
                  box.height > 200 &&
                  !image.closest('a[href*="/p/"], a[href*="/reel/"]')
                );
              },
            );
            if (media) {
              scopes.add(node);
              break;
            }
            node = node.parentElement;
          }
        }
        if (scopes.size === 1)
          scopes.forEach((node) =>
            node.setAttribute("data-evryvibe-source", "true"),
          );
      },
      { canonical: permalink, accountUrl },
    );
    const scoped = page.locator('[data-evryvibe-source="true"]');
    if ((await scoped.count()) === 1) candidates.push(scoped);
  }
  if (candidates.length !== 1)
    throw new Error(
      "Cannot identify a unique source post container; refusing ambiguous media",
    );
  const article = candidates[0];
  if (!article) throw new Error("Missing post container");
  const authorPath = new URL(accountUrl).pathname.toLowerCase();
  const authorPaths = await article.evaluate((element) => {
    let header: Element | null = element.querySelector("header");
    if (!header) {
      const more = Array.from(element.querySelectorAll("[aria-label]")).find(
        (node) =>
          /^(More options|Weitere Optionen)$/.test(
            node.getAttribute("aria-label") ?? "",
          ),
      );
      let node = more?.parentElement;
      while (node && node !== element) {
        if (node.querySelector("a[href]") && !node.querySelector("time")) {
          header = node;
          break;
        }
        node = node.parentElement;
      }
    }
    return header
      ? Array.from(header.querySelectorAll("a[href]")).map(
          (node) => node.getAttribute("href") ?? "",
        )
      : [];
  });
  if (
    !authorPaths.some(
      (link) => new URL(link, canonical).pathname.toLowerCase() === authorPath,
    )
  )
    throw new Error("Post author could not be verified against venue profile");
  const readCaption = async (): Promise<string | null> => {
    const embedded = captionFromDocuments(
      await embeddedDocuments(page),
      canonical,
      accountUrl,
    );
    if (embedded !== null) return embedded;
    const headings = await article
      .locator("h1")
      .evaluateAll((elements) =>
        elements.map((element) =>
          element instanceof HTMLElement ? element.innerText : "",
        ),
      );
    if (headings.length > 1) throw new Error("Ambiguous post caption");
    const heading = headings[0];
    if (heading?.trim()) return heading;
    // Instagram also renders the original caption as the first comment-list
    // item, with plain spans instead of an h1. Anchor it to this post's author;
    // a later comment by that author is not the original caption.
    const domCaption = await article.evaluate((element, authorPath) => {
      const firstItems = [
        ...new Set(
          Array.from(element.querySelectorAll("ul, ol"))
            .filter(
              (list) =>
                !list.closest("header") && !list.parentElement?.closest("li"),
            )
            .map((list) =>
              Array.from(list.children).find(
                (item) => item instanceof HTMLLIElement,
              ),
            )
            .filter(
              (item): item is HTMLLIElement => item instanceof HTMLLIElement,
            ),
        ),
      ];
      const matches = firstItems.filter((item) => {
        const link = item.querySelector("a[href]");
        if (!link || link.closest("li") !== item) return false;
        try {
          return (
            new URL(
              link.getAttribute("href") ?? "",
              location.href,
            ).pathname.toLowerCase() === authorPath
          );
        } catch {
          return false;
        }
      });
      if (matches.length !== 1) return "";
      const item = matches[0];
      if (!item) return "";
      const spans = Array.from(item.querySelectorAll('span[dir="auto"]'))
        .filter(
          (node) =>
            node.closest("li") === item &&
            !node.closest("a, button, time") &&
            !node.parentElement?.closest('span[dir="auto"]'),
        )
        .map((node) =>
          node instanceof HTMLElement ? node.innerText.trim() : "",
        )
        .filter(Boolean);
      return spans.length === 1 ? (spans[0] ?? "") : "";
    }, authorPath);
    if (domCaption) return domCaption;
    const { description, metaUrl } = await page.evaluate(() => ({
      description:
        document
          .querySelector('meta[property="og:description"]')
          ?.getAttribute("content") ?? null,
      metaUrl:
        document
          .querySelector('meta[property="og:url"]')
          ?.getAttribute("content") ?? null,
    }));
    return captionFromMetadata(description, metaUrl, canonical, accountUrl);
  };
  let caption = await readCaption();
  const captionDeadline = Date.now() + 5_000;
  while (caption === null && Date.now() < captionDeadline) {
    await sleep(500);
    await checkAccess(page);
    caption = await readCaption();
  }
  if (caption === null)
    throw new Error("Cannot isolate the original caption from the source post");
  const imageUrls: string[] = [];
  const imageSlides: { url: string; slide: number; mediaId: string }[] = [];
  const videoPieces: string[] = [];
  const sampledSources = new Set<string>();
  for (let frame = 0; frame < 20; frame++) {
    const media = await article.evaluate(async (element) => {
      const deadline = Date.now() + 10000;
      let previousFrame = "";
      let stableSince = Date.now();
      while (Date.now() < deadline) {
        const images = Array.from(element.querySelectorAll("img,video")).filter(
          (image) => {
            if (image.closest("header")) return false;
            const box = image.getBoundingClientRect();
            if (box.width < 200 || box.height < 200) return false;
            let left = Math.max(box.left, 0),
              right = Math.min(box.right, window.innerWidth);
            let top = box.top,
              bottom = box.bottom;
            // A retained previous slide can still have full dimensions while being
            // translated outside the carousel. Intersect ancestor clipping boxes.
            for (
              let parent = image.parentElement;
              parent;
              parent = parent.parentElement
            ) {
              const style = getComputedStyle(parent);
              const clip = parent.getBoundingClientRect();
              if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
                left = Math.max(left, clip.left);
                right = Math.min(right, clip.right);
              }
              if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
                top = Math.max(top, clip.top);
                bottom = Math.min(bottom, clip.bottom);
              }
            }
            return right - left >= 200 && bottom - top >= 200;
          },
        );
        const fingerprint = images
          .map((image) => {
            const box = image.getBoundingClientRect();
            return `${image.getAttribute("src") ?? image.getAttribute("poster")}@${box.x},${box.y}`;
          })
          .join("|");
        if (fingerprint !== previousFrame) {
          previousFrame = fingerprint;
          stableSince = Date.now();
        }
        // Every active still must finish; a loaded retained frame must never
        // make a newly inserted final slide appear ready.
        if (
          images.length &&
          Date.now() - stableSince >= 200 &&
          images.every((image) =>
            image instanceof HTMLImageElement
              ? image.complete &&
                image.naturalWidth > 250 &&
                image.naturalHeight > 250
              : image instanceof HTMLVideoElement &&
                (image.readyState >= 2 || !!image.poster),
          )
        ) {
          return images.flatMap((image) =>
            image instanceof HTMLImageElement
              ? [image.currentSrc || image.src]
              : image instanceof HTMLVideoElement
                ? image.poster
                  ? [image.poster]
                  : []
                : [],
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Scoped post image did not load within 10 seconds");
    });
    for (const url of media) {
      validateMediaUrl(url);
      if (!imageUrls.includes(url)) imageUrls.push(url);
      if (
        !imageSlides.some(
          (item) => item.url === url && item.slide === frame + 1,
        )
      )
        imageSlides.push({
          url,
          slide: frame + 1,
          mediaId: instagramMediaId(canonical, frame + 1),
        });
    }
    if (imageUrls.length > 20) throw new Error("Post exceeds 20 still images");
    const videos = await activeVideoLocators(article);
    if (videos.length > 1)
      throw new Error(
        "Multiple active videos in the source slide; refusing ambiguous capture",
      );
    for (const video of videos) {
      if (options.sampleVideo === false) continue;
      const source = await video.evaluate((element) =>
        element instanceof HTMLVideoElement
          ? element.currentSrc || element.src
          : "",
      );
      if (source && sampledSources.has(source)) continue;
      videoPieces.push(
        ...(await sampleVideoFrames(video, {
          sourceUrl: canonical,
          label: `Post slide ${frame + 1}`,
          slide: frame + 1,
          assertSource: async () => {
            await checkAccess(page);
            const current = normalizePostUrl(page.url(), accountUrl);
            if (new URL(current).pathname.split("/")[2] !== sourceCode)
              throw new Error("Post source changed while sampling");
          },
        })),
      );
      if (source) sampledSources.add(source);
    }

    const next = article.getByRole("button", { name: /^(Next|Weiter)$/i });
    if (!(await next.count()) || !(await next.first().isVisible())) break;
    if (frame === 19) throw new Error("Carousel exceeds collection bound");
    const before = await article
      .locator("img,video")
      .evaluateAll((elements) =>
        elements
          .map((element) =>
            element instanceof HTMLImageElement
              ? `${element.currentSrc || element.src}@${element.getBoundingClientRect().x}`
              : `${element instanceof HTMLVideoElement ? element.currentSrc || element.src || element.poster : ""}@${element.getBoundingClientRect().x}`,
          )
          .join("|"),
      );
    await next.first().click({ timeout: 5000 });
    await article.evaluate(async (element, before) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const current = Array.from(element.querySelectorAll("img,video"))
          .map((node) =>
            node instanceof HTMLImageElement
              ? `${node.currentSrc || node.src}@${node.getBoundingClientRect().x}`
              : `${node instanceof HTMLVideoElement ? node.currentSrc || node.src || node.poster : ""}@${node.getBoundingClientRect().x}`,
          )
          .join("|");
        if (current !== before) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Carousel failed to advance");
    }, before);
  }
  // Use only media already observed during this crawl. A posterless reel keeps
  // its valid video OCR and the public UI can show the consented native embed.
  if (!imageUrls.length && !videoPieces.length && options.sampleVideo !== false)
    throw new Error("No scoped image or video available for OCR");
  return {
    caption,
    imageUrls,
    imageSlides,
    ...(videoPieces.length ? { videoOcrText: videoPieces.join("\n\n") } : {}),
  };
}
export async function latestProfilePosts(
  page: Page,
  accountUrl: string,
): Promise<string[]> {
  const handle = new URL(accountUrl).pathname.replaceAll("/", "").toLowerCase();
  const seen = new Map<string, { url: string; pinned: boolean }>();
  // A grid that keeps adding only pinned/irrelevant links must not hold the
  // entire sequential collector indefinitely. Exhaustion is an explicit
  // partial failure, never a claim that the six latest posts were inspected.
  const maxScrolls = 12;
  for (let scrolls = 0; scrolls <= maxScrolls; scrolls++) {
    const links = await page.locator("main a[href]").evaluateAll((elements) =>
      elements.map((element) => ({
        href: element.getAttribute("href") ?? "",
        pinned: Array.from(
          element.querySelectorAll("[aria-label], title"),
        ).some((node) =>
          /pinned|angeheftet/i.test(
            node.getAttribute("aria-label") ?? node.textContent ?? "",
          ),
        ),
      })),
    );
    for (const link of links) {
      try {
        const url = normalizePostUrl(
          new URL(link.href, accountUrl).href,
          accountUrl,
        );
        seen.set(url, { url, pinned: link.pinned });
      } catch {
        /* profile/navigation links are not posts */
      }
    }
    // Prefer provider timestamps when current-page data exposes attributed media.
    const stack = await embeddedDocuments(page);
    const dated = new Map<string, number>();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const result = z
        .object({
          code: z.string(),
          taken_at: z.number(),
          user: z.object({ username: z.string() }),
        })
        .safeParse(node);
      if (result.success && result.data.user.username.toLowerCase() === handle)
        dated.set(result.data.code, result.data.taken_at);
      for (const child of Object.values(node))
        if (child && typeof child === "object") stack.push(child);
    }
    const ordered = [...seen.values()];
    const timestamped = ordered.filter((item) =>
      dated.has(new URL(item.url).pathname.split("/")[2] ?? ""),
    );
    if (timestamped.length >= 6)
      return timestamped
        .sort(
          (a, b) =>
            (dated.get(new URL(b.url).pathname.split("/")[2] ?? "") ?? 0) -
            (dated.get(new URL(a.url).pathname.split("/")[2] ?? "") ?? 0),
        )
        .slice(0, 6)
        .map((item) => item.url);
    const recent = ordered.filter((item) => !item.pinned);
    if (recent.length >= 6) return recent.slice(0, 6).map((item) => item.url);
    if (scrolls === maxScrolls)
      throw new Error(
        "Profile grid did not expose six recent posts after 12 scrolls; enumeration incomplete",
      );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const added = await page
      .waitForFunction(
        ({ known }) =>
          Array.from(document.querySelectorAll("main a[href]")).some((link) => {
            const href = link.getAttribute("href") ?? "";
            return (
              /\/(p|reel)\/[A-Za-z0-9_-]+/.test(href) && !known.includes(href)
            );
          }),
        { known: links.map((link) => link.href) },
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false);
    await checkAccess(page);
    if (!added) {
      if (await page.getByRole("progressbar").filter({ visible: true }).count())
        throw new Error(
          "Profile grid is still loading; recent-post enumeration incomplete",
        );
      return recent.slice(0, 6).map((item) => item.url);
    }
  }
  throw new Error("Profile grid enumeration incomplete");
}
export async function* captureProfile(
  context: BrowserContext,
  source: Source,
  options: {
    beforePost?: () => Promise<void>;
    shouldCapture?: (sourceUrl: string) => Promise<boolean>;
    assertActive?: () => void;
  } = {},
): AsyncGenerator<PostPackage> {
  if (!source.enabled || !source.instagramUrl)
    throw new Error("Source is disabled or has no Instagram profile");
  const page = await context.newPage();
  let restricted = false;
  page.on("response", (response) => {
    if (response.status() !== 429) return;
    const url = response.url();
    const host = new URL(url).hostname;
    if (host === "instagram.com" || host.endsWith(".instagram.com")) {
      restricted = true;
      return;
    }
    try {
      validateMediaUrl(url);
      restricted = true;
    } catch {
      // A third-party subresource cannot impose an Instagram cooldown.
    }
  });
  const checkRestriction = () => {
    if (restricted) checkInstagramResponse(429);
  };
  const beforePost =
    options.beforePost ?? (() => sleep(collectionDefaults.postDelayMs));
  const assertActive = options.assertActive ?? (() => {});
  const temporary = await mkdtemp(join(tmpdir(), "evryvibe-ocr-"));
  const failures: string[] = [];
  let storiesAcknowledged = 0;
  let postsAcknowledged = 0;
  let outcome = "interrupted";
  console.error(`[collector] ${source.slug}: source capture started`);
  const recordFailure = (error: unknown, stage: string) => {
    checkRestriction();
    if (
      error instanceof InstagramAccessError ||
      error instanceof DailyRestError
    )
      throw error;
    const message =
      error instanceof Error
        ? error.message
            .split("\n")[0]
            ?.replace(/https?:\/\/\S+/g, "[source URL]")
        : "Capture failed";
    failures.push(`${stage}: ${message}`);
    console.error(`[collector] ${source.slug}: ${stage} failed`);
  };
  try {
    try {
      assertActive();
      console.error(`[collector] ${source.slug}: stories capture started`);
      for await (const pack of captureStories(page, source.instagramUrl, {
        temporary,
        beforePost,
        shouldCapture: options.shouldCapture,
        checkAccess: () => checkAccess(page),
        checkRestriction,
        assertActive,
        onProgress: (index, total, status) => {
          console.error(
            `[collector] ${source.slug}: story ${index}/${total} ${status}`,
          );
        },
      })) {
        yield pack;
        storiesAcknowledged++;
        console.error(
          `[collector] ${source.slug}: story ${storiesAcknowledged} acknowledged`,
        );
      }
      console.error(
        `[collector] ${source.slug}: stories capture complete (${storiesAcknowledged} acknowledged)`,
      );
    } catch (error) {
      recordFailure(error, "stories");
    }
    try {
      checkRestriction();
      assertActive();
      const response = await page.goto(source.instagramUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      if (response) checkInstagramResponse(response.status());
      await checkAccess(page);
      await page.locator("main").waitFor({ timeout: 15000 });
      await page
        .locator('main a[href*="/p/"], main a[href*="/reel/"]')
        .first()
        .waitFor({ timeout: 15000 })
        .catch(async () => {
          await checkAccess(page);
          const text = await page.locator("main").innerText();
          if (!/No posts yet|Noch keine Beiträge/i.test(text))
            throw new Error(
              "Profile grid unavailable; cannot determine recent posts",
            );
        });
      const posts = await latestProfilePosts(page, source.instagramUrl);
      console.error(
        `[collector] ${source.slug}: profile grid selected ${posts.length} recent posts`,
      );
      for (const [index, postUrl] of posts.entries()) {
        try {
          checkRestriction();
          assertActive();
          if (options.shouldCapture && !(await options.shouldCapture(postUrl)))
            continue;
          console.error(
            `[collector] ${source.slug}: post ${index + 1}/${posts.length} capture started`,
          );
          await beforePost();
          checkRestriction();
          assertActive();
          const captured = await capturePost(
            page,
            postUrl,
            source.instagramUrl,
          );
          checkRestriction();
          const pieces: string[] = captured.videoOcrText
            ? [captured.videoOcrText]
            : [];
          for (const [index, image] of captured.imageSlides.entries()) {
            const path = join(temporary, `image-${index}`);
            checkRestriction();
            await downloadImage(image.url, path);
            const ocrText = await recognizeImage(path);
            pieces.push(
              `[Image ${index + 1}, carousel slide ${image.slide}; media ID ${image.mediaId}]\n${ocrText}`,
            );
          }
          checkRestriction();
          assertActive();
          yield {
            postUrl,
            accountUrl: source.instagramUrl,
            caption: captured.caption,
            ocrText: pieces.join("\n\n"),
            capturedAt: new Date().toISOString(),
            imageCandidates: captured.imageSlides,
          };
          postsAcknowledged++;
          console.error(
            `[collector] ${source.slug}: post ${index + 1}/${posts.length} acknowledged`,
          );
        } catch (error) {
          recordFailure(error, `post ${new URL(postUrl).pathname}`);
        }
      }
    } catch (error) {
      recordFailure(error, "profile");
    }
    checkRestriction();
    assertActive();
    if (failures.length) {
      outcome = "partial failure";
      throw new Error(`Partial collection: ${failures.join("; ")}`);
    }
    outcome = "complete";
  } finally {
    console.error(
      `[collector] ${source.slug}: source capture ${outcome} (${storiesAcknowledged} stories, ${postsAcknowledged} posts acknowledged)`,
    );
    try {
      await page.close();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
