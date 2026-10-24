import { eq, sql } from "drizzle-orm";
import { canonicalGenre, normalizeGenres } from "../core/genres";
import type { Database } from "./client";
import { djs, events } from "./schema";

type Row = { id: string; genres: string[] };
type Source = Pick<Database, "select">;

export type GenreMapping = {
  raw: string;
  // Canonical name, or null when the spelling is dropped.
  canonical: string | null;
  events: number;
  djs: number;
};

export type GenreNormalizationReport = {
  mappings: GenreMapping[];
  eventsChanged: number;
  djsChanged: number;
  eventsTotal: number;
  djsTotal: number;
  // Spellings removed (dropped), counted per occurrence.
  genresDropped: number;
  // Rows that had genres and have none after normalising.
  eventsEmptied: number;
  djsEmptied: number;
  applied: boolean;
};

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

async function readRows(source: Source) {
  const eventRows: Row[] = await source
    .select({ id: events.id, genres: events.genres })
    .from(events);
  const djRows: Row[] = await source
    .select({ id: djs.id, genres: djs.genres })
    .from(djs);
  return { eventRows, djRows };
}

function plan(eventRows: Row[], djRows: Row[]) {
  const mappings = new Map<string, GenreMapping>();
  const count = (rows: Row[], field: "events" | "djs") => {
    for (const row of rows)
      for (const raw of new Set(row.genres)) {
        const entry = mappings.get(raw) ?? {
          raw,
          canonical: canonicalGenre(raw)?.name ?? null,
          events: 0,
          djs: 0,
        };
        entry[field] += 1;
        mappings.set(raw, entry);
      }
  };
  count(eventRows, "events");
  count(djRows, "djs");
  const next = (rows: Row[]) =>
    rows
      .map((row) => ({ row, genres: normalizeGenres(row.genres).genres }))
      .filter(({ row, genres }) => !same(row.genres, genres));
  const eventChanges = next(eventRows);
  const djChanges = next(djRows);
  const dropped = (rows: Row[]) =>
    rows.reduce(
      (total, row) =>
        total + row.genres.filter((raw) => canonicalGenre(raw) === null).length,
      0,
    );
  const emptied = (changes: ReturnType<typeof next>) =>
    changes.filter(({ row, genres }) => row.genres.length && !genres.length)
      .length;
  return {
    eventChanges,
    djChanges,
    report: {
      mappings: [...mappings.values()].sort(
        (a, b) =>
          b.events + b.djs - (a.events + a.djs) || a.raw.localeCompare(b.raw),
      ),
      eventsChanged: eventChanges.length,
      djsChanged: djChanges.length,
      eventsTotal: eventRows.length,
      djsTotal: djRows.length,
      genresDropped: dropped(eventRows) + dropped(djRows),
      eventsEmptied: emptied(eventChanges),
      djsEmptied: emptied(djChanges),
    },
  };
}

/**
 * Rewrites events.genres and djs.genres to canonical names. A dry run only
 * reports; applying runs in one transaction under the catalogue advisory lock
 * and is idempotent (a second run changes no rows).
 */
export async function normalizeStoredGenres(
  db: Database,
  options: { apply: boolean },
): Promise<GenreNormalizationReport> {
  if (!options.apply) {
    const { eventRows, djRows } = await readRows(db);
    return { ...plan(eventRows, djRows).report, applied: false };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
    const { eventRows, djRows } = await readRows(tx);
    const { eventChanges, djChanges, report } = plan(eventRows, djRows);
    for (const { row, genres } of eventChanges)
      await tx.update(events).set({ genres }).where(eq(events.id, row.id));
    for (const { row, genres } of djChanges)
      await tx.update(djs).set({ genres }).where(eq(djs.id, row.id));
    return { ...report, applied: true };
  });
}
