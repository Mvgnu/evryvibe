import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { chromium } from "playwright";
import { collectSources, type Source } from "../src/collector/runner";
import { captureProfile, capturePost } from "../src/collector/instagram";
import {
  collectionDefaults,
  assertOutsideDailyRest,
  dailyRestWindow,
  DailyRestError,
  InstagramAccessError,
  isDailyRest,
} from "../src/collector/pacing";

const source = (lastStartedAt: string | null): Source => ({
  venueId: randomUUID(),
  slug: "fixture",
  name: "Fixture",
  city: "Berlin",
  instagramUrl: "https://www.instagram.com/fixture/",
  enabled: true,
  revision: 1,
  lastStartedAt,
  lastSucceededAt: null,
  lastError: null,
  lastPostCount: 0,
});
test("all enabled sources run sequentially with ten-second gaps even across days", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collector-pacing-"));
  const sources = Array.from({ length: 25 }, (_, index) =>
    source(new Date(index * 1000).toISOString()),
  );
  let now = Date.parse("2026-09-22T00:00:00Z");
  const sequence: string[] = [];
  const wait = vi.fn(async (ms: number) => {
    sequence.push("wait");
    now += ms;
  });
  const call = vi.fn(async (name: string) =>
    name === "list_venue_sources" ? { sources: [...sources].reverse() } : {},
  );
  const capture = async function* (item: Source) {
    sequence.push(item.venueId);
    now += 24 * 60 * 60_000;
  };
  try {
    expect(
      await collectSources({
        mcp: { call, close: async () => {} },
        capture,
        stateDir: dir,
        wait,
        now: () => now,
      }),
    ).toEqual({ sources: 25, failed: 0 });
    expect(sequence).toEqual(
      sources.flatMap((item, index) =>
        index ? ["wait", item.venueId] : [item.venueId],
      ),
    );
    expect(wait).toHaveBeenCalledTimes(24);
    expect(wait).toHaveBeenCalledWith(10_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("access restriction records failure, stops remaining sources and persists cooldown across runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collector-cooldown-"));
  const sources = [source(null), source(null)];
  const call = vi.fn(async (name: string) =>
    name === "list_venue_sources" ? { sources } : {},
  );
  let captures = 0;
  const capture = async function* () {
    captures++;
    throw new InstagramAccessError("checkpoint");
  };
  const options = {
    mcp: { call, close: async () => {} },
    capture,
    stateDir: dir,
    now: () => 1000,
  };
  try {
    expect(await collectSources(options)).toEqual({ sources: 1, failed: 1 });
    expect(call).toHaveBeenLastCalledWith(
      "record_source_run",
      expect.objectContaining({ error: "checkpoint" }),
    );
    expect(
      JSON.parse(await readFile(join(dir, "cooldown.json"), "utf8")),
    ).toEqual({ until: 1000 + collectionDefaults.cooldownMs });
    await expect(collectSources(options)).rejects.toThrow("cooldown");
    expect(captures).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("daily Berlin rest varies by date, spans 6–10 hours around 12:30 and handles DST", () => {
  const windows = Array.from({ length: 31 }, (_, index) =>
    dailyRestWindow(new Date(Date.UTC(2026, 6, index + 1, 12))),
  );
  expect(
    new Set(windows.map(({ durationMinutes }) => durationMinutes)).size,
  ).toBeGreaterThan(10);
  for (const window of windows) {
    expect(window.durationMinutes).toBeGreaterThanOrEqual(360);
    expect(window.durationMinutes).toBeLessThanOrEqual(600);
    expect(window.startMinutes + window.endMinutes).toBe(25 * 60);
  }
  for (const day of ["2026-03-29", "2026-10-25"]) {
    const morning = new Date(`${day}T06:00:00Z`);
    const noon = new Date(`${day}T11:30:00Z`);
    const evening = new Date(`${day}T18:00:00Z`);
    expect(dailyRestWindow(morning)).toEqual(dailyRestWindow(noon));
    expect(isDailyRest(noon)).toBe(true);
    expect(isDailyRest(evening)).toBe(false);
  }
  const midday = new Date("2026-07-01T10:30:00Z");
  expect(() => assertOutsideDailyRest(midday)).toThrow(DailyRestError);
});
test("mid-run rest preserves yielded package, stops later sources and records no false success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "collector-rest-"));
  const sources = [source(null), source(null)].sort((a, b) =>
    a.venueId.localeCompare(b.venueId),
  );
  let now = Date.parse("2026-09-22T00:00:00Z");
  const call = vi.fn(async (name: string) =>
    name === "list_venue_sources" ? { sources } : { created: true },
  );
  const capture = async function* (item: Source) {
    now = Date.parse("2026-09-22T10:30:00Z");
    yield {
      postUrl: "https://www.instagram.com/p/RESTTEST/",
      accountUrl: item.instagramUrl ?? "",
      caption: "fixture",
      ocrText: "fixture",
      capturedAt: new Date(now).toISOString(),
    };
  };
  try {
    expect(
      await collectSources({
        mcp: { call, close: async () => {} },
        capture,
        stateDir: dir,
        now: () => now,
        assertActive: () => assertOutsideDailyRest(new Date(now)),
      }),
    ).toEqual({ sources: 1, failed: 1 });
    expect(
      (await readdir(join(dir, sources[0]!.venueId))).some((file) =>
        file.endsWith(".pending.json"),
      ),
    ).toBe(true);
    expect(call).not.toHaveBeenCalledWith(
      "enqueue_collected_package",
      expect.anything(),
    );
    expect(call).toHaveBeenCalledWith(
      "record_source_run",
      expect.objectContaining({
        error: expect.stringContaining("rest window"),
      }),
    );
    expect(call).not.toHaveBeenCalledWith(
      "record_source_run",
      expect.objectContaining({ venueId: sources[1]!.venueId }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("profile skips sent pinned posts before navigating, waits before new posts and stops on rate limits", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const item = source(null);
  const navigated: string[] = [];
  const wait = vi.fn(async () => {});
  try {
    await context.route("https://www.instagram.com/**", (route) => {
      const url = route.request().url();
      navigated.push(url);
      return route.fulfill({
        status: url.includes("/NEW/") ? 429 : 200,
        contentType: "text/html",
        body: url.includes("/stories/")
          ? '<script type="application/json">{"user":{"username":"fixture"},"items":[]}</script><main>No active stories</main>'
          : '<main><a href="/p/PINNED/">Pinned</a><a href="/p/NEW/">New</a></main>',
      });
    });
    const iterator = captureProfile(context, item, {
      beforePost: wait,
      shouldCapture: async (url) => !url.includes("PINNED"),
    });
    await expect(iterator.next()).rejects.toBeInstanceOf(InstagramAccessError);
    expect(navigated).toEqual([
      "https://www.instagram.com/stories/fixture/",
      item.instagramUrl,
      "https://www.instagram.com/p/NEW/",
    ]);
    expect(wait).toHaveBeenCalledOnce();
    const page = await context.newPage();
    await context.route("https://www.instagram.com/p/TEXT/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "Please wait a few minutes before you try again.",
      }),
    );
    await expect(
      capturePost(
        page,
        "https://www.instagram.com/p/TEXT/",
        item.instagramUrl ?? "",
      ),
    ).rejects.toBeInstanceOf(InstagramAccessError);
  } finally {
    await browser.close();
  }
});
