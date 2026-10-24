import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { catalogUpdateRepository } from "../src/db/catalog-updates";
import { ingestionRepository } from "../src/db/ingestion";
import { djs, venues } from "../src/db/schema";
import { soundcloudOembedVerifier } from "../src/core/soundcloud-oembed";
import {
  fakeSoundcloud,
  postSource,
  testDj,
  testEvent,
  testVenue,
} from "./support/backend";

describe("SoundCloud oEmbed verifier", () => {
  const profile = "https://soundcloud.com/some-dj";
  it("asks oEmbed for the canonical profile and trims the bio excerpt", async () => {
    let requested = "";
    const verifier = soundcloudOembedVerifier(async (input) => {
      requested = String(input);
      return Response.json({
        title: "Some DJ on SoundCloud",
        description: `${"Bio ".repeat(200)}`,
      });
    });
    const evidence = await verifier.verify(profile);
    const url = new URL(requested);
    expect(url.origin + url.pathname).toBe("https://soundcloud.com/oembed");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("url")).toBe(profile);
    expect(evidence).toMatchObject({
      url: profile,
      title: "Some DJ on SoundCloud",
    });
    expect(evidence.bioExcerpt.length).toBeLessThanOrEqual(400);
  });
  it("accepts a profile without a bio (SoundCloud sends description null)", async () => {
    const evidence = await soundcloudOembedVerifier(async () =>
      Response.json({ title: "eliano", description: null }),
    ).verify(profile);
    expect(evidence).toEqual({ url: profile, title: "eliano", bioExcerpt: "" });
  });
  it("never blocks: 404, outages and odd replies echo empty evidence", async () => {
    const empty = { url: profile, title: "", bioExcerpt: "" };
    for (const fetcher of [
      async () => new Response("", { status: 404 }),
      async () => new Response("", { status: 503 }),
      async () => new Response("<html>", { status: 200 }),
      async () => Response.json([1, 2]),
      async (): Promise<Response> => {
        throw new Error("network down");
      },
    ])
      await expect(
        soundcloudOembedVerifier(fetcher).verify(profile),
      ).resolves.toEqual(empty);
  });
});

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("SoundCloud write path on Postgres", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const probe = connectDatabase(url ?? "postgres://unused");
  // The fake checks, from a second connection, that no transaction or
  // catalogue lock is open while SoundCloud is being asked.
  const openTransactions: number[] = [];
  const soundcloud = fakeSoundcloud(
    {
      "https://soundcloud.com/test-dj": {
        title: "Test DJ",
        bio: "Berlin techno, IG @test_dj",
      },
      "https://soundcloud.com/other-dj": { title: "Other", bio: "" },
      "https://soundcloud.com/test-room": { title: "Test Room", bio: "Club" },
    },
    async () => {
      const [row] = await probe.db.execute<{ open: number }>(
        sql`SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`,
      );
      openTransactions.push(row?.open ?? -1);
    },
  );
  const deps = { soundcloud };
  const ingestion = ingestionRepository(connection.db, deps);
  const updates = catalogUpdateRepository(connection.db, deps);
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error(
        "Tests require an explicitly named disposable test database",
      );
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages, reconciliation_tasks CASCADE`,
    );
    soundcloud.calls.length = 0;
    soundcloud.down = false;
    openTransactions.length = 0;
  });
  afterAll(async () => {
    await connection.close();
    await probe.close();
  });
  async function publish(bundle: unknown, code = "ScPost") {
    await ingestion.enqueue(postSource(code, "2026-12-01T10:00:00Z"));
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("Expected work");
    return ingestion.complete(claim.package.id, claim.claimToken, bundle);
  }
  const bundle = (dj: object = {}, venue: object = {}) => ({
    venues: [{ ...testVenue, ...venue }],
    djs: [{ ...testDj, ...dj }],
    events: [testEvent],
  });
  const storedDj = async () =>
    (await connection.db.select().from(djs).where(eq(djs.slug, "test-dj")))[0];

  it("verifies a new profile outside any transaction and echoes the evidence", async () => {
    const result = await publish(
      bundle({ soundcloudUrl: "https://soundcloud.com/test-dj" }),
    );
    expect(result).toMatchObject({
      replayed: false,
      soundcloud: [
        {
          entity: "dj",
          slug: "test-dj",
          url: "https://soundcloud.com/test-dj",
          title: "Test DJ",
          bioExcerpt: "Berlin techno, IG @test_dj",
        },
      ],
    });
    expect((await storedDj())?.soundcloudUrl).toBe(
      "https://soundcloud.com/test-dj",
    );
    expect(openTransactions).toEqual([0]);
  });

  it("keeps the stored profile when omitted, clears on null, and never re-verifies unchanged values", async () => {
    await publish(
      bundle({ soundcloudUrl: "https://soundcloud.com/test-dj" }),
      "One",
    );
    expect(soundcloud.calls).toHaveLength(1);
    await publish(bundle({ description: "Neue Bio ohne Event." }), "Two");
    expect((await storedDj())?.soundcloudUrl).toBe(
      "https://soundcloud.com/test-dj",
    );
    await publish(
      bundle({ soundcloudUrl: "https://soundcloud.com/test-dj" }),
      "Three",
    );
    expect(soundcloud.calls).toHaveLength(1);
    await publish(bundle({ soundcloudUrl: null }), "Four");
    expect((await storedDj())?.soundcloudUrl).toBeNull();
  });

  it("stores null for omitted soundcloudUrl on insert", async () => {
    await publish(bundle());
    expect((await storedDj())?.soundcloudUrl).toBeNull();
    expect(soundcloud.calls).toHaveLength(0);
  });

  it("update_dj: omitted keeps, null clears, and an unknown profile or outage never blocks", async () => {
    await publish(bundle({ soundcloudUrl: "https://soundcloud.com/test-dj" }));
    const dj = await storedDj();
    if (!dj) throw new Error("DJ missing");
    const kept = await updates.updateDj({
      djId: dj.id,
      changes: { genres: ["House"] },
    });
    expect(kept.soundcloudUrl).toBe("https://soundcloud.com/test-dj");
    expect(kept).not.toHaveProperty("soundcloud");
    const unknown = await updates.updateDj({
      djId: dj.id,
      changes: { soundcloudUrl: "https://soundcloud.com/ghost" },
    });
    expect(unknown).toMatchObject({
      soundcloudUrl: "https://soundcloud.com/ghost",
      soundcloud: { url: "https://soundcloud.com/ghost", title: "" },
    });
    soundcloud.down = true;
    const offline = await updates.updateDj({
      djId: dj.id,
      changes: { soundcloudUrl: "https://soundcloud.com/test-dj" },
    });
    expect(offline.soundcloud).toEqual({
      url: "https://soundcloud.com/test-dj",
      title: "",
      bioExcerpt: "",
    });
    soundcloud.down = false;
    expect((await storedDj())?.soundcloudUrl).toBe(
      "https://soundcloud.com/test-dj",
    );
    const changed = await updates.updateDj({
      djId: dj.id,
      changes: { soundcloudUrl: "https://soundcloud.com/other-dj" },
    });
    expect(changed).toMatchObject({
      soundcloud: { url: "https://soundcloud.com/other-dj", title: "Other" },
    });
    const cleared = await updates.updateDj({
      djId: dj.id,
      changes: { soundcloudUrl: null },
    });
    expect(cleared.soundcloudUrl).toBeNull();
  });

  it("rejects a profile that already belongs to another DJ and names the other slug", async () => {
    await ingestion.upsertVenue(testVenue);
    await publish({
      venues: [testVenue],
      djs: [
        { ...testDj, soundcloudUrl: "https://soundcloud.com/test-dj" },
        { ...testDj, slug: "second-dj", name: "Second", instagramUrl: null },
      ],
      events: [testEvent],
    });
    const [second] = await connection.db
      .select()
      .from(djs)
      .where(eq(djs.slug, "second-dj"));
    if (!second) throw new Error("DJ missing");
    await expect(
      updates.updateDj({
        djId: second.id,
        changes: { soundcloudUrl: "https://soundcloud.com/test-dj" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict", message: /test-dj/ });
    await expect(
      publish(
        {
          venues: [testVenue],
          djs: [
            {
              ...testDj,
              slug: "second-dj",
              name: "Second",
              instagramUrl: null,
              soundcloudUrl: "https://soundcloud.com/test-dj",
            },
          ],
          events: [
            {
              ...testEvent,
              slug: "later",
              startsAt: "2027-01-02T23:00:00+01:00",
              endsAt: null,
            },
          ],
        },
        "Conflict",
      ),
    ).rejects.toMatchObject({ code: "identity_conflict", message: /test-dj/ });
  });

  it("update_venue changes selected fields, keeps the rest, and protects identity fields", async () => {
    const venue = await ingestion.upsertVenue({
      ...testVenue,
      soundcloudUrl: "https://soundcloud.com/test-room",
    });
    expect(venue).toMatchObject({ soundcloud: { title: "Test Room" } });
    const [stored] = await connection.db.select().from(venues);
    if (!stored) throw new Error("Venue missing");
    const changed = await updates.updateVenue({
      venueId: stored.id,
      changes: { description: "Ein Club in Berlin." },
    });
    expect(changed).toMatchObject({
      slug: "test-room",
      description: "Ein Club in Berlin.",
      soundcloudUrl: "https://soundcloud.com/test-room",
      instagramUrl: "https://www.instagram.com/test_room/",
    });
    for (const changes of [
      { slug: "new-slug" },
      { instagramUrl: "https://www.instagram.com/x/" },
      {},
    ]) {
      await expect(
        updates.updateVenue({ venueId: stored.id, changes }),
      ).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    const cleared = await updates.updateVenue({
      venueId: stored.id,
      changes: { soundcloudUrl: null },
    });
    expect(cleared.soundcloudUrl).toBeNull();
    await expect(
      updates.updateVenue({
        venueId: "00000000-0000-4000-8000-000000000000",
        changes: { city: "X" },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("upsert_venue keeps the stored profile when omitted and returns warnings for event-note descriptions", async () => {
    await ingestion.upsertVenue({
      ...testVenue,
      soundcloudUrl: "https://soundcloud.com/test-room",
    });
    const again = await ingestion.upsertVenue({
      ...testVenue,
      description: "Am 12. Oktober 2026 spielt hier Anna im Line-up.",
    });
    expect(again.soundcloudUrl).toBe("https://soundcloud.com/test-room");
    expect(again).toHaveProperty("warnings");
    expect(again).not.toHaveProperty("soundcloud");
  });
});
