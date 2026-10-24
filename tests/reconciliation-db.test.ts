import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { ingestionRepository } from "../src/db/ingestion";
import { reconciliationRepository } from "../src/db/reconciliation";
import { djs, events, reconciliationTasks, venues } from "../src/db/schema";
import {
  fakeSoundcloud,
  postSource,
  testDj,
  testEvent,
  testVenue,
} from "./support/backend";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("reconciliation queue on Postgres", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const soundcloud = fakeSoundcloud({
    "https://soundcloud.com/vivi": { title: "VIVI", bio: "IG vivi_music" },
    "https://soundcloud.com/other": { title: "Other", bio: "" },
  });
  const deps = { soundcloud };
  const queue = reconciliationRepository(connection.db, deps);
  const ingestion = ingestionRepository(connection.db, deps);
  const db = connection.db;
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error(
        "Tests require an explicitly named disposable test database",
      );
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages, reconciliation_tasks CASCADE`,
    );
    soundcloud.calls.length = 0;
    soundcloud.down = false;
  });
  afterAll(() => connection.close());

  const filler = "VIVI ist als DJ im elektronischen Clubbereich aktiv.";
  const note = "Anna steht bei Electric Grooves im Tanzhaus West im Line-up.";
  const bio =
    "Cleo ist eine Kölner DJ und Produzentin. Ihre Sets verbinden Dub Techno mit Breaks.";
  async function addDj(
    slug: string,
    values: Partial<typeof djs.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(djs)
      .values({
        slug,
        name: slug.toUpperCase(),
        description: bio,
        genres: [],
        soundcloudUrl: "https://soundcloud.com/" + slug,
        ...values,
      })
      .returning();
    if (!row) throw new Error("insert failed");
    return row;
  }
  const open = () =>
    db
      .select()
      .from(reconciliationTasks)
      .where(sql`state <> 'done'`);
  const emptyChanges = {};
  const outcome = {
    description: "kept" as const,
    soundcloud: "unchanged" as const,
    basis: "checked",
  };

  it("seeds idempotently, scopes by check and entity, and counts by check", async () => {
    await addDj("vivi", {
      description: filler,
      websiteUrl: "https://soundcloud.com/vivi",
      soundcloudUrl: null,
    });
    await addDj("anna", { description: note, soundcloudUrl: null });
    await addDj("cleo", { soundcloudUrl: null });
    await addDj("done-dj"); // fine description, unverified profile
    const first = await queue.seed({});
    expect(first).toMatchObject({ created: 4, updated: 0, unchanged: 0 });
    expect(first.byCheck).toEqual({
      description_filler: 1,
      description_event_bound: 1,
      soundcloud_in_website: 1,
      soundcloud_missing: 3,
      soundcloud_unverified: 1,
    });
    const again = await queue.seed({});
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(await open()).toHaveLength(4);
    const scoped = await queue.seed({
      checks: ["description_filler"],
      entityType: "dj",
    });
    expect(scoped).toMatchObject({ created: 0 });
    expect(scoped.byCheck).toEqual({ description_filler: 1 });
    expect(await queue.list({ check: "soundcloud_unverified" })).toMatchObject({
      tasks: [expect.objectContaining({ slug: "done-dj" })],
    });
  });

  it("honours limit and upcomingOnly, and ranks by upcoming events", async () => {
    const venue = (
      await db
        .insert(venues)
        .values({ ...testVenue, instagramUrl: null })
        .returning()
    )[0];
    const busy = await addDj("busy", {
      description: filler,
      soundcloudUrl: "https://soundcloud.com/busy",
    });
    await addDj("quiet", { description: filler });
    if (!venue) throw new Error("venue missing");
    const [event] = await db
      .insert(events)
      .values({
        slug: "future",
        title: "Future",
        description: "",
        venueId: venue.id,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        genres: [],
        sourceUrl: "https://www.instagram.com/p/X/",
        observedAt: new Date().toISOString(),
        status: "scheduled",
      })
      .returning();
    if (!event) throw new Error("event missing");
    await db.execute(
      sql`INSERT INTO event_djs (event_id, dj_id, position) VALUES (${event.id}, ${busy.id}, 0)`,
    );
    expect(
      await queue.seed({ upcomingOnly: true, checks: ["description_filler"] }),
    ).toMatchObject({ created: 1 });
    expect((await open())[0]).toMatchObject({ djId: busy.id, priority: 1 });
    const limited = await queue.seed({
      checks: ["description_filler"],
      limit: 1,
    });
    expect(limited).toMatchObject({ created: 1, skipped: 0 });
    expect(await open()).toHaveLength(2);
    const claimed = await queue.claim({ limit: 1 });
    expect(claimed.tasks[0]).toMatchObject({ entity: { slug: "busy" } });
  });

  it("skips soundcloud_missing once a completed task recorded not_found", async () => {
    await addDj("ghost", { soundcloudUrl: null });
    await queue.seed({ checks: ["soundcloud_missing"] });
    const [claimed] = (await queue.claim({})).tasks;
    if (!claimed) throw new Error("no task");
    await queue.complete({
      taskId: claimed.taskId,
      claimToken: claimed.claimToken,
      changes: emptyChanges,
      outcome: {
        description: "kept",
        soundcloud: "not_found",
        basis: "No profile linked from Instagram or website",
      },
    });
    expect(await queue.seed({})).toMatchObject({ created: 0 });
    expect(await open()).toHaveLength(0);
  });

  it("queues new DJs from complete_package and warns about weak descriptions", async () => {
    await ingestion.enqueue(postSource("AutoPost", "2026-12-01T10:00:00Z"));
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("work");
    const result = await ingestion.complete(
      claim.package.id,
      claim.claimToken,
      {
        venues: [testVenue],
        djs: [
          { ...testDj, description: note },
          {
            ...testDj,
            slug: "good-dj",
            name: "Good",
            instagramUrl: null,
            description: bio,
            soundcloudUrl: null,
          },
        ],
        events: [
          {
            ...testEvent,
            djSlugs: ["test-dj", "good-dj"],
            startsAt: new Date(Date.now() + 5 * 86_400_000)
              .toISOString()
              .replace("Z", "+00:00"),
            endsAt: null,
          },
        ],
      },
    );
    expect(result.warnings?.[0]).toMatch(/dj test-dj/);
    const tasks = await queue.list({});
    expect(tasks.counts.byState).toEqual({ pending: 2 });
    const bySlug = Object.fromEntries(
      tasks.tasks.map((task) => [task.slug, task]),
    );
    expect(bySlug["test-dj"]?.checks).toEqual([
      "description_event_bound",
      "soundcloud_missing",
    ]);
    expect(bySlug["good-dj"]?.checks).toEqual(["soundcloud_missing"]);
    expect(bySlug["good-dj"]?.priority).toBe(1);
    // A second publication of the same DJ merges instead of duplicating.
    await ingestion.enqueue(postSource("AutoPost2", "2026-12-02T10:00:00Z"));
    const next = await ingestion.claim();
    if (!next.claimed) throw new Error("work");
    await ingestion.complete(next.package.id, next.claimToken, {
      venues: [testVenue],
      djs: [{ ...testDj, description: filler }],
      events: [
        {
          ...testEvent,
          slug: "second",
          startsAt: "2027-02-01T23:00:00+01:00",
          endsAt: null,
          djSlugs: ["test-dj"],
        },
      ],
    });
    expect(
      (await open()).filter((task) =>
        task.checks.includes("description_filler"),
      ),
    ).toHaveLength(1);
    expect(await open()).toHaveLength(2);
  });

  it("flag adds to the single open task or creates one", async () => {
    const dj = await addDj("flagme");
    const created = await queue.flag({
      djId: dj.id,
      reason: "Looks like a different person",
    });
    expect(created).toMatchObject({ checks: ["flagged"], entityType: "dj" });
    await queue.seed({});
    const merged = await queue.flag({ djId: dj.id, reason: "Still wrong" });
    expect(merged.taskId).toBe(created.taskId);
    expect(merged.checks).toContain("flagged");
    expect(merged.reason).toBe("Still wrong");
    expect(await open()).toHaveLength(1);
    await expect(
      queue.flag({ djId: dj.id, venueId: dj.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      queue.flag({ djId: "00000000-0000-4000-8000-000000000000", reason: "x" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      db.insert(reconciliationTasks).values({ djId: dj.id, checks: [] }),
    ).rejects.toThrow();
  });

  it("two concurrent claimers never receive the same task, and lists never expose tokens", async () => {
    for (const slug of ["a-dj", "b-dj", "c-dj", "d-dj", "e-dj"])
      await addDj(slug, { description: filler });
    await queue.seed({});
    const batches = await Promise.all([
      queue.claim({ limit: 3 }),
      queue.claim({ limit: 3 }),
      queue.claim({ limit: 3 }),
    ]);
    const ids = batches.flatMap((batch) =>
      batch.tasks.map((task) => task.taskId),
    );
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(
      new Set(
        batches.flatMap((batch) => batch.tasks.map((task) => task.claimToken)),
      ).size,
    ).toBe(5);
    const listing = JSON.stringify(await queue.list({ limit: 100 }));
    expect(listing).not.toMatch(/claimToken|leaseToken|completedToken/);
    for (const batch of batches)
      for (const task of batch.tasks)
        expect(listing).not.toContain(task.claimToken);
    const single = await addDj("solo", { description: filler });
    await queue.seed({});
    const racers = await Promise.all([
      queue.claim({ limit: 1 }),
      queue.claim({ limit: 1 }),
    ]);
    expect(
      racers
        .flatMap((r) => r.tasks)
        .filter((task) => task.entity.id === single.id),
    ).toHaveLength(1);
  });

  it("claims with entity snapshot and bounded evidence from linked events and captions", async () => {
    await ingestion.enqueue({
      ...postSource("Evidence", "2026-12-01T10:00:00Z"),
      caption: `${"x".repeat(900)} Heute Abend: COOLDJ live im Club ${"y".repeat(900)}`,
    });
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("work");
    await ingestion.complete(claim.package.id, claim.claimToken, {
      venues: [testVenue],
      djs: [
        {
          ...testDj,
          slug: "cooldj",
          name: "COOLDJ",
          instagramUrl: null,
          description: filler,
        },
      ],
      events: [{ ...testEvent, djSlugs: ["cooldj"] }],
    });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("no task");
    expect(task).toMatchObject({
      checks: expect.arrayContaining(["description_filler"]),
      entity: {
        type: "dj",
        slug: "cooldj",
        description: filler,
        soundcloudUrl: null,
      },
      events: [
        {
          title: "Test Night",
          venue: "Test Room",
          city: "Berlin",
          sourceUrl: "https://www.instagram.com/p/Evidence/",
          packageId: claim.package.id,
        },
      ],
    });
    expect(task.excerpts).toHaveLength(1);
    expect(task.excerpts[0]?.excerpt.length).toBeLessThan(400);
    expect(task.excerpts[0]?.excerpt).toContain("COOLDJ");
  });

  it("reclaims expired leases, auto-defers after five abandoned attempts, and requeues on request", async () => {
    await addDj("flaky", { description: filler });
    await queue.seed({});
    const [first] = (await queue.claim({})).tasks;
    if (!first) throw new Error("task");
    expect((await queue.claim({})).tasks).toHaveLength(0);
    await db
      .update(reconciliationTasks)
      .set({ leaseExpiresAt: "2000-01-01T00:00:00Z" });
    const [second] = (await queue.claim({})).tasks;
    expect(second).toMatchObject({ taskId: first.taskId, attempts: 2 });
    await expect(
      queue.complete({
        taskId: first.taskId,
        claimToken: first.claimToken,
        changes: emptyChanges,
        outcome,
      }),
    ).rejects.toMatchObject({ code: "stale_lease" });
    await db
      .update(reconciliationTasks)
      .set({ leaseExpiresAt: "2000-01-01T00:00:00Z", attempts: 5 });
    expect((await queue.claim({})).tasks).toHaveLength(0);
    const [deferred] = await open();
    expect(deferred).toMatchObject({ state: "deferred", leaseToken: null });
    expect(deferred?.lastReason).toMatch(/Five abandoned attempts/);
    const requeued = await queue.requeue({ taskId: first.taskId });
    expect(requeued).toMatchObject({ state: "pending", attempts: 0 });
    await expect(queue.requeue({ taskId: first.taskId })).rejects.toMatchObject(
      { code: "invalid_input" },
    );
    const [third] = (await queue.claim({})).tasks;
    if (!third) throw new Error("task");
    const parked = await queue.defer({
      taskId: third.taskId,
      claimToken: third.claimToken,
      reason: "Needs the artist",
    });
    expect(parked).toMatchObject({
      state: "deferred",
      lastReason: "Needs the artist",
    });
    await expect(
      queue.defer({
        taskId: third.taskId,
        claimToken: third.claimToken,
        reason: "again",
      }),
    ).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("completes atomically: rewrite and verified profile apply, replay is idempotent", async () => {
    const dj = await addDj("vivi", {
      description: filler,
      soundcloudUrl: null,
      websiteUrl: "https://soundcloud.com/vivi",
    });
    await queue.seed({});
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    expect(task.checks).toEqual(
      expect.arrayContaining([
        "description_filler",
        "soundcloud_missing",
        "soundcloud_in_website",
      ]),
    );
    const bad = {
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: { description: "Am 12. Oktober spielt VIVI im Line-up." },
      outcome: {
        description: "rewritten" as const,
        soundcloud: "unchanged" as const,
        basis: "x",
      },
    };
    await expect(queue.complete(bad)).rejects.toMatchObject({
      code: "invalid_input",
      message: /still has issues/,
    });
    const request = {
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: {
        description: "VIVI ist eine Münchner DJ mit Fokus auf Melodic Techno.",
        soundcloudUrl: "https://soundcloud.com/vivi",
        websiteUrl: null,
      },
      outcome: {
        description: "rewritten" as const,
        soundcloud: "set" as const,
        basis: "SoundCloud bio links instagram.com/vivi_music",
      },
    };
    const done = await queue.complete(request);
    expect(done).toMatchObject({
      state: "done",
      replayed: false,
      soundcloud: { title: "VIVI" },
      outcome: {
        soundcloud: "set",
        changed: expect.arrayContaining([
          "description",
          "soundcloudUrl",
          "websiteUrl",
        ]),
      },
    });
    const [stored] = await db.select().from(djs).where(eq(djs.id, dj.id));
    expect(stored).toMatchObject({
      soundcloudUrl: "https://soundcloud.com/vivi",
      websiteUrl: null,
    });
    expect(soundcloud.calls).toEqual(["https://soundcloud.com/vivi"]);
    const replay = await queue.complete(request);
    expect(replay).toMatchObject({
      state: "done",
      replayed: true,
      outcome: done.outcome,
    });
    expect(soundcloud.calls).toHaveLength(1);
    await expect(
      queue.complete({ ...request, claimToken: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "stale_lease" });
    // The entity can be queued again once its previous task is done.
    expect((await queue.flag({ djId: dj.id, reason: "again" })).state).toBe(
      "pending",
    );
  });

  it("rolls the task back when a change fails, leaving the claim usable", async () => {
    await addDj("taken", { soundcloudUrl: "https://soundcloud.com/other" });
    const dj = await addDj("victim", {
      description: filler,
      soundcloudUrl: null,
    });
    await queue.flag({ djId: dj.id, reason: "check" });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    await expect(
      queue.complete({
        taskId: task.taskId,
        claimToken: task.claimToken,
        changes: {
          description: "Neue Bio über Techno.",
          soundcloudUrl: "https://soundcloud.com/other",
        },
        outcome: { description: "rewritten", soundcloud: "set", basis: "x" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict", message: /taken/ });
    const [after] = await db.select().from(reconciliationTasks);
    expect(after).toMatchObject({
      state: "processing",
      leaseToken: task.claimToken,
      outcome: null,
    });
    expect(
      (await db.select().from(djs).where(eq(djs.id, dj.id)))[0]?.description,
    ).toBe(filler);
    const ok = await queue.complete({
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: emptyChanges,
      outcome,
    });
    expect(ok.state).toBe("done");
  });

  it("applies venue tasks with venue changes only", async () => {
    const [venue] = await db
      .insert(venues)
      .values({ ...testVenue, instagramUrl: null })
      .returning();
    if (!venue) throw new Error("venue");
    await queue.flag({ venueId: venue.id, reason: "city looks wrong" });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    expect(task.entity).toMatchObject({ type: "venue", slug: "test-room" });
    await expect(
      queue.complete({
        taskId: task.taskId,
        claimToken: task.claimToken,
        changes: { genres: ["x"] },
        outcome,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const done = await queue.complete({
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: { city: "Hamburg" },
      outcome,
    });
    expect(done).toMatchObject({ state: "done", entity: { city: "Hamburg" } });
  });

  it("flag during processing survives completion as a follow-up task", async () => {
    const dj = await addDj("racey", {
      description: filler,
      soundcloudUrl: null,
    });
    await queue.seed({ checks: ["description_filler"] });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    expect(task.checks).toEqual(["description_filler"]);
    await queue.flag({ djId: dj.id, reason: "Wrong person, check Instagram" });
    const done = await queue.complete({
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: { description: "" },
      outcome: { description: "cleared", soundcloud: "unchanged", basis: "x" },
    });
    expect(done).toMatchObject({
      state: "done",
      followUpTaskId: expect.any(String),
    });
    const [follow] = await open();
    expect(follow).toMatchObject({
      id: Reflect.get(done, "followUpTaskId"),
      state: "pending",
      checks: ["flagged"],
      reason: "Wrong person, check Instagram",
    });
    // A second flag reason on an already flagged claim also continues.
    const [again] = (await queue.claim({})).tasks;
    if (!again) throw new Error("task");
    await queue.flag({ djId: dj.id, reason: "Also the genre is wrong" });
    const second = await queue.complete({
      taskId: again.taskId,
      claimToken: again.claimToken,
      changes: {},
      outcome,
    });
    expect(second).toMatchObject({ followUpTaskId: expect.any(String) });
    expect((await open())[0]).toMatchObject({
      reason: "Also the genre is wrong",
    });
    // Nothing new arrived: no follow-up.
    const [last] = (await queue.claim({})).tasks;
    if (!last) throw new Error("task");
    expect(
      await queue.complete({
        taskId: last.taskId,
        claimToken: last.claimToken,
        changes: {},
        outcome,
      }),
    ).not.toHaveProperty("followUpTaskId");
  });

  it("new checks or a flag return a deferred task to pending; re-seeding the same checks does not", async () => {
    const dj = await addDj("parked", { description: filler });
    await queue.seed({ checks: ["description_filler"] });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    await queue.defer({
      taskId: task.taskId,
      claimToken: task.claimToken,
      reason: "later",
    });
    await queue.seed({ checks: ["description_filler"] });
    expect((await open())[0]).toMatchObject({ state: "deferred" });
    // Auto-enqueue from complete_package adds a new check to the parked task.
    await db.update(djs).set({ description: note }).where(eq(djs.id, dj.id));
    await queue.seed({ checks: ["description_event_bound"] });
    expect((await open())[0]).toMatchObject({
      state: "pending",
      attempts: 0,
      lastReason: null,
    });
    const [again] = (await queue.claim({})).tasks;
    if (!again) throw new Error("task");
    await queue.defer({
      taskId: again.taskId,
      claimToken: again.claimToken,
      reason: "later",
    });
    expect(
      await queue.flag({ djId: dj.id, reason: "look again" }),
    ).toMatchObject({
      state: "pending",
      attempts: 0,
    });
    // complete_package merging a new check wakes it too.
    const [third] = (await queue.claim({})).tasks;
    if (!third) throw new Error("task");
    await queue.defer({
      taskId: third.taskId,
      claimToken: third.claimToken,
      reason: "later",
    });
    await db.update(reconciliationTasks).set({ checks: ["flagged"] });
    await ingestion.enqueue(postSource("Wake", "2026-12-01T10:00:00Z"));
    const claim = await ingestion.claim();
    if (!claim.claimed) throw new Error("work");
    await ingestion.complete(claim.package.id, claim.claimToken, {
      venues: [testVenue],
      djs: [
        {
          ...testDj,
          slug: "parked",
          name: "PARKED",
          instagramUrl: null,
          description: filler,
        },
      ],
      events: [{ ...testEvent, djSlugs: ["parked"] }],
    });
    // The stored note is already bad, so the filler replaces it and adds a new check.
    expect((await open())[0]).toMatchObject({
      state: "pending",
      checks: ["description_filler", "flagged"],
    });
  });

  it("seed never deletes or rewrites a task that is being claimed", async () => {
    for (let round = 0; round < 8; round++) {
      await db.execute(sql`TRUNCATE djs, reconciliation_tasks CASCADE`);
      const dj = await addDj(`fixed-${round}`, {
        soundcloudUrl: "https://soundcloud.com/x",
      });
      // The description is fine now, so seeding wants to resolve the task.
      await db
        .insert(reconciliationTasks)
        .values({ djId: dj.id, checks: ["description_filler"] });
      const [claim, seeded] = await Promise.all([
        queue.claim({}),
        queue.seed({ checks: ["description_filler"] }),
      ]);
      const rows = await db.select().from(reconciliationTasks);
      if (claim.tasks.length) {
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          state: "processing",
          leaseToken: claim.tasks[0]?.claimToken,
        });
      } else {
        expect(seeded.resolved).toBe(1);
      }
    }
  });

  it("confirmed and unverified completions rest on a fresh SoundCloud lookup", async () => {
    const dj = await addDj("vivi", {
      soundcloudUrl: "https://soundcloud.com/vivi",
    });
    await queue.seed({ checks: ["soundcloud_unverified"] });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    expect(task.checks).toEqual(["soundcloud_unverified"]);
    const done = await queue.complete({
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: {},
      outcome: {
        description: "kept",
        soundcloud: "confirmed",
        basis: "Bio links the Instagram",
      },
    });
    expect(soundcloud.calls).toEqual(["https://soundcloud.com/vivi"]);
    expect(done.outcome).toMatchObject({
      soundcloudEvidence: { title: "VIVI" },
    });
    expect(await queue.seed({})).toMatchObject({ created: 0 });
    // The lookup never blocks: a profile SoundCloud does not know is still
    // confirmed on the agent's word, with empty evidence.
    await db
      .update(djs)
      .set({ soundcloudUrl: "https://soundcloud.com/ghost" })
      .where(eq(djs.id, dj.id));
    await queue.flag({ djId: dj.id, reason: "check" });
    const [next] = (await queue.claim({})).tasks;
    if (!next) throw new Error("task");
    const confirmed = await queue.complete({
      taskId: next.taskId,
      claimToken: next.claimToken,
      changes: {},
      outcome: { description: "kept", soundcloud: "confirmed", basis: "x" },
    });
    expect(confirmed).toMatchObject({
      state: "done",
      outcome: { soundcloudEvidence: { title: "", bioExcerpt: "" } },
    });
  });

  it("refuses a replay whose changes or outcome differ from the recorded completion", async () => {
    await addDj("replay", { description: filler, soundcloudUrl: null });
    await queue.seed({ checks: ["description_filler"] });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    const request = {
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: { description: "" },
      outcome: {
        description: "cleared" as const,
        soundcloud: "unchanged" as const,
        basis: "x",
      },
    };
    await queue.complete(request);
    expect(
      await queue.complete({ ...request, outcome: { ...request.outcome } }),
    ).toMatchObject({ replayed: true });
    await expect(
      queue.complete({
        ...request,
        changes: { description: "Neue Bio über Techno." },
      }),
    ).rejects.toMatchObject({
      code: "identity_conflict",
      message: /different changes/,
    });
    await expect(
      queue.complete({
        ...request,
        outcome: { ...request.outcome, basis: "other" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });

  it("throws domain errors for malformed changes from direct callers", async () => {
    const { parseDjChanges } = await import("../src/core/catalog-updates");
    expect(() => parseDjChanges({ city: "Berlin" })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() =>
      parseDjChanges({ samplePostUrl: null, sampleMediaId: null }),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("seeds an entity whose English text is weak while the German one is clean, and clears English with German", async () => {
    const dj = await addDj("bilingual", {
      translations: {
        en: { description: "Cleo is booked as a DJ at the W6KE UP afterhour." },
      },
    });
    expect(
      await queue.seed({ checks: ["description_event_bound"] }),
    ).toMatchObject({ created: 1 });
    const [task] = (await queue.claim({})).tasks;
    if (!task) throw new Error("task");
    expect(task.checks).toEqual(["description_event_bound"]);
    // Keeping the weak English text is refused.
    await expect(
      queue.complete({
        taskId: task.taskId,
        claimToken: task.claimToken,
        changes: {},
        outcome,
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: /translations\.en/,
    });
    // Clearing the German bio clears the English one automatically.
    const done = await queue.complete({
      taskId: task.taskId,
      claimToken: task.claimToken,
      changes: { description: "" },
      outcome: {
        description: "cleared",
        soundcloud: "unchanged",
        basis: "no verifiable bio",
      },
    });
    expect(done.outcome).toMatchObject({
      changed: ["description", "translations"],
    });
    const [stored] = await db.select().from(djs).where(eq(djs.id, dj.id));
    expect(stored).toMatchObject({ description: "", translations: {} });
  });
});
