import { lstat, readFile, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { siteUrl } from "../src/core/site";

// Legacy cleanup only. New collector packages contain OCR and source permalinks,
// not media candidates. Keep referenced old assets until published records and
// backups have been reconciled; never delete them as part of schema rollout.
const assetName =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$/;
export const mediaRetentionMs = 7 * 24 * 60 * 60 * 1000;

export function referencedAssetName(value: string): string | null {
  try {
    const url = new URL(value);
    const name = url.pathname.slice("/media/".length);
    return url.origin === siteUrl &&
      url.pathname === `/media/${name}` &&
      !url.search &&
      !url.hash &&
      assetName.test(name)
      ? name
      : null;
  } catch {
    return null;
  }
}

/** Pending spool work may not have reached the package table yet. */
export async function pendingSpoolCandidateUrls(
  directory: string,
): Promise<string[]> {
  const urls: string[] = [];
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT" &&
          path === directory
        )
          return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".pending.json")) continue;
      const value: unknown = JSON.parse(await readFile(child, "utf8"));
      if (!value || typeof value !== "object" || !("package" in value))
        throw new Error("Malformed pending collector spool file");
      const pack = value.package;
      if (!pack || typeof pack !== "object")
        throw new Error("Malformed pending collector spool package");
      if (!("imageCandidates" in pack) || pack.imageCandidates === undefined)
        continue;
      if (!Array.isArray(pack.imageCandidates))
        throw new Error("Malformed pending collector image candidates");
      for (const candidate of pack.imageCandidates) {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          !("url" in candidate) ||
          typeof candidate.url !== "string"
        )
          throw new Error("Malformed pending collector image candidate");
        urls.push(candidate.url);
      }
    }
  }
  await visit(directory);
  return urls;
}

/** Caller must exclude concurrent collector writes and hold DB write locks. */
export async function pruneMediaDirectory(options: {
  directory: string;
  retainedUrls: Iterable<string>;
  now?: number;
  retentionMs?: number;
}): Promise<{ removed: number; kept: number }> {
  const now = options.now ?? Date.now();
  const retentionMs = options.retentionMs ?? mediaRetentionMs;
  if (!Number.isFinite(now) || !Number.isFinite(retentionMs) || retentionMs < 0)
    throw new Error("Invalid media retention time");
  const keep = new Set<string>();
  for (const url of options.retainedUrls) {
    const name = referencedAssetName(url);
    if (name) keep.add(name);
  }
  const entries = await readdir(options.directory, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  });
  let removed = 0;
  let kept = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !assetName.test(entry.name)) continue;
    if (keep.has(entry.name)) {
      kept++;
      continue;
    }
    const path = join(options.directory, entry.name);
    const stat = await lstat(path);
    if (!stat.isFile() || now - stat.mtimeMs < retentionMs) {
      kept++;
      continue;
    }
    await unlink(path);
    removed++;
  }
  return { removed, kept };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const directory = resolve(process.env.EVRYVIBE_MEDIA_DIR ?? ".local/media");
  const pendingUrls = await pendingSpoolCandidateUrls(
    resolve(".local/collector"),
  );
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const result = await sql.begin(async (transaction) => {
      // A package status or published image cannot change between the reference
      // snapshot and unlink. The backup wrapper also holds collector.lock.
      await transaction`LOCK TABLE events, venues, djs, post_packages IN SHARE MODE`;
      const rows = await transaction<{ url: string }[]>`
        SELECT image_url AS url FROM events WHERE image_url IS NOT NULL
        UNION SELECT image_url AS url FROM venues WHERE image_url IS NOT NULL
        UNION SELECT image_url AS url FROM djs WHERE image_url IS NOT NULL
        UNION SELECT candidate.value->>'url' AS url
          FROM post_packages AS p,
               LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p.payload->'imageCandidates') = 'array'
                   THEN p.payload->'imageCandidates' ELSE '[]'::jsonb END
               ) AS candidate(value)
          WHERE p.state IN ('pending', 'processing', 'deferred')
             OR p.updated_at >= now() - interval '7 days'
      `;
      return pruneMediaDirectory({
        directory,
        retainedUrls: [
          ...pendingUrls,
          ...rows
            .map((row) => row.url)
            .filter((url): url is string => typeof url === "string"),
        ],
      });
    });
    console.log(
      `Media prune: ${result.removed} removed, ${result.kept} retained`,
    );
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
