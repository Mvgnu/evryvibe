import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { expect, test, vi } from "vitest";
import {
  capturePost,
  captureProfile,
  latestProfilePosts,
  normalizePostUrl,
} from "../src/collector/instagram";
import {
  recognizeImage,
  validateMediaUrl,
  downloadImage,
} from "../src/collector/media";
import { collectSources, type Source } from "../src/collector/runner";
import { parseInstagramCookies } from "../src/collector/cookies";
import { collectionDefaults } from "../src/collector/pacing";
const source: Source = {
  venueId: randomUUID(),
  slug: "test-room",
  name: "Test Room",
  city: "Berlin",
  instagramUrl: "https://www.instagram.com/testroom/",
  enabled: true,
  revision: 1,
  lastStartedAt: null,
  lastSucceededAt: null,
  lastError: null,
  lastPostCount: 0,
};
const pack = {
  postUrl: "https://www.instagram.com/p/TEST/",
  accountUrl: source.instagramUrl ?? "",
  caption: "raw caption",
  ocrText: "raw OCR",
  capturedAt: new Date().toISOString(),
};
test("manual venue collection selects only the enabled source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evryvibe-one-source-"));
  const other = { ...source, venueId: randomUUID(), slug: "other-room" };
  const call = vi.fn(async (name: string) =>
    name === "list_venue_sources" ? { sources: [other, source] } : {},
  );
  const captured: string[] = [];
  try {
    const options = {
      mcp: { call, close: async () => {} },
      stateDir: directory,
      onlyVenueSlug: source.slug,
      sourceDelayMs: 0,
      capture: async function* (item: Source) {
        captured.push(item.slug);
      },
    };
    expect(await collectSources(options)).toEqual({ sources: 1, failed: 0 });
    expect(captured).toEqual([source.slug]);
    await expect(
      collectSources({ ...options, onlyVenueSlug: "disabled-room" }),
    ).rejects.toThrow("Enabled venue source not found");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("source prefixes normalize only for the configured account; media URL boundary rejects arbitrary hosts", () => {
  expect(
    normalizePostUrl(
      "https://www.instagram.com/testroom/p/TEST/?a=1",
      pack.accountUrl,
    ),
  ).toBe(pack.postUrl);
  expect(() =>
    normalizePostUrl(
      "https://www.instagram.com/other/p/TEST/",
      pack.accountUrl,
    ),
  ).toThrow();
  for (const url of [
    "http://s.cdninstagram.com/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://cdninstagram.com.evil.test/a.jpg",
    "https://user:pass@s.cdninstagram.com/a.jpg",
  ])
    expect(() => validateMediaUrl(url)).toThrow();
});
test("cookie import excludes expired state and rejects foreign domains without returning cookie values in errors", () => {
  expect(
    parseInstagramCookies([
      {
        name: "sessionid",
        value: "fixture",
        domain: ".instagram.com",
        path: "/",
        expiry: 1,
      },
    ]),
  ).toEqual([]);
  expect(() =>
    parseInstagramCookies([
      { name: "sessionid", value: "fixture", domain: ".evil.test", path: "/" },
    ]),
  ).toThrow();
});
test("profile grid stops when endless new pinned links never expose six recent posts", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main><a href="/p/PIN0/"><svg aria-label="Pinned post"></svg></a></main>',
    );
    await page.evaluate(() => {
      let added = 0;
      window.scrollTo = () => {
        added++;
        document
          .querySelector("main")
          ?.insertAdjacentHTML(
            "beforeend",
            `<a href="/p/PIN${added}/"><svg aria-label="Pinned post"></svg></a>`,
          );
      };
    });
    await expect(latestProfilePosts(page, pack.accountUrl)).rejects.toThrow(
      "enumeration incomplete",
    );
    expect(await page.locator("main a").count()).toBe(13);
  } finally {
    await browser.close();
  }
});
test.each(["s.cdninstagram.com", "scontent.fbcdn.net"])(
  "browser 429 from %s stops all sources and persists cooldown",
  async (mediaHost) => {
    const directory = await mkdtemp(join(tmpdir(), "collector-cdn-429-"));
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const navigated: string[] = [];
      await context.route("https://www.instagram.com/**", (route) => {
        navigated.push(route.request().url());
        return route.fulfill({
          contentType: "text/html",
          body: `<script src="https://${mediaHost}/rate.js"></script><script type="application/json">{"user":{"username":"testroom"},"items":[]}</script><main>No active stories</main>`,
        });
      });
      await context.route(`https://${mediaHost}/**`, (route) =>
        route.fulfill({
          status: 429,
          contentType: "text/javascript",
          body: "",
        }),
      );
      const sources = [source, { ...source, venueId: randomUUID() }];
      const call = vi.fn(async (name: string) =>
        name === "list_venue_sources" ? { sources } : source,
      );
      const options = {
        mcp: { call, close: async () => {} },
        stateDir: directory,
        now: () => 1000,
        sourceDelayMs: 0,
        capture: (
          item: Source,
          shouldCapture: (url: string) => Promise<boolean>,
        ) =>
          captureProfile(context, item, {
            beforePost: async () => {},
            shouldCapture,
          }),
      };
      expect(await collectSources(options)).toEqual({ sources: 1, failed: 1 });
      expect(navigated).toEqual([
        "https://www.instagram.com/stories/testroom/",
      ]);
      expect(call).toHaveBeenCalledWith(
        "record_source_run",
        expect.objectContaining({ error: expect.stringContaining("HTTP 429") }),
      );
      expect(
        JSON.parse(await readFile(join(directory, "cooldown.json"), "utf8")),
      ).toEqual({
        until: 1000 + collectionDefaults.cooldownMs,
      });
      await expect(collectSources(options)).rejects.toThrow("cooldown");
      await context.close();
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
test("late CDN 429 wins over final-post media timeout and stops the next source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "collector-late-cdn-429-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const navigated: string[] = [];
    await context.route("https://www.instagram.com/**", (route) => {
      const url = route.request().url();
      navigated.push(url);
      const path = new URL(url).pathname;
      const body = path.startsWith("/stories/")
        ? '<script type="application/json">{"user":{"username":"testroom"},"items":[]}</script><main>No active stories</main>'
        : path === "/testroom/"
          ? `<main>${Array.from({ length: 6 }, (_, index) => `<a href="/p/POST${index}/">post</a>`).join("")}</main>`
          : '<article><header><a href="/testroom/">testroom</a></header><a href="/p/POST5/">date</a><h1>Original caption</h1><img src="https://s.cdninstagram.com/rate.png" width="600" height="350"></article>';
      return route.fulfill({ contentType: "text/html", body });
    });
    await context.route("https://s.cdninstagram.com/**", (route) =>
      route.fulfill({ status: 429, contentType: "image/png", body: "" }),
    );
    const sources = [source, { ...source, venueId: randomUUID() }];
    const call = vi.fn(async (name: string) =>
      name === "list_venue_sources" ? { sources } : source,
    );
    const options = {
      mcp: { call, close: async () => {} },
      stateDir: directory,
      now: () => 1000,
      sourceDelayMs: 0,
      capture: (
        item: Source,
        shouldCapture: (url: string) => Promise<boolean>,
      ) =>
        captureProfile(context, item, {
          beforePost: async () => {},
          shouldCapture: async (url) =>
            url.endsWith("/POST5/") && shouldCapture(url),
        }),
    };
    expect(await collectSources(options)).toEqual({ sources: 1, failed: 1 });
    expect(navigated).toEqual([
      "https://www.instagram.com/stories/testroom/",
      "https://www.instagram.com/testroom/",
      "https://www.instagram.com/p/POST5/",
    ]);
    expect(call).toHaveBeenCalledWith(
      "record_source_run",
      expect.objectContaining({ error: expect.stringContaining("HTTP 429") }),
    );
    expect(
      JSON.parse(await readFile(join(directory, "cooldown.json"), "utf8")),
    ).toEqual({
      until: 1000 + collectionDefaults.cooldownMs,
    });
    await expect(collectSources(options)).rejects.toThrow("cooldown");
    await context.close();
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
test("profile package retains labeled OCR without storing source images", async () => {
  const directory = await mkdtemp(join(tmpdir(), "collector-assets-"));
  const previous = process.env.EVRYVIBE_MEDIA_DIR;
  process.env.EVRYVIBE_MEDIA_DIR = join(directory, "media");
  const browser = await chromium.launch({ headless: true });
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const context = await browser.newContext();
    const fixture = await context.newPage();
    await fixture.setContent(
      '<main style="background:white;color:black;width:600px;height:350px;font:60px Arial">NIGHT FRIDAY</main>',
    );
    const png = await fixture.locator("main").screenshot();
    fetcher.mockResolvedValue(
      new Response(Uint8Array.from(png), {
        headers: { "content-type": "image/png" },
      }),
    );
    await context.route("https://s.cdninstagram.com/**", (route) =>
      route.fulfill({ contentType: "image/png", body: png }),
    );
    await context.route("https://www.instagram.com/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path.startsWith("/stories/")
        ? '<script type="application/json">{"user":{"username":"testroom"},"items":[]}</script><main>No active stories</main>'
        : path === "/testroom/"
          ? `<main>${Array.from({ length: 6 }, (_, index) => `<a href="/p/POST${index}/">post</a>`).join("")}</main>`
          : '<article><header><a href="/testroom/">testroom</a></header><a href="/p/POST0/">date</a><h1>Original caption</h1><img src="https://s.cdninstagram.com/flyer.png" width="600" height="350"></article>';
      return route.fulfill({ contentType: "text/html", body });
    });
    const packages = [];
    for await (const item of captureProfile(context, source, {
      beforePost: async () => {},
      shouldCapture: async (url) => url.endsWith("/POST0/"),
    }))
      packages.push(item);
    expect(packages).toHaveLength(1);
    const item = packages[0];
    expect(item?.postUrl).toBe("https://www.instagram.com/p/POST0/");
    expect(item?.ocrText).toContain(
      "[Image 1, carousel slide 1; media ID ig:POST0:slide:1:image]",
    );
    expect(item?.ocrText).toContain("NIGHT FRIDAY");
    expect(item).not.toHaveProperty("imageUrls");
    expect(item?.imageCandidates).toEqual([
      {
        url: "https://s.cdninstagram.com/flyer.png",
        slide: 1,
        mediaId: "ig:POST0:slide:1:image",
      },
    ]);
    await expect(readdir(join(directory, "media"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    fetcher.mockRestore();
    await browser.close();
    if (previous === undefined) delete process.env.EVRYVIBE_MEDIA_DIR;
    else process.env.EVRYVIBE_MEDIA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
test("failed MCP submission stays prepared; retry submits once; disabled and changed sources cannot submit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collector-test-"));
  let enabled = true;
  let revision = 1;
  let fail = true;
  let submitted = 0;
  const call = vi.fn(async (name: string) => {
    if (name === "list_venue_sources")
      return { sources: [{ ...source, enabled, revision }] };
    if (name === "enqueue_collected_package") {
      if (fail) throw new Error("temporary outage");
      submitted++;
      return { id: randomUUID(), created: submitted === 1 };
    }
    return source;
  });
  const options = {
    mcp: { call, close: async () => {} },
    capture: async function* () {
      yield pack;
    },
    stateDir: dir,
  };
  try {
    expect((await collectSources(options)).failed).toBe(1);
    expect(await readdir(join(dir, source.venueId))).toEqual([
      "1-p_TEST.pending.json",
    ]);
    enabled = false;
    await collectSources(options);
    expect(submitted).toBe(0);
    enabled = true;
    revision = 2;
    expect((await collectSources(options)).failed).toBe(1);
    expect(submitted).toBe(0);
    revision = 1;
    fail = false;
    await collectSources(options);
    await collectSources(options);
    expect(submitted).toBe(1);
    revision = 3;
    await collectSources(options);
    expect(submitted).toBe(1);
    expect(call).toHaveBeenLastCalledWith(
      "record_source_run",
      expect.objectContaining({ postsQueued: 0, error: null }),
    );
    expect((await readdir(join(dir, source.venueId))).sort()).toEqual([
      "1-p_TEST.sent.json",
      "1-p_TEST.stale.json",
      "2-p_TEST.stale.json",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("download bounds reject excessive lengths and redirects without forwarding cookies", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("x", {
      headers: {
        "content-type": "image/png",
        "content-length": String(16 * 1024 * 1024),
      },
    }),
  );
  try {
    await expect(
      downloadImage("https://s.cdninstagram.com/image.png", "unused"),
    ).rejects.toThrow("15 MB");
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "error" }),
    );
  } finally {
    fetcher.mockRestore();
  }
});
test("real browser fixture isolates carousel media and real Tesseract reads generated flyer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collector-ocr-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 800 },
    });
    await page.setContent(
      '<main style="background:white;color:black;width:700px;height:350px;padding:30px;font:60px Arial">EVRYVIBE TEST NIGHT<br>FRIDAY 21 AUGUST<br>DOORS 23:00</main>',
    );
    const path = join(dir, "flyer.png");
    await page.locator("main").screenshot({ path });
    expect(await recognizeImage(path)).toMatch(/EVRYVIBE TEST NIGHT/);
    const png = await readFile(path);
    await page.route("https://s.cdninstagram.com/**", async (route) => {
      if (route.request().url().endsWith("/one.png"))
        await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ contentType: "image/png", body: png });
    });
    await page.route(pack.postUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<article><header><a href="/testroom/">testroom</a><img src="https://s.cdninstagram.com/avatar.png" width="300" height="300"></header><a href="/p/TEST/">date</a><h1>Original raw caption</h1><img id="flyer" src="https://s.cdninstagram.com/one.png" width="600" height="350"><button aria-label="Next" onclick="document.getElementById('flyer').src='https://s.cdninstagram.com/two.png';this.remove()">Next</button></article><article><a href="/p/OTHER/">other</a><img src="https://s.cdninstagram.com/unrelated.png" width="600" height="350"></article>`,
      }),
    );
    const result = await capturePost(page, pack.postUrl, pack.accountUrl);
    expect(result.caption).toBe("Original raw caption");
    expect(result.imageUrls).toEqual([
      "https://s.cdninstagram.com/one.png",
      "https://s.cdninstagram.com/two.png",
    ]);
    expect(result.imageSlides).toEqual([
      {
        url: "https://s.cdninstagram.com/one.png",
        slide: 1,
        mediaId: "ig:TEST:slide:1:image",
      },
      {
        url: "https://s.cdninstagram.com/two.png",
        slide: 2,
        mediaId: "ig:TEST:slide:2:image",
      },
    ]);
    // Retained offscreen first frame must not satisfy final-frame readiness.
    await page.route(
      "https://s.cdninstagram.com/delayed-final.png",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({ contentType: "image/png", body: png });
      },
    );
    await page.route(pack.postUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<article><header><a href="/testroom/">testroom</a></header><a href="/p/TEST/">date</a><h1>Retained carousel</h1><div id="gallery" style="position:relative;overflow:hidden;width:600px;height:350px"><img id="old-frame" src="https://s.cdninstagram.com/one.png" width="600" height="350"></div><button aria-label="Next" onclick="document.getElementById('old-frame').style.transform='translateX(-600px)';const image=document.createElement('img');image.src='https://s.cdninstagram.com/delayed-final.png';image.width=600;image.height=350;image.style='position:absolute;left:0;top:0';document.getElementById('gallery').append(image);this.remove()">Next</button></article>`,
      }),
    );
    expect(
      (await capturePost(page, pack.postUrl, pack.accountUrl)).imageUrls,
    ).toEqual([
      "https://s.cdninstagram.com/one.png",
      "https://s.cdninstagram.com/delayed-final.png",
    ]);
    await page.route(pack.postUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<article><header><a href="/another/">another</a></header><a href="/p/TEST/">date</a><h1>Other author's post</h1><img src="https://s.cdninstagram.com/one.png" width="600" height="350"><a role="link" href="/testroom/">testroom comments</a></article>`,
      }),
    );
    await expect(
      capturePost(page, pack.postUrl, pack.accountUrl),
    ).rejects.toThrow("author");
    await page.route(pack.postUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<main><div><img src="https://s.cdninstagram.com/one.png" width="600" height="350"><div><div><a href="/testroom/">testroom</a><button aria-label="More options">...</button></div><h1>Modern caption</h1><a href="/testroom/p/TEST/"><time>Today</time></a></div></div><a href="/p/OTHER/"><img src="https://s.cdninstagram.com/unrelated.png" width="600" height="350"></a></main>`,
      }),
    );
    expect(await capturePost(page, pack.postUrl, pack.accountUrl)).toEqual({
      caption: "Modern caption",
      imageUrls: ["https://s.cdninstagram.com/one.png"],
      imageSlides: [
        {
          url: "https://s.cdninstagram.com/one.png",
          slide: 1,
          mediaId: "ig:TEST:slide:1:image",
        },
      ],
    });
    await page.route(pack.postUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<head><meta property="og:description" content="Unrelated preview"></head><article><header><a href="/testroom/">testroom</a></header><a href="/p/TEST/">date</a><img src="https://s.cdninstagram.com/one.png" width="600" height="350"><ul><li><a href="/testroom/">testroom</a><span dir="auto">Original span caption<br>with a second line</span></li><li><a href="/other/">other</a><span dir="auto">Unrelated comment</span></li><li><a href="/testroom/">testroom</a><span dir="auto">Author's later comment</span></li></ul></article><article><a href="/p/OTHER/">other post</a><h1>Unrelated post caption</h1></article>`,
      }),
    );
    expect(
      (await capturePost(page, pack.postUrl, pack.accountUrl)).caption,
    ).toBe("Original span caption\nwith a second line");
    await page.route(pack.postUrl, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<article><header><a href="/testroom/">testroom</a></header><a href="/p/TEST/">date</a><img src="https://s.cdninstagram.com/one.png" width="600" height="350"><ul><li><a href="/other/">other</a><span dir="auto">Another user's caption mentioning <a href="/testroom/">testroom</a></span></li><li><a href="/testroom/">testroom</a><span dir="auto">Author's comment is not a caption</span></li></ul></article>`,
      }),
    );
    await expect(
      capturePost(page, pack.postUrl, pack.accountUrl),
    ).rejects.toThrow("Cannot isolate the original caption");
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 45000);

test.skipIf(!process.env.COLLECTOR_TEST_DATABASE_URL)(
  "collector runner submits and records success through the real stdio MCP boundary",
  async () => {
    const url = process.env.COLLECTOR_TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.includes("_test"))
      throw new Error("Dedicated collector _test database required");
    const { connectDatabase } = await import("../src/db/client");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const setup = connectDatabase(url);
    try {
      await migrate(setup.db, { migrationsFolder: "./drizzle" });
    } finally {
      await setup.close();
    }
    const { connectCollectorMcp } = await import("../src/collector/mcp");
    const { venueSourceSchema } = await import("../src/core/sources");
    const { z } = await import("zod");
    const dir = await mkdtemp(join(tmpdir(), "collector-mcp-"));
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    const mcp = await connectCollectorMcp();
    let enabled: Source | undefined;
    try {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const accountUrl = `https://www.instagram.com/fixture_${suffix}/`;
      const venue = z.object({ id: z.uuid() }).parse(
        await mcp.call("upsert_venue", {
          venue: {
            slug: `collector-${suffix}`,
            name: "Collector MCP fixture",
            city: "Berlin",
            country: "Germany",
            address: "Test fixture",
            timezone: "Europe/Berlin",
            description: "Automated test only",
            imageUrl: null,
            instagramUrl: accountUrl,
            websiteUrl: null,
          },
        }),
      );
      enabled = venueSourceSchema.parse(
        await mcp.call("set_venue_source", {
          venueId: venue.id,
          enabled: true,
          expectedRevision: 0,
        }),
      );
      const post = {
        ...pack,
        accountUrl,
        postUrl: `https://www.instagram.com/p/TEST_${suffix}/`,
      };
      const adapter = {
        ...mcp,
        call: async (name: string, args: Record<string, unknown>) =>
          name === "list_venue_sources"
            ? { sources: [enabled] }
            : mcp.call(name, args),
      };
      expect(
        await collectSources({
          mcp: adapter,
          capture: async function* () {
            yield post;
          },
          stateDir: dir,
        }),
      ).toEqual({ sources: 1, failed: 0 });
      const rows = z
        .array(
          z.object({
            id: z.uuid(),
            payload: z.object({ postUrl: z.string(), ocrText: z.string() }),
          }),
        )
        .parse(await mcp.call("list_packages", { limit: 100 }));
      expect(
        rows.find((row) => row.payload.postUrl === post.postUrl)?.payload
          .ocrText,
      ).toBe(post.ocrText);
      const status = z
        .object({ sources: z.array(venueSourceSchema) })
        .parse(await mcp.call("list_venue_sources", {}))
        .sources.find((row) => row.venueId === venue.id);
      expect(status).toMatchObject({ lastError: null, lastPostCount: 1 });
      expect(status?.lastSucceededAt).toBeTruthy();
    } finally {
      if (enabled)
        await mcp.call("set_venue_source", {
          venueId: enabled.venueId,
          enabled: false,
          expectedRevision: enabled.revision,
        });
      await mcp.close();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000,
);

test("actual tsx CLI loader serializes carousel capture without runtime helper dependencies", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const html = `<article><header><a href="/testroom/">testroom</a></header><a href="/p/CLI/">date</a><h1>CLI fixture caption</h1><div id="gallery" style="position:relative;overflow:hidden;width:600px;height:350px"><img id="old" src="https://s.cdninstagram.com/one.png" width="600" height="350"></div><button aria-label="Next" onclick="document.getElementById('old').style.transform='translateX(-600px)';const image=document.createElement('img');image.src='https://s.cdninstagram.com/two.png';image.width=600;image.height=350;image.style='position:absolute;left:0;top:0';document.getElementById('gallery').append(image);this.remove()">Next</button></article>`;
  const script = `
    import {chromium} from 'playwright';
    import {capturePost} from ${JSON.stringify(pathToFileURL(resolve("src/collector/instagram.ts")).href)};
    const browser = await chromium.launch({headless:true});
    try {
      const page = await browser.newPage({viewport:{width:1000,height:800}});
      await page.setContent('<div style="width:600px;height:350px;background:white;font:60px Arial">CLI FIXTURE</div>');
      const png = await page.locator('div').screenshot();
      await page.route('https://s.cdninstagram.com/**', async route => {
        if(route.request().url().endsWith('two.png')) await new Promise(resolve=>setTimeout(resolve,1000));
        await route.fulfill({contentType:'image/png',body:png});
      });
      await page.route('https://www.instagram.com/p/CLI/', route => route.fulfill({contentType:'text/html',body:
        ${JSON.stringify(html)}}));
      const result = await capturePost(page,'https://www.instagram.com/p/CLI/','https://www.instagram.com/testroom/');
      console.log(JSON.stringify(result));
    } finally {await browser.close();}
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { timeout: 30000 },
  );
  expect(JSON.parse(stdout)).toEqual({
    caption: "CLI fixture caption",
    imageUrls: [
      "https://s.cdninstagram.com/one.png",
      "https://s.cdninstagram.com/two.png",
    ],
    imageSlides: [
      {
        url: "https://s.cdninstagram.com/one.png",
        slide: 1,
        mediaId: "ig:CLI:slide:1:image",
      },
      {
        url: "https://s.cdninstagram.com/two.png",
        slide: 2,
        mediaId: "ig:CLI:slide:2:image",
      },
    ],
  });
}, 35000);
