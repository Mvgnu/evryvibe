import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { ingestionRepository } from "../src/db/ingestion";
import {
  packages,
  packageHistory,
  venues,
  venueSources,
} from "../src/db/schema";
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const venue = {
  slug: "source-room",
  name: "Source Room",
  city: "Berlin",
  country: "Germany",
  address: "Test address",
  timezone: "Europe/Berlin",
  description: "",
  imageUrl: null,
  instagramUrl: "https://instagram.com/source_room/",
  websiteUrl: null,
};
const capture = (capturedAt = "2026-09-21T12:00:00Z") => ({
  postUrl: "https://instagram.com/p/SourcePost/",
  caption: "Original caption",
  ocrText: "Original OCR",
  accountUrl: venue.instagramUrl,
  capturedAt,
});
suite("Venue collection controls and evidence correction", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const repo = ingestionRepository(connection.db);
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error("Disposable test database required");
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages CASCADE`,
    );
  });
  afterAll(async () => {
    await connection.close();
  });
  async function enabled() {
    const row = await repo.upsertVenue(venue);
    return repo.setVenueSource({
      venueId: row.id,
      enabled: true,
      expectedRevision: 0,
    });
  }
  it("changes/removes a profile explicitly while disabling collection and rejecting stale submissions", async () => {
    const source = await enabled();
    const changed = await repo.setVenueProfile({
      venueId: source.venueId,
      expectedRevision: source.revision,
      instagramUrl: "https://instagram.com/renamed_room/",
    });
    expect(changed).toMatchObject({
      enabled: false,
      revision: source.revision + 1,
      instagramUrl: "https://www.instagram.com/renamed_room/",
    });
    await expect(
      repo.enqueueCollectedPackage({
        venueId: source.venueId,
        expectedRevision: source.revision,
        package: capture(),
      }),
    ).rejects.toMatchObject({ code: "stale_source" });
    const other = await repo.upsertVenue({
      ...venue,
      slug: "another-source",
      instagramUrl: "https://instagram.com/another_source/",
    });
    await expect(
      repo.setVenueProfile({
        venueId: other.id,
        expectedRevision: 0,
        instagramUrl: changed.instagramUrl,
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    const removed = await repo.setVenueProfile({
      venueId: source.venueId,
      expectedRevision: changed.revision,
      instagramUrl: null,
    });
    expect(removed.instagramUrl).toBeNull();
    await expect(
      repo.setVenueSource({
        venueId: source.venueId,
        expectedRevision: removed.revision,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "missing_facts" });
  });
  it("bootstraps disabled and enforces enable/profile/revision/account boundaries", async () => {
    const row = await repo.upsertVenue(venue);
    expect((await repo.listVenueSources()).sources[0]).toMatchObject({
      venueId: row.id,
      enabled: false,
      revision: 0,
    });
    expect((await repo.listVenueSources(true)).sources).toEqual([]);
    await expect(
      repo.enqueueCollectedPackage({
        venueId: row.id,
        expectedRevision: 0,
        package: capture(),
      }),
    ).rejects.toMatchObject({ code: "source_disabled" });
    const on = await repo.setVenueSource({
      venueId: row.id,
      enabled: true,
      expectedRevision: 0,
    });
    await expect(
      repo.setVenueSource({
        venueId: row.id,
        enabled: false,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "stale_source" });
    await expect(
      repo.enqueueCollectedPackage({
        venueId: row.id,
        expectedRevision: on.revision,
        package: { ...capture(), accountUrl: "https://instagram.com/other/" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    const first = await repo.enqueueCollectedPackage({
      venueId: row.id,
      expectedRevision: on.revision,
      package: capture(),
    });
    expect(first.created).toBe(true);
    expect(await repo.enqueue(capture())).toMatchObject({
      id: first.id,
      created: false,
    });
    await repo.setVenueSource({
      venueId: row.id,
      enabled: false,
      expectedRevision: on.revision,
    });
    await expect(
      repo.enqueueCollectedPackage({
        venueId: row.id,
        expectedRevision: on.revision,
        package: capture(),
      }),
    ).rejects.toMatchObject({ code: "stale_source" });
  });
  it("serializes concurrent operator updates and queue acceptance against disable", async () => {
    const on = await enabled();
    const changes = await Promise.allSettled([
      repo.setVenueSource({
        venueId: on.venueId,
        enabled: false,
        expectedRevision: on.revision,
      }),
      repo.setVenueSource({
        venueId: on.venueId,
        enabled: false,
        expectedRevision: on.revision,
      }),
    ]);
    expect(changes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    await expect(
      repo.enqueueCollectedPackage({
        venueId: on.venueId,
        expectedRevision: on.revision,
        package: capture(),
      }),
    ).rejects.toMatchObject({ code: "stale_source" });
    expect(await repo.list()).toEqual([]);
  });
  it("rejects a submission queued behind the disable transaction lock", async () => {
    const on = await enabled();
    let acquired: () => void = () => {};
    let release: () => void = () => {};
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const continueDisable = new Promise<void>((resolve) => {
      release = resolve;
    });
    const disabling = connection.db.transaction(async (tx) => {
      await tx
        .select()
        .from(venues)
        .where(eq(venues.id, on.venueId))
        .for("update");
      acquired();
      await continueDisable;
      await tx
        .update(venueSources)
        .set({ enabled: false, revision: on.revision + 1 })
        .where(eq(venueSources.venueId, on.venueId));
    });
    await locked;
    const submission = repo.enqueueCollectedPackage({
      venueId: on.venueId,
      expectedRevision: on.revision,
      package: capture(),
    });
    // Attach rejection handling before releasing the transaction.
    const rejected = expect(submission).rejects.toMatchObject({
      code: "stale_source",
    });
    release();
    await disabling;
    await rejected;
    expect(await repo.list()).toEqual([]);
  });
  it("requires profiles and invalidates old revisions when first profile is added", async () => {
    const row = await repo.upsertVenue({ ...venue, instagramUrl: null });
    await expect(
      repo.setVenueSource({
        venueId: row.id,
        enabled: true,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "missing_facts" });
    await repo.upsertVenue(venue);
    expect((await repo.listVenueSources()).sources[0]).toMatchObject({
      revision: 1,
      enabled: false,
    });
    await expect(
      repo.upsertVenue({
        ...venue,
        instagramUrl: "https://instagram.com/changed/",
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    expect(await connection.db.select().from(venues)).toHaveLength(1);
  });
  it("keeps failures honest and prevents stale run outcomes overwriting newer ones", async () => {
    const on = await enabled();
    const base = {
      venueId: on.venueId,
      expectedRevision: on.revision,
      postsQueued: 2,
      error: null,
    };
    const success = await repo.recordSourceRun({
      ...base,
      startedAt: "2026-09-21T12:00:00Z",
      finishedAt: "2026-09-21T12:01:00Z",
    });
    const failure = await repo.recordSourceRun({
      ...base,
      postsQueued: 1,
      error: "OCR timed out",
      startedAt: "2026-09-21T13:00:00Z",
      finishedAt: "2026-09-21T13:01:00Z",
    });
    expect(failure.lastSucceededAt).toBe(success.lastSucceededAt);
    const late = await repo.recordSourceRun({
      ...base,
      startedAt: "2026-09-21T12:30:00Z",
      finishedAt: "2026-09-21T14:00:00Z",
    });
    expect(late).toEqual(failure);
    await repo.setVenueSource({
      venueId: on.venueId,
      expectedRevision: on.revision,
      enabled: false,
    });
    await expect(
      repo.recordSourceRun({
        ...base,
        startedAt: "2026-09-21T15:00:00Z",
        finishedAt: "2026-09-21T15:01:00Z",
      }),
    ).rejects.toMatchObject({ code: "stale_source" });
  });
  it("refreshes only newer matching evidence, protects live claims and revokes expired ownership", async () => {
    const item = await repo.enqueue(capture());
    const next = capture("2026-09-21T13:00:00Z");
    await expect(
      repo.refreshPackage({ packageId: item.id, package: capture() }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      repo.refreshPackage({
        packageId: item.id,
        package: { ...next, accountUrl: "https://instagram.com/other/" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    const claim = await repo.claim();
    if (!claim.claimed) throw new Error("Expected claim");
    await expect(
      repo.refreshPackage({ packageId: item.id, package: next }),
    ).rejects.toMatchObject({ code: "stale_lease" });
    await connection.db
      .update(packages)
      .set({ leaseExpiresAt: "2000-01-01T00:00:00Z" })
      .where(eq(packages.id, item.id));
    expect(
      await repo.refreshPackage({ packageId: item.id, package: next }),
    ).toMatchObject({ state: "pending", attempts: 0, resultEventIds: [] });
    await expect(
      repo.finish(item.id, claim.claimToken, "discarded", "Old token"),
    ).rejects.toMatchObject({ code: "stale_lease" });
    expect(
      (await connection.db.select().from(packageHistory))[0]?.payload.ocrText,
    ).toBe("Original OCR");
    for (let hour = 14; hour < 21; hour++)
      await repo.refreshPackage({
        packageId: item.id,
        package: capture(`2026-09-21T${hour}:00:00Z`),
      });
    expect(await connection.db.select().from(packageHistory)).toHaveLength(5);
  });
});
