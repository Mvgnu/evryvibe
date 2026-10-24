import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { parseDjChanges } from "../core/catalog-updates";
import { descriptionWarnings } from "../core/reconciliation";
import {
  claimReconciliationSchema,
  completeReconciliationSchema,
  clearsEnglishWithGerman,
  completionProblems,
  deferReconciliationSchema,
  flagReconciliationSchema,
  listReconciliationSchema,
  parseVenueChanges,
  profileChecks,
  requeueReconciliationSchema,
  seedReconciliationSchema,
  reconciliationChecks,
  type EntityType,
  type ReconciliationCheck,
} from "../core/reconciliation-tasks";
import {
  soundcloudOembedVerifier,
  type SoundcloudEvidence,
  type SoundcloudVerifier,
} from "../core/soundcloud-oembed";
import { DomainError } from "../core/model";
import {
  applyDjChanges,
  applyVenueChanges,
  storedSoundcloud,
} from "./catalog-updates";
import type { Database, Transaction } from "./client";
import {
  djs,
  eventDjs,
  events,
  eventSources,
  packages,
  reconciliationTasks as tasks,
  venues,
} from "./schema";

/** Stable digest of a completion request, so a replay can be compared with it. */
function requestDigest(changes: object, outcome: object) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical({ changes, outcome })))
    .digest("hex");
}

export type ReconciliationDeps = { soundcloud: SoundcloudVerifier };
type Target = { djId: string } | { venueId: string };
type TaskRow = typeof tasks.$inferSelect;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      "invalid_input",
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  return result.data;
}
const iso = (value: string | null) =>
  value ? new Date(value).toISOString() : null;
const abandonedReason =
  "Five abandoned attempts; intentionally requeue when the missing context or worker problem is resolved";
const maxAttempts = 5;
const knownChecks = (values: readonly string[]): ReconciliationCheck[] =>
  reconciliationChecks.filter((check) => values.includes(check));

const targetColumn = (target: Target) =>
  "djId" in target ? tasks.djId : tasks.venueId;
const targetId = (target: Target) =>
  "djId" in target ? target.djId : target.venueId;
const entityTypeOf = (row: TaskRow): EntityType => (row.djId ? "dj" : "venue");

/** Upcoming scheduled events that make an entity's profile worth fixing first. */
async function upcomingCount(tx: Transaction, target: Target) {
  const [row] =
    "djId" in target
      ? await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(eventDjs)
          .innerJoin(events, eq(events.id, eventDjs.eventId))
          .where(
            and(
              eq(eventDjs.djId, target.djId),
              eq(events.status, "scheduled"),
              gt(events.startsAt, sql`now()`),
            ),
          )
      : await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(events)
          .where(
            and(
              eq(events.venueId, target.venueId),
              eq(events.status, "scheduled"),
              gt(events.startsAt, sql`now()`),
            ),
          );
  return row?.count ?? 0;
}

/**
 * Create or merge the single open task for an entity. Callers hold the
 * catalogue advisory lock, which serializes the lookup and insert.
 */
export async function enqueueReconciliation(
  tx: Transaction,
  target: Target,
  checks: readonly ReconciliationCheck[],
  reason: string | null,
  options: { replaceReason?: boolean } = {},
) {
  const column = targetColumn(target);
  const [open] = await tx
    .select()
    .from(tasks)
    .where(and(eq(column, targetId(target)), ne(tasks.state, "done")))
    .for("update");
  const priority = await upcomingCount(tx, target);
  if (open) {
    const merged = knownChecks([...open.checks, ...checks]);
    // New checks or an explicit flag wake a parked task. A processing task
    // keeps its claim snapshot, so completion turns what the claimant never
    // saw into a follow-up instead of consuming it.
    const wake =
      open.state === "deferred" &&
      (!!options.replaceReason ||
        checks.some((check) => !open.checks.includes(check)));
    const [row] = await tx
      .update(tasks)
      .set({
        checks: merged,
        priority,
        reason: options.replaceReason ? reason : (open.reason ?? reason),
        ...(wake
          ? { state: "pending" as const, attempts: 0, lastReason: null }
          : {}),
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(tasks.id, open.id))
      .returning();
    if (!row) throw new Error("Task merge failed");
    return row;
  }
  const [row] = await tx
    .insert(tasks)
    .values({ ...target, checks: knownChecks(checks), reason, priority })
    .returning();
  if (!row) throw new Error("Task insert failed");
  return row;
}

/** Recompute the priority of open DJ tasks after their events were written. */
export async function refreshDjPriorities(tx: Transaction, djIds: string[]) {
  if (!djIds.length) return;
  await tx
    .update(tasks)
    .set({
      priority: sql`(SELECT count(*)::int FROM event_djs ed JOIN events e ON e.id = ed.event_id WHERE ed.dj_id = ${tasks.djId} AND e.status = 'scheduled' AND e.starts_at > now())`,
    })
    .where(and(inArray(tasks.djId, djIds), ne(tasks.state, "done")));
}

const publicTask = (
  row: TaskRow,
  entity: { slug: string; name: string } | undefined,
) => ({
  taskId: row.id,
  entityType: entityTypeOf(row),
  entityId: row.djId ?? row.venueId,
  slug: entity?.slug ?? null,
  name: entity?.name ?? null,
  checks: row.checks,
  reason: row.reason,
  priority: row.priority,
  state: row.state,
  attempts: row.attempts,
  lastReason: row.lastReason,
  leaseExpiresAt: iso(row.leaseExpiresAt),
  outcome: row.outcome,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  completedAt: iso(row.completedAt),
});

async function namesFor(db: Database | Transaction, rows: TaskRow[]) {
  const djIds = rows.flatMap((row) => (row.djId ? [row.djId] : []));
  const venueIds = rows.flatMap((row) => (row.venueId ? [row.venueId] : []));
  const names = new Map<string, { slug: string; name: string }>();
  if (djIds.length)
    for (const dj of await db
      .select({ id: djs.id, slug: djs.slug, name: djs.name })
      .from(djs)
      .where(inArray(djs.id, djIds)))
      names.set(dj.id, dj);
  if (venueIds.length)
    for (const venue of await db
      .select({ id: venues.id, slug: venues.slug, name: venues.name })
      .from(venues)
      .where(inArray(venues.id, venueIds)))
      names.set(venue.id, venue);
  return names;
}

const excerptRadius = 140;
function excerptAround(text: string, name: string) {
  if (name.trim().length < 3) return null;
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - excerptRadius);
  const end = Math.min(text.length, at + name.length + excerptRadius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Entity snapshot plus bounded, untrusted evidence for a claimed task. */
async function taskContext(tx: Transaction, row: TaskRow) {
  const type = entityTypeOf(row);
  const entity =
    type === "dj"
      ? (
          await tx
            .select()
            .from(djs)
            .where(eq(djs.id, row.djId ?? ""))
        )[0]
      : (
          await tx
            .select()
            .from(venues)
            .where(eq(venues.id, row.venueId ?? ""))
        )[0];
  if (!entity) throw new DomainError("not_found", "Task entity not found");
  const link =
    type === "dj"
      ? and(eq(eventDjs.djId, entity.id))
      : eq(events.venueId, entity.id);
  const base = () => {
    const query = tx
      .select({
        eventId: events.id,
        title: events.title,
        slug: events.slug,
        startsAt: events.startsAt,
        venue: venues.name,
        city: venues.city,
        sourceUrl: events.sourceUrl,
      })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId));
    return type === "dj"
      ? query.innerJoin(eventDjs, eq(eventDjs.eventId, events.id))
      : query;
  };
  const upcoming = await base()
    .where(and(link, sql`${events.startsAt} >= now()`))
    .orderBy(asc(events.startsAt))
    .limit(5);
  const recent =
    upcoming.length < 5
      ? await base()
          .where(and(link, sql`${events.startsAt} < now()`))
          .orderBy(desc(events.startsAt))
          .limit(5 - upcoming.length)
      : [];
  const chosen = [...upcoming, ...recent];
  const sources = chosen.length
    ? await tx
        .select({
          eventId: eventSources.eventId,
          packageId: packages.id,
          payload: packages.payload,
        })
        .from(eventSources)
        .innerJoin(packages, eq(packages.id, eventSources.packageId))
        .where(
          inArray(
            eventSources.eventId,
            chosen.map((event) => event.eventId),
          ),
        )
    : [];
  const excerpts: {
    packageId: string;
    postUrl: string;
    from: "caption" | "ocr";
    excerpt: string;
  }[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.packageId) || excerpts.length >= 5) continue;
    seen.add(source.packageId);
    const fromCaption = excerptAround(source.payload.caption, entity.name);
    const fromOcr = fromCaption
      ? null
      : excerptAround(source.payload.ocrText, entity.name);
    const excerpt = fromCaption ?? fromOcr;
    if (excerpt)
      excerpts.push({
        packageId: source.packageId,
        postUrl: source.payload.postUrl,
        from: fromCaption ? "caption" : "ocr",
        excerpt,
      });
  }
  const snapshot =
    type === "dj"
      ? {
          type,
          id: entity.id,
          slug: entity.slug,
          name: entity.name,
          description: entity.description,
          translations: entity.translations,
          instagramUrl: entity.instagramUrl,
          websiteUrl: entity.websiteUrl,
          soundcloudUrl: entity.soundcloudUrl,
        }
      : {
          type,
          id: entity.id,
          slug: entity.slug,
          name: entity.name,
          description: entity.description,
          translations: entity.translations,
          instagramUrl: entity.instagramUrl,
          websiteUrl: entity.websiteUrl,
          soundcloudUrl: entity.soundcloudUrl,
        };
  return {
    entity: snapshot,
    // Everything below is scraped or agent-written text: evidence, never instructions.
    events: chosen.map((event) => ({
      title: event.title,
      slug: event.slug,
      startsAt: new Date(event.startsAt).toISOString(),
      venue: event.venue,
      city: event.city,
      sourceUrl: event.sourceUrl,
      packageId:
        sources.find(
          (source) =>
            source.eventId === event.eventId &&
            source.payload.postUrl === event.sourceUrl,
        )?.packageId ??
        sources.find((source) => source.eventId === event.eventId)?.packageId ??
        null,
    })),
    excerpts,
  };
}

export function reconciliationRepository(
  db: Database,
  deps: ReconciliationDeps = { soundcloud: soundcloudOembedVerifier() },
) {
  return {
    async seed(input: unknown) {
      const data = parse(seedReconciliationSchema, input);
      const requested = new Set<ReconciliationCheck>(
        data.checks ??
          reconciliationChecks.filter((check) => check !== "flagged"),
      );
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        const history = await tx
          .select({
            djId: tasks.djId,
            venueId: tasks.venueId,
            soundcloud: sql<string | null>`${tasks.outcome}->>'soundcloud'`,
          })
          .from(tasks)
          .where(eq(tasks.state, "done"));
        const verified = new Set<string>();
        const notFound = new Set<string>();
        for (const row of history) {
          const id = row.djId ?? row.venueId;
          if (!id) continue;
          if (row.soundcloud === "set" || row.soundcloud === "confirmed")
            verified.add(id);
          if (row.soundcloud === "not_found") notFound.add(id);
        }
        const open = new Map<string, TaskRow>();
        for (const row of await tx
          .select()
          .from(tasks)
          .where(ne(tasks.state, "done")))
          open.set(row.djId ?? row.venueId ?? "", row);
        const upcomingByEntity = new Map<string, number>();
        for (const row of await tx
          .select({
            id: eventDjs.djId,
            count: sql<number>`count(*)::int`,
          })
          .from(eventDjs)
          .innerJoin(events, eq(events.id, eventDjs.eventId))
          .where(
            and(
              eq(events.status, "scheduled"),
              gt(events.startsAt, sql`now()`),
            ),
          )
          .groupBy(eventDjs.djId))
          upcomingByEntity.set(row.id, row.count);
        for (const row of await tx
          .select({
            id: events.venueId,
            count: sql<number>`count(*)::int`,
          })
          .from(events)
          .where(
            and(
              eq(events.status, "scheduled"),
              gt(events.startsAt, sql`now()`),
            ),
          )
          .groupBy(events.venueId))
          upcomingByEntity.set(row.id, row.count);

        type Candidate = {
          target: Target;
          id: string;
          name: string;
          priority: number;
          checks: ReconciliationCheck[];
        };
        const candidates: Candidate[] = [];
        const consider = (
          target: Target,
          profile: {
            id: string;
            name: string;
            description: string;
            translations: { en?: { description?: string } | undefined };
            websiteUrl: string | null;
            soundcloudUrl: string | null;
          },
        ) => {
          const priority = upcomingByEntity.get(profile.id) ?? 0;
          if (data.upcomingOnly && priority === 0) return;
          const checks = profileChecks(profile, {
            soundcloudVerified: verified.has(profile.id),
            soundcloudNotFound: notFound.has(profile.id),
          }).filter((check) => requested.has(check));
          // Keep entities with an open task so stale checks can resolve.
          if (checks.length || open.has(profile.id))
            candidates.push({
              target,
              id: profile.id,
              name: profile.name,
              priority,
              checks,
            });
        };
        if (data.entityType !== "venue")
          for (const dj of await tx.select().from(djs))
            consider({ djId: dj.id }, dj);
        if (data.entityType !== "dj")
          for (const venue of await tx.select().from(venues))
            consider({ venueId: venue.id }, venue);
        candidates.sort(
          (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
        );

        const byCheck: Record<string, number> = {};
        let created = 0;
        let updated = 0;
        let unchanged = 0;
        let resolved = 0;
        let skipped = 0;
        const inserts: (typeof tasks.$inferInsert)[] = [];
        for (const candidate of candidates) {
          const existing = open.get(candidate.id);
          if (existing) {
            // Only pending/deferred tasks are touched; a live claim is left alone.
            const kept = knownChecks(existing.checks).filter(
              (check) =>
                !requested.has(check) || candidate.checks.includes(check),
            );
            const merged = knownChecks([...kept, ...candidate.checks]);
            for (const check of candidate.checks)
              byCheck[check] = (byCheck[check] ?? 0) + 1;
            if (existing.state === "processing") {
              unchanged++;
              continue;
            }
            // Re-check the state in the statement itself: a claim does not
            // take the catalogue lock and may have started since the scan.
            const stillOpen = and(
              eq(tasks.id, existing.id),
              inArray(tasks.state, ["pending", "deferred"]),
            );
            if (!merged.length) {
              const removed = await tx
                .delete(tasks)
                .where(stillOpen)
                .returning({ id: tasks.id });
              if (removed.length) resolved++;
              else unchanged++;
              continue;
            }
            if (
              merged.join() === existing.checks.join() &&
              candidate.priority === existing.priority
            ) {
              unchanged++;
              continue;
            }
            const added = candidate.checks.some(
              (check) => !existing.checks.includes(check),
            );
            const rewritten = await tx
              .update(tasks)
              .set({
                checks: merged,
                priority: candidate.priority,
                ...(existing.state === "deferred" && added
                  ? { state: "pending" as const, attempts: 0, lastReason: null }
                  : {}),
                updatedAt: sql`clock_timestamp()`,
              })
              .where(stillOpen)
              .returning({ id: tasks.id });
            if (rewritten.length) updated++;
            else unchanged++;
            continue;
          }
          if (!candidate.checks.length) continue;
          for (const check of candidate.checks)
            byCheck[check] = (byCheck[check] ?? 0) + 1;
          if (created >= data.limit) {
            skipped++;
            continue;
          }
          inserts.push({
            ...candidate.target,
            checks: knownChecks(candidate.checks),
            reason: "Found by seed_reconciliation",
            priority: candidate.priority,
          });
          created++;
        }
        for (let at = 0; at < inserts.length; at += 500)
          await tx.insert(tasks).values(inserts.slice(at, at + 500));
        return { created, updated, unchanged, resolved, skipped, byCheck };
      });
    },
    async flag(input: unknown) {
      const data = parse(flagReconciliationSchema, input);
      const target: Target = data.djId
        ? { djId: data.djId }
        : { venueId: data.venueId ?? "" };
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        const [exists] =
          "djId" in target
            ? await tx
                .select({ id: djs.id })
                .from(djs)
                .where(eq(djs.id, target.djId))
            : await tx
                .select({ id: venues.id })
                .from(venues)
                .where(eq(venues.id, target.venueId));
        if (!exists)
          throw new DomainError(
            "not_found",
            "djId" in target ? "DJ not found" : "Venue not found",
          );
        const row = await enqueueReconciliation(
          tx,
          target,
          ["flagged"],
          data.reason,
          { replaceReason: true },
        );
        return publicTask(
          row,
          (await namesFor(tx, [row])).get(targetId(target)),
        );
      });
    },
    async list(input: unknown) {
      const data = parse(listReconciliationSchema, input);
      const all = await db
        .select({ state: tasks.state, checks: tasks.checks })
        .from(tasks);
      const byState: Record<string, number> = {};
      const byCheck: Record<string, number> = {};
      for (const row of all) {
        byState[row.state] = (byState[row.state] ?? 0) + 1;
        if (row.state === "done") continue;
        for (const check of row.checks)
          byCheck[check] = (byCheck[check] ?? 0) + 1;
      }
      const rows = await db
        .select()
        .from(tasks)
        .where(
          and(
            data.state ? eq(tasks.state, data.state) : undefined,
            data.check
              ? sql`${tasks.checks} @> ${JSON.stringify([data.check])}::jsonb`
              : undefined,
          ),
        )
        .orderBy(desc(tasks.priority), asc(tasks.createdAt), asc(tasks.id))
        .limit(data.limit);
      const names = await namesFor(db, rows);
      return {
        counts: { byState, byCheck },
        tasks: rows.map((row) =>
          publicTask(row, names.get(row.djId ?? row.venueId ?? "")),
        ),
      };
    },
    async claim(input: unknown) {
      const data = parse(claimReconciliationSchema, input);
      return db.transaction(async (tx) => {
        // Skip rows another transaction holds (for example a completion) so the
        // abandonment sweep can never deadlock with them.
        const abandoned = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.state, "processing"),
              lte(tasks.leaseExpiresAt, sql`clock_timestamp()`),
              sql`${tasks.attempts} >= ${maxAttempts}`,
            ),
          )
          .for("update", { skipLocked: true });
        if (abandoned.length)
          await tx
            .update(tasks)
            .set({
              state: "deferred",
              lastReason: abandonedReason,
              leaseToken: null,
              leaseExpiresAt: null,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(
              inArray(
                tasks.id,
                abandoned.map((row) => row.id),
              ),
            );
        const available = await tx
          .select()
          .from(tasks)
          .where(
            or(
              eq(tasks.state, "pending"),
              and(
                eq(tasks.state, "processing"),
                lte(tasks.leaseExpiresAt, sql`now()`),
              ),
            ),
          )
          .orderBy(desc(tasks.priority), asc(tasks.createdAt), asc(tasks.id))
          .limit(data.limit)
          .for("update", { skipLocked: true });
        const claimed = [];
        for (const row of available) {
          const token = randomUUID();
          const [updated] = await tx
            .update(tasks)
            .set({
              state: "processing",
              leaseToken: token,
              leaseExpiresAt: sql`now() + ${data.leaseSeconds} * interval '1 second'`,
              attempts: sql`${tasks.attempts} + 1`,
              claimed: { checks: row.checks, reason: row.reason },
              updatedAt: sql`now()`,
            })
            .where(eq(tasks.id, row.id))
            .returning();
          if (!updated) throw new Error("Claim did not return task");
          const context = await taskContext(tx, updated);
          claimed.push({
            taskId: updated.id,
            claimToken: token,
            checks: updated.checks,
            reason: updated.reason,
            attempts: updated.attempts,
            leaseExpiresAt: iso(updated.leaseExpiresAt),
            ...context,
          });
        }
        return { claimed: claimed.length, tasks: claimed };
      });
    },
    async complete(input: unknown) {
      const data = parse(completeReconciliationSchema, input);
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, data.taskId));
      if (!task) throw new DomainError("not_found", "Task not found");
      const type = entityTypeOf(task);
      const entityId = task.djId ?? task.venueId ?? "";
      const parsed =
        type === "dj"
          ? { type, changes: parseDjChanges(data.changes) }
          : { type, changes: parseVenueChanges(data.changes) };
      const changes = parsed.changes;
      const hasChanges = Object.values(changes).some((v) => v !== undefined);
      const digest = requestDigest(data.changes, data.outcome);
      // Replays and settled tasks skip the network; the transaction decides.
      // A profile is resolved when it is new, and also when the task is about
      // confirming the stored one, so "confirmed" always rests on fresh evidence.
      let evidence: SoundcloudEvidence | undefined;
      if (task.state !== "done") {
        // Reject a stale claimant before spending a network call on it.
        if (
          task.state !== "processing" ||
          task.leaseToken !== data.claimToken ||
          !task.leaseExpiresAt ||
          new Date(task.leaseExpiresAt) <= new Date()
        )
          throw new DomainError(
            "stale_lease",
            "Claim is expired, replaced, or task is no longer processing",
          );
        const storedUrl = await storedSoundcloud(
          db,
          type === "dj" ? { dj: entityId } : { venue: entityId },
        );
        const resulting =
          changes.soundcloudUrl === undefined
            ? storedUrl
            : changes.soundcloudUrl;
        const confirming =
          data.outcome.soundcloud === "confirmed" ||
          task.checks.includes("soundcloud_unverified") ||
          task.checks.includes("soundcloud_in_website");
        if (resulting && (resulting !== storedUrl || confirming))
          evidence = await deps.soundcloud.verify(resulting);
      }
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
        const [locked] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, data.taskId))
          .for("update");
        if (!locked) throw new DomainError("not_found", "Task not found");
        if (
          locked.state === "done" &&
          locked.completedToken === data.claimToken
        ) {
          const recorded = locked.outcome?.requestDigest;
          if (recorded !== undefined && recorded !== digest)
            throw new DomainError(
              "identity_conflict",
              "This task was already completed with this claim token but different changes or outcome; the recorded result stands",
            );
          return {
            taskId: locked.id,
            state: "done" as const,
            replayed: true,
            outcome: locked.outcome,
          };
        }
        const [active] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, data.taskId),
              eq(tasks.state, "processing"),
              eq(tasks.leaseToken, data.claimToken),
              gt(tasks.leaseExpiresAt, sql`clock_timestamp()`),
            ),
          );
        if (!active)
          throw new DomainError(
            "stale_lease",
            "Claim is expired, replaced, or task is no longer processing",
          );
        const [stored] =
          type === "dj"
            ? await tx.select().from(djs).where(eq(djs.id, entityId))
            : await tx.select().from(venues).where(eq(venues.id, entityId));
        if (!stored)
          throw new DomainError("not_found", "Task entity not found");
        // Clearing the German bio clears the English one with it.
        const clearEnglish = clearsEnglishWithGerman(stored, data.changes);
        const effective = clearEnglish
          ? { ...data.changes, translations: null }
          : data.changes;
        const problems = completionProblems({
          checks: locked.checks,
          stored,
          changes: effective,
          outcome: data.outcome,
        });
        if (problems.length)
          throw new DomainError("invalid_input", problems.join("; "));
        let genreWarnings: string[] = [];
        const entity =
          hasChanges || clearEnglish
            ? parsed.type === "dj"
              ? await applyDjChanges(tx, entityId, {
                  ...parsed.changes,
                  ...(clearEnglish ? { translations: null } : {}),
                }).then((applied) => {
                  genreWarnings = applied.genreWarnings;
                  return applied.dj;
                })
              : await applyVenueChanges(tx, entityId, {
                  ...parsed.changes,
                  ...(clearEnglish ? { translations: null } : {}),
                })
            : stored;
        const warnings = [
          ...genreWarnings,
          ...descriptionWarnings(entity.description, entity.translations),
        ];
        const outcome = {
          ...data.outcome,
          changed: [
            ...Object.entries(changes)
              .filter(([, value]) => value !== undefined)
              .map(([key]) => key),
            ...(clearEnglish ? ["translations"] : []),
          ],
          ...(evidence ? { soundcloudEvidence: evidence } : {}),
          requestDigest: digest,
        };
        const [done] = await tx
          .update(tasks)
          .set({
            state: "done",
            completedToken: data.claimToken,
            outcome,
            leaseToken: null,
            leaseExpiresAt: null,
            lastReason: null,
            completedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(tasks.id, data.taskId),
              eq(tasks.leaseToken, data.claimToken),
              gt(tasks.leaseExpiresAt, sql`clock_timestamp()`),
              isNotNull(tasks.leaseToken),
            ),
          )
          .returning();
        if (!done)
          throw new DomainError(
            "stale_lease",
            "Lease expired during completion; claim again",
          );
        // Checks or a flag reason that arrived after the claim were never seen
        // by this claimant; they continue as a fresh pending task.
        const seen = locked.claimed?.checks ?? locked.checks;
        const late = locked.checks.filter((check) => !seen.includes(check));
        const reflagged =
          locked.claimed !== null &&
          locked.checks.includes("flagged") &&
          locked.reason !== locked.claimed.reason;
        const followUp =
          late.length || reflagged
            ? await enqueueReconciliation(
                tx,
                type === "dj" ? { djId: entityId } : { venueId: entityId },
                knownChecks(late.length ? late : ["flagged"]),
                locked.reason,
              )
            : undefined;
        return {
          taskId: done.id,
          state: "done" as const,
          replayed: false,
          outcome,
          entity,
          ...(followUp ? { followUpTaskId: followUp.id } : {}),
          ...(evidence ? { soundcloud: evidence } : {}),
          ...(warnings.length ? { warnings } : {}),
        };
      });
    },
    async defer(input: unknown) {
      const data = parse(deferReconciliationSchema, input);
      return db.transaction(async (tx) => {
        // Lock first; validate the lease in the next statement.
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, data.taskId))
          .for("update");
        const [row] = await tx
          .update(tasks)
          .set({
            state: "deferred",
            lastReason: data.reason,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(tasks.id, data.taskId),
              eq(tasks.state, "processing"),
              eq(tasks.leaseToken, data.claimToken),
              gt(tasks.leaseExpiresAt, sql`clock_timestamp()`),
            ),
          )
          .returning();
        if (!row)
          throw new DomainError(
            "stale_lease",
            "Claim is expired, replaced, or task is no longer processing",
          );
        return publicTask(
          row,
          (await namesFor(tx, [row])).get(row.djId ?? row.venueId ?? ""),
        );
      });
    },
    async requeue(input: unknown) {
      const data = parse(requeueReconciliationSchema, input);
      const [row] = await db
        .update(tasks)
        .set({
          state: "pending",
          attempts: 0,
          lastReason: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(tasks.id, data.taskId), eq(tasks.state, "deferred")))
        .returning();
      if (!row)
        throw new DomainError(
          "invalid_input",
          "Only a deferred task can be intentionally requeued",
        );
      return publicTask(
        row,
        (await namesFor(db, [row])).get(row.djId ?? row.venueId ?? ""),
      );
    },
  };
}
