import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { searchGeocoding } from "../src/db/geocoding";
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("shared geocoding limiter and cache", () => {
  const c = connectDatabase(url ?? "postgres://unused");
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error("Disposable test database required");
    await migrate(c.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await c.db.execute(sql`TRUNCATE geocode_cache`);
  });
  afterAll(() => c.close());
  it("caches a result and rejects concurrent distinct searches before a second provider request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json([
        {
          osm_type: "node",
          osm_id: 1,
          display_name: "Club, Berlin",
          lat: "52.5",
          lon: "13.4",
        },
      ]),
    );
    const [a, b] = await Promise.all([
      searchGeocoding(c.db, { query: "Club Berlin" }, { fetcher }),
      searchGeocoding(c.db, { query: "Venue Hamburg" }, { fetcher }),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["ok", "rate_limited"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [slot] = await c.db.execute(
      sql`SELECT EXTRACT(EPOCH FROM clock_timestamp() - fetched_at)::float8 AS age FROM geocode_cache WHERE key = '_request_rate'`,
    );
    expect(Number(slot?.age)).toBeGreaterThan(7);
    const cachedQuery = a.kind === "ok" ? "Club Berlin" : "Venue Hamburg";
    const cached = await searchGeocoding(
      c.db,
      { query: cachedQuery },
      { fetcher },
    );
    expect(cached.kind).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("consumes the provider rate slot even when the request fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    expect(
      await searchGeocoding(c.db, { query: "Club Berlin" }, { fetcher }),
    ).toEqual({ kind: "unavailable" });
    expect(
      await searchGeocoding(c.db, { query: "Another Club" }, { fetcher }),
    ).toEqual({ kind: "rate_limited" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
