import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { postPackageSchema, type PostPackage } from "../core/model";
import type { CollectorMcp } from "./mcp";
import { venueSourceSchema, type VenueSource } from "../core/sources";
import {
  collectionDefaults,
  DailyRestError,
  InstagramAccessError,
  sleep,
} from "./pacing";
export type Source = VenueSource;
const sourcesSchema = z.object({ sources: z.array(venueSourceSchema) });
const preparedSchema = z.object({
  venueId: z.uuid(),
  expectedRevision: z.number().int(),
  package: postPackageSchema,
});
async function readPrepared(path: string) {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!raw || typeof raw !== "object" || !("package" in raw))
    return preparedSchema.parse(raw);
  const pack = raw.package;
  if (!pack || typeof pack !== "object") return preparedSchema.parse(raw);
  const { imageUrls, imageCandidates, ...evidence } = z
    .record(z.string(), z.unknown())
    .parse(pack);
  const withCandidates = {
    ...evidence,
    ...(imageCandidates === undefined ? {} : { imageCandidates }),
  };
  const candidatesValid = postPackageSchema.safeParse(withCandidates).success;
  const parsed = preparedSchema.parse({
    ...raw,
    package: candidatesValid ? withCandidates : evidence,
  });
  if (
    imageUrls !== undefined ||
    (imageCandidates !== undefined && !candidatesValid)
  ) {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(parsed), { mode: 0o600 });
    await rename(temporary, path);
  }
  return parsed;
}
export async function collectSources(options: {
  mcp: CollectorMcp;
  capture: (
    source: Source,
    shouldCapture: (postUrl: string) => Promise<boolean>,
  ) => AsyncIterable<PostPackage>;
  stateDir: string;
  onlyVenueSlug?: string;
  sourceDelayMs?: number;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  assertActive?: () => void;
}): Promise<{ sources: number; failed: number }> {
  const { mcp, capture, stateDir } = options;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const assertActive = options.assertActive ?? (() => {});
  const delay = z
    .number()
    .int()
    .min(0)
    .parse(options.sourceDelayMs ?? collectionDefaults.sourceDelayMs);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const cooldownPath = join(stateDir, "cooldown.json");
  const cooldown = await readFile(cooldownPath, "utf8").catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    },
  );
  if (
    cooldown &&
    z.object({ until: z.number() }).parse(JSON.parse(cooldown)).until > now()
  )
    throw new Error(
      "Instagram collection is in its 24-hour access cooldown; retry after it expires",
    );
  const available = sourcesSchema
    .parse(await mcp.call("list_venue_sources", { enabledOnly: true }))
    .sources.filter((source) => source.enabled);
  const selected = options.onlyVenueSlug
    ? available.filter((source) => source.slug === options.onlyVenueSlug)
    : available;
  if (options.onlyVenueSlug && selected.length !== 1)
    throw new Error(`Enabled venue source not found: ${options.onlyVenueSlug}`);
  const sources = selected.sort(
    (a, b) =>
      (a.lastStartedAt ?? "").localeCompare(b.lastStartedAt ?? "") ||
      a.venueId.localeCompare(b.venueId),
  );
  let failed = 0;
  let attempted = 0;
  for (const source of sources) {
    try {
      assertActive();
    } catch (error) {
      if (error instanceof DailyRestError) break;
      throw error;
    }
    if (attempted > 0) await wait(delay);
    try {
      assertActive();
    } catch (error) {
      if (error instanceof DailyRestError) break;
      throw error;
    }
    attempted++;
    const startedAt = new Date(now()).toISOString();
    let stop = false;
    let postsQueued = 0;
    let error: string | null = null;
    const dir = join(stateDir, source.venueId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const knownUrls = new Set<string>();
    async function send(path: string) {
      const value = await readPrepared(path);
      const current = sourcesSchema
        .parse(await mcp.call("list_venue_sources", {}))
        .sources.find((item) => item.venueId === source.venueId);
      if (
        !current?.enabled ||
        current.revision !== value.expectedRevision ||
        current.instagramUrl !== value.package.accountUrl
      ) {
        await rename(path, path.replace(/\.pending\.json$/, ".stale.json"));
        console.error(
          `[collector] ${source.slug}: stale prepared package preserved for inspection`,
        );
        if (value.expectedRevision === source.revision)
          throw new Error(
            "Source changed during collection; submission stopped",
          );
        return;
      }
      const accepted = z
        .object({ created: z.boolean() })
        .parse(await mcp.call("enqueue_collected_package", value));
      await rename(path, path.replace(/\.pending\.json$/, ".sent.json"));
      if (value.package.accountUrl === source.instagramUrl)
        knownUrls.add(value.package.postUrl);
      if (accepted.created) postsQueued++;
    }
    try {
      for (const file of (await readdir(dir)).filter((file) =>
        file.endsWith(".sent.json"),
      )) {
        const sent = await readPrepared(join(dir, file));
        if (
          sent.venueId === source.venueId &&
          sent.package.accountUrl === source.instagramUrl
        )
          knownUrls.add(sent.package.postUrl);
      }
      for (const file of (await readdir(dir)).filter((file) =>
        file.endsWith(".pending.json"),
      )) {
        assertActive();
        await send(join(dir, file));
      }
      const shouldCapture = async (postUrl: string) => !knownUrls.has(postUrl);
      for await (const pack of capture(source, shouldCapture)) {
        const parsed = postPackageSchema.parse(pack);
        const shortcode = new URL(parsed.postUrl).pathname
          .split("/")
          .filter(Boolean)
          .join("_");
        const prefix = `${source.revision}-${shortcode}`;
        if (
          parsed.accountUrl === source.instagramUrl &&
          knownUrls.has(parsed.postUrl)
        )
          continue;
        const path = join(dir, `${prefix}.pending.json`);
        await writeFile(
          `${path}.tmp`,
          JSON.stringify({
            venueId: source.venueId,
            expectedRevision: source.revision,
            package: parsed,
          }),
          { mode: 0o600 },
        );
        await rename(`${path}.tmp`, path);
        assertActive();
        await send(path);
      }
      assertActive();
    } catch (caught) {
      failed++;
      if (caught instanceof DailyRestError) stop = true;
      if (caught instanceof InstagramAccessError) {
        stop = true;
        await writeFile(
          `${cooldownPath}.tmp`,
          JSON.stringify({ until: now() + collectionDefaults.cooldownMs }),
          { mode: 0o600 },
        );
        await rename(`${cooldownPath}.tmp`, cooldownPath);
      }
      error = caught instanceof Error ? caught.message : "Collection failed";
      console.error(
        `[collector] ${source.slug}: ${error.startsWith("MCP ") ? "MCP rejected submission; inspect source state and retry" : error}`,
      );
    }
    await mcp
      .call("record_source_run", {
        venueId: source.venueId,
        expectedRevision: source.revision,
        startedAt,
        finishedAt: new Date(now()).toISOString(),
        postsQueued,
        error: error?.slice(0, 2000) ?? null,
      })
      .catch(() => {
        console.error(
          `[collector] ${source.slug}: run status not recorded; source revision may have changed`,
        );
      });
    if (stop) break;
  }
  return { sources: attempted, failed };
}
