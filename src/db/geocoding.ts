import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  geocodeQuerySchema,
  geocodeResultsSchema,
  parseNominatimResponse,
  type GeocodeResult,
} from "../core/geocoding";
import type { Database } from "./client";
import { geocodeCache } from "./schema";

const lockKey = 7349502;
const rateKey = "_request_rate";
const userAgent = "EVRYVIBE/1.0 (https://evryvibe.com; info@evryvibe.com)";
type Result =
  | { kind: "ok"; results: GeocodeResult[] }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

/** One explicit search; no autocomplete or background/bulk geocoding. */
export async function searchGeocoding(
  db: Database,
  input: unknown,
  options: { endpoint?: string; fetcher?: typeof fetch } = {},
): Promise<Result> {
  const parsed = geocodeQuerySchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid search query");
  const endpoint = new URL(
    options.endpoint ??
      process.env.EVRYVIBE_GEOCODER_URL ??
      "https://nominatim.openstreetmap.org/search",
  );
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new Error("Invalid geocoding endpoint configuration");
  const cacheKey = createHash("sha256")
    .update(endpoint.href)
    .update("\0")
    .update(parsed.data.query.toLocaleLowerCase("de-DE"))
    .digest("hex");
  const [cached] = await db
    .select({ results: geocodeCache.results })
    .from(geocodeCache)
    .where(
      and(
        eq(geocodeCache.key, cacheKey),
        gt(geocodeCache.fetchedAt, sql`clock_timestamp() - interval '30 days'`),
      ),
    );
  const result = cached && geocodeResultsSchema.safeParse(cached.results);
  if (result && result.success) return { kind: "ok", results: result.data };
  // A database advisory lock serializes all app processes. Reserve a slot in a
  // committed transaction before calling the provider; even a crashed worker
  // cannot immediately issue another request. The slot is conservatively held
  // for the whole request timeout plus one second.
  const reserved = await db.transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked`,
    );
    if (rows[0]?.locked !== true) return null;
    const [recent] = await tx
      .select({ key: geocodeCache.key })
      .from(geocodeCache)
      .where(
        and(
          eq(geocodeCache.key, rateKey),
          gt(
            geocodeCache.fetchedAt,
            sql`clock_timestamp() - interval '9100 milliseconds'`,
          ),
        ),
      );
    if (recent) return null;
    const [reservation] = await tx
      .insert(geocodeCache)
      .values({
        key: rateKey,
        query: "",
        results: [],
        fetchedAt: sql`clock_timestamp()`,
      })
      .onConflictDoUpdate({
        target: geocodeCache.key,
        set: { fetchedAt: sql`clock_timestamp()` },
      })
      .returning({ fetchedAt: geocodeCache.fetchedAt });
    return reservation?.fetchedAt ?? null;
  });
  if (!reserved) return { kind: "rate_limited" };
  endpoint.searchParams.set("q", parsed.data.query);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("limit", "5");
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok || !response.body) return { kind: "unavailable" };
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > 100_000))
      return { kind: "unavailable" };
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > 100_000) {
          await reader.cancel();
          return { kind: "unavailable" };
        }
        parts.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const data: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const results = parseNominatimResponse(data);
    await db
      .insert(geocodeCache)
      .values({
        key: cacheKey,
        query: parsed.data.query,
        results,
        fetchedAt: sql`clock_timestamp()`,
      })
      .onConflictDoUpdate({
        target: geocodeCache.key,
        set: {
          query: parsed.data.query,
          results,
          fetchedAt: sql`clock_timestamp()`,
        },
      });
    // A completed request can free the slot earlier, while still imposing one
    // full second after the provider responded. A crash retains the 9.1s slot.
    await db
      .update(geocodeCache)
      .set({ fetchedAt: sql`clock_timestamp() - interval '8 seconds'` })
      .where(
        and(
          eq(geocodeCache.key, rateKey),
          eq(geocodeCache.fetchedAt, reserved),
        ),
      );
    return { kind: "ok", results };
  } catch {
    return { kind: "unavailable" };
  }
}
