import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  mediaRetentionMs,
  pendingSpoolCandidateUrls,
  pruneMediaDirectory,
  referencedAssetName,
} from "../scripts/prune-media";

test("prune keeps selected and active references, recent captures, and only removes old unreferenced files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evryvibe-prune-"));
  const now = Date.now();
  const selected = `${randomUUID()}.webp`;
  const active = `${randomUUID()}.webp`;
  const recent = `${randomUUID()}.webp`;
  const terminal = `${randomUUID()}.webp`;
  const orphan = `${randomUUID()}.webp`;
  const unexpected = "session.json";
  try {
    for (const name of [selected, active, recent, terminal, orphan, unexpected])
      await writeFile(join(directory, name), name);
    for (const name of [selected, active, terminal, orphan]) {
      const old = new Date(now - mediaRetentionMs - 1000);
      await utimes(join(directory, name), old, old);
    }
    const result = await pruneMediaDirectory({
      directory,
      retainedUrls: [
        `https://evryvibe.com/media/${selected}`,
        `https://evryvibe.com/media/${active}`,
      ],
      now,
    });
    expect(result).toEqual({ removed: 2, kept: 3 });
    expect((await readdir(directory)).sort()).toEqual(
      [selected, active, recent, unexpected].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pending spool candidates survive pruning before MCP acknowledgement", async () => {
  const root = await mkdtemp(join(tmpdir(), "evryvibe-pending-prune-"));
  const media = join(root, "media");
  const spool = join(root, "collector", randomUUID());
  const name = `${randomUUID()}.webp`;
  try {
    await mkdir(media);
    await mkdir(spool, { recursive: true });
    await writeFile(join(media, name), "candidate");
    const old = new Date(Date.now() - mediaRetentionMs - 1000);
    await utimes(join(media, name), old, old);
    await writeFile(
      join(spool, "1-p_TEST.pending.json"),
      JSON.stringify({
        package: {
          imageCandidates: [{ url: `https://evryvibe.com/media/${name}` }],
        },
      }),
    );
    await writeFile(
      join(spool, "1-p_OLD.sent.json"),
      JSON.stringify({ package: { imageCandidates: [] } }),
    );
    const retainedUrls = await pendingSpoolCandidateUrls(
      join(root, "collector"),
    );
    expect(retainedUrls).toEqual([`https://evryvibe.com/media/${name}`]);
    expect(
      await pruneMediaDirectory({
        directory: media,
        retainedUrls,
      }),
    ).toEqual({ removed: 0, kept: 1 });
    expect(await readdir(media)).toEqual([name]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed pending spool stops pruning before deleting files", async () => {
  const root = await mkdtemp(join(tmpdir(), "evryvibe-bad-spool-"));
  try {
    await writeFile(join(root, "bad.pending.json"), "not json");
    await expect(pendingSpoolCandidateUrls(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only canonical local media URLs can protect an asset", () => {
  const name = `${randomUUID()}.webp`;
  expect(referencedAssetName(`https://evryvibe.com/media/${name}`)).toBe(name);
  for (const value of [
    `https://example.com/media/${name}`,
    `https://evryvibe.com/media/${name}?version=1`,
    `https://evryvibe.com/other/${name}`,
    `https://evryvibe.com/media/../${name}`,
    "not a URL",
  ])
    expect(referencedAssetName(value)).toBeNull();
});
