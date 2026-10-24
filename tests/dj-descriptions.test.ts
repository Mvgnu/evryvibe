import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { catalogUpdateRepository } from "../src/db/catalog-updates";
import { ingestionRepository } from "../src/db/ingestion";
import { djs, venues } from "../src/db/schema";
import {
  fakeSoundcloud,
  postSource,
  testDj,
  testEvent,
  testVenue,
} from "./support/backend";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("DJ bios survive repeated lineups", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const deps = { soundcloud: fakeSoundcloud({}) };
  const ingestion = ingestionRepository(connection.db, deps);
  const updates = catalogUpdateRepository(connection.db, deps);
  const bio =
    "Test DJ ist ein Berliner DJ mit Fokus auf Dub Techno und Breaks.";
  const eventNote =
    "Test DJ steht bei Electric Grooves im Tanzhaus West im Line-up.";
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
  });
  afterAll(() => connection.close());
  let counter = 0;
  async function publish(dj: object) {
    const code = `Bio${counter++}`;
    await ingestion.enqueue(postSource(code, "2026-12-01T10:00:00Z"));
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("work");
    return ingestion.complete(claim.package.id, claim.claimToken, {
      venues: [testVenue],
      djs: [dj],
      events: [
        {
          ...testEvent,
          slug: `night-${code.toLowerCase()}`,
          startsAt: `2027-0${(counter % 8) + 1}-10T23:00:00+01:00`,
          endsAt: null,
        },
      ],
    });
  }
  const stored = async () => {
    const [row] = await connection.db
      .select()
      .from(djs)
      .where(eq(djs.slug, "test-dj"));
    if (!row) throw new Error("dj");
    return row;
  };
  const { description: _description, genres: _genres, ...withoutBio } = testDj;
  void _description;
  void _genres;

  it("keeps description and genres when a bundle repeats the DJ without them, and defaults them on insert", async () => {
    await publish(withoutBio);
    expect(await stored()).toMatchObject({ description: "", genres: [] });
    await publish({ ...testDj, description: bio, genres: ["Dub Techno"] });
    await publish(withoutBio);
    expect(await stored()).toMatchObject({
      description: bio,
      genres: ["Dub Techno"],
    });
  });

  it("never replaces a clean stored bio with an event note or filler, and says so", async () => {
    await publish({
      ...testDj,
      description: bio,
      translations: { en: { description: "A Berlin DJ." } },
    });
    for (const weak of [
      eventNote,
      "Test DJ ist als DJ im elektronischen Clubbereich aktiv.",
    ]) {
      const result = await publish({
        ...testDj,
        description: weak,
        translations: { en: { description: weak } },
      });
      expect(result.warnings?.[0]).toMatch(
        /dj test-dj: description not written/,
      );
      expect(await stored()).toMatchObject({
        description: bio,
        translations: { en: { description: "A Berlin DJ." } },
      });
    }
    // A bad stored description may be replaced by anything, and a real bio may replace a real bio.
    await publish({
      ...testDj,
      description: "Test DJ ist ein Berliner DJ und Produzent.",
    });
    expect((await stored()).description).toBe(
      "Test DJ ist ein Berliner DJ und Produzent.",
    );
  });

  it("applies the same rule in update_dj, except that an explicit empty description clears", async () => {
    await publish({ ...testDj, description: bio });
    const { id } = await stored();
    const refused = await updates.updateDj({
      djId: id,
      changes: { description: eventNote, genres: ["House"] },
    });
    expect(refused.description).toBe(bio);
    expect(refused.genres).toEqual(["House"]);
    expect(refused).toMatchObject({
      warnings: [expect.stringMatching(/not written/)],
    });
    const onlyDescription = await updates.updateDj({
      djId: id,
      changes: { description: eventNote },
    });
    expect(onlyDescription.description).toBe(bio);
    const cleared = await updates.updateDj({
      djId: id,
      changes: { description: "" },
    });
    expect(cleared.description).toBe("");
    const fromEmpty = await updates.updateDj({
      djId: id,
      changes: { description: eventNote },
    });
    expect(fromEmpty.description).toBe("");
  });

  it("keeps website, image and sample post when a bundle omits them; null clears; insert stores null", async () => {
    const links = {
      websiteUrl: "https://dj.example.com",
      imageUrl: "https://dj.example.com/portrait.jpg",
      samplePostUrl: "https://www.instagram.com/p/SamplePost/",
    };
    const venueLinks = {
      websiteUrl: "https://club.example.com",
      imageUrl: "https://club.example.com/front.jpg",
    };
    const { websiteUrl: _w, imageUrl: _i, samplePostUrl: _s, ...bare } = testDj;
    void _w;
    void _i;
    void _s;
    const { websiteUrl: _vw, imageUrl: _vi, ...bareVenue } = testVenue;
    void _vw;
    void _vi;
    const publishAll = async (dj: object, venue: object) => {
      const code = `Links${counter++}`;
      await ingestion.enqueue(postSource(code, "2026-12-01T10:00:00Z"));
      const claim = await ingestion.claim();
      if (!claim.claimed) throw new Error("work");
      return ingestion.complete(claim.package.id, claim.claimToken, {
        venues: [venue],
        djs: [dj],
        events: [
          {
            ...testEvent,
            slug: `links-${code.toLowerCase()}`,
            startsAt: `2027-0${(counter % 8) + 1}-12T23:00:00+01:00`,
            endsAt: null,
          },
        ],
      });
    };
    const storedVenue = async () => {
      const [row] = await connection.db.select().from(venues);
      if (!row) throw new Error("venue");
      return row;
    };
    await publishAll(bare, bareVenue);
    expect(await stored()).toMatchObject({
      websiteUrl: null,
      imageUrl: null,
      samplePostUrl: null,
    });
    expect(await storedVenue()).toMatchObject({
      websiteUrl: null,
      imageUrl: null,
    });
    await publishAll({ ...bare, ...links }, { ...bareVenue, ...venueLinks });
    await publishAll(bare, bareVenue);
    expect(await stored()).toMatchObject(links);
    expect(await storedVenue()).toMatchObject(venueLinks);
    await publishAll(
      { ...bare, websiteUrl: null },
      { ...bareVenue, websiteUrl: null },
    );
    expect(await stored()).toMatchObject({ ...links, websiteUrl: null });
    expect(await storedVenue()).toMatchObject({
      websiteUrl: null,
      imageUrl: venueLinks.imageUrl,
    });
    await publishAll(
      { ...bare, imageUrl: null, samplePostUrl: null },
      bareVenue,
    );
    expect(await stored()).toMatchObject({
      imageUrl: null,
      samplePostUrl: null,
    });
    // upsert_venue shares the rule.
    await ingestion.upsertVenue(bareVenue);
    expect(await storedVenue()).toMatchObject({
      imageUrl: venueLinks.imageUrl,
    });
  });
});
