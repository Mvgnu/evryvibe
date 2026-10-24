import { closeDatabase, database } from "../src/db/client";
import { normalizeStoredGenres } from "../src/db/genre-normalization";

// Rewrites stored event and DJ genres to the canonical taxonomy
// (src/core/genres.ts). Dry run by default; --apply writes in one transaction.
//   production: node --env-file=/srv/evryvibe/shared/.env --import tsx \
//     scripts/normalize-genres.ts --apply
const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--apply");
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(" ")}. Use --apply only.`);
  process.exit(2);
}
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL before normalizing genres.");

try {
  const apply = args.includes("--apply");
  const report = await normalizeStoredGenres(database(), { apply });
  const width = Math.max(3, ...report.mappings.map(({ raw }) => raw.length));
  console.log(
    `${"RAW".padEnd(width)}  ${"EVENTS".padStart(6)}  ${"DJS".padStart(5)}  CANONICAL`,
  );
  for (const mapping of report.mappings)
    console.log(
      `${mapping.raw.padEnd(width)}  ${String(mapping.events).padStart(6)}  ${String(mapping.djs).padStart(5)}  ${mapping.canonical ?? "DROPPED"}`,
    );
  console.log("");
  console.log(`mode: ${apply ? "APPLIED" : "dry run (pass --apply to write)"}`);
  console.log(
    `events: ${report.eventsChanged} of ${report.eventsTotal} rows ${apply ? "changed" : "would change"}, ${report.eventsEmptied} left without a genre`,
  );
  console.log(
    `djs: ${report.djsChanged} of ${report.djsTotal} rows ${apply ? "changed" : "would change"}, ${report.djsEmptied} left without a genre`,
  );
  console.log(`genres dropped (occurrences): ${report.genresDropped}`);
} finally {
  await closeDatabase();
}
