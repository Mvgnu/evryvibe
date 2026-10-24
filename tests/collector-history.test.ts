import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { collectSources, type Source } from "../src/collector/runner";

test("only acknowledged history for the current account skips posts and stories across revisions", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "collector-history-"));
  const source: Source = {
    venueId: randomUUID(),
    slug: "fixture",
    name: "Fixture",
    city: "Berlin",
    instagramUrl: "https://www.instagram.com/fixture/",
    enabled: true,
    revision: 4,
    lastStartedAt: null,
    lastSucceededAt: null,
    lastError: null,
    lastPostCount: 0,
  };
  const sentPost = "https://www.instagram.com/p/KNOWN/";
  const sentStory = "https://www.instagram.com/stories/fixture/123456/";
  const pendingPost = "https://www.instagram.com/p/PENDING/";
  const otherAccountPost = "https://www.instagram.com/p/OTHER/";
  const dir = join(stateDir, source.venueId);
  await mkdir(dir);
  const store = async (
    filename: string,
    postUrl: string,
    accountUrl = source.instagramUrl,
  ) =>
    writeFile(
      join(dir, filename),
      JSON.stringify({
        venueId: source.venueId,
        expectedRevision: 1,
        package: {
          postUrl,
          accountUrl,
          caption: "fixture",
          ocrText: "fixture",
          imageUrls: ["https://s.cdninstagram.com/legacy.jpg"],
          imageCandidates: [{ url: "https://evryvibe.com/media/legacy.webp" }],
          capturedAt: new Date().toISOString(),
        },
      }),
    );
  try {
    await store("1-p_KNOWN.sent.json", sentPost);
    await store("1-stories_fixture_123456.sent.json", sentStory);
    await store("1-p_PENDING.pending.json", pendingPost);
    await store(
      "1-p_OTHER.sent.json",
      otherAccountPost,
      "https://www.instagram.com/oldaccount/",
    );
    const decisions: boolean[] = [];
    const mcp = {
      call: async (name: string) =>
        name === "list_venue_sources" ? { sources: [source] } : {},
      close: async () => {},
    };
    expect(
      await collectSources({
        mcp,
        stateDir,
        capture: async function* (_, shouldCapture) {
          for (const url of [
            sentPost,
            sentStory,
            pendingPost,
            otherAccountPost,
          ])
            decisions.push(await shouldCapture(url));
        },
      }),
    ).toEqual({ sources: 1, failed: 0 });
    expect(decisions).toEqual([false, false, true, true]);
    for (const name of ["1-p_KNOWN.sent.json", "1-p_PENDING.stale.json"]) {
      const saved = await readFile(join(dir, name), "utf8");
      expect(saved).not.toContain("cdninstagram.com");
      expect(saved).not.toContain("/media/");
    }
    source.instagramUrl = "https://www.instagram.com/newaccount/";
    source.revision++;
    const changed: boolean[] = [];
    await collectSources({
      mcp,
      stateDir,
      capture: async function* (_, shouldCapture) {
        changed.push(await shouldCapture(sentPost));
      },
    });
    expect(changed).toEqual([true]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
