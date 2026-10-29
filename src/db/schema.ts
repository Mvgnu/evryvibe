import { sql } from "drizzle-orm";
import {
  pgTable,
  boolean,
  check,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import type {
  PostPackage,
  DescriptionTranslations,
  EventTranslations,
} from "../core/model";
import type { CityEditorialInput } from "../core/city-editorial";

export const cityEditorial = pgTable("city_editorial", {
  citySlug: text("city_slug").primaryKey(),
  de: jsonb().$type<CityEditorialInput["de"]>().notNull(),
  en: jsonb().$type<CityEditorialInput["en"]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
export const venues = pgTable("venues", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  city: text().notNull(),
  country: text().notNull(),
  address: text().notNull(),
  timezone: text().notNull(),
  description: text().notNull(),
  translations: jsonb().$type<DescriptionTranslations>().notNull().default({}),
  imageUrl: text("image_url"),
  instagramUrl: text("instagram_url").unique(),
  websiteUrl: text("website_url"),
  soundcloudUrl: text("soundcloud_url").unique(),
});
export const djs = pgTable("djs", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  description: text().notNull(),
  translations: jsonb().$type<DescriptionTranslations>().notNull().default({}),
  genres: jsonb().$type<string[]>().notNull(),
  imageUrl: text("image_url"),
  instagramUrl: text("instagram_url").unique(),
  websiteUrl: text("website_url"),
  soundcloudUrl: text("soundcloud_url").unique(),
  samplePostUrl: text("sample_post_url"),
});
// Retired DJ slugs remain permanent routes to the surviving identity.
export const djAliases = pgTable("dj_aliases", {
  slug: text().primaryKey(),
  djId: uuid("dj_id")
    .notNull()
    .references(() => djs.id),
  evidence: text().notNull(),
  snapshot: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
export const events = pgTable(
  "events",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    description: text().notNull(),
    translations: jsonb().$type<EventTranslations>().notNull().default({}),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "string" }),
    genres: jsonb().$type<string[]>().notNull(),
    imageUrl: text("image_url"),
    imageSlide: integer("image_slide"),
    imageSuppressed: boolean("image_suppressed").notNull().default(false),
    // The public post/reel the cover came from; independent of sourceUrl,
    // which a later story or post may replace.
    imageSourceUrl: text("image_source_url"),
    ticketUrl: text("ticket_url"),
    websiteUrl: text("website_url"),
    sourceUrl: text("source_url").notNull(),
    sourceAccountUrl: text("source_account_url"),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    status: text().$type<"scheduled" | "cancelled">().notNull(),
  },
  (table) => [
    uniqueIndex("event_venue_start_unique").on(table.venueId, table.startsAt),
    check(
      "event_status_valid",
      sql`${table.status} IN ('scheduled', 'cancelled')`,
    ),
    check(
      "event_end_after_start",
      sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "event_image_slide_valid",
      sql`${table.imageSlide} IS NULL OR (${table.imageSlide} BETWEEN 1 AND 20)`,
    ),
  ],
);
export const eventDjs = pgTable(
  "event_djs",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    djId: uuid("dj_id")
      .notNull()
      .references(() => djs.id),
    position: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.djId] })],
);
export const packages = pgTable(
  "post_packages",
  {
    id: uuid().primaryKey().defaultRandom(),
    postUrl: text("post_url").notNull().unique(),
    payload: jsonb().$type<PostPackage>().notNull(),
    state: text()
      .$type<"pending" | "processing" | "done" | "deferred" | "discarded">()
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    lastReason: text("last_reason"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    completedToken: uuid("completed_token"),
    resultEventIds: jsonb("result_event_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "package_state_valid",
      sql`${table.state} IN ('pending', 'processing', 'done', 'deferred', 'discarded')`,
    ),
    check(
      "package_claim_valid",
      sql`(${table.state} = 'processing' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.state} <> 'processing' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
  ],
);
export const eventSources = pgTable(
  "event_sources",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.packageId] })],
);

export const venueSources = pgTable("venue_sources", {
  venueId: uuid("venue_id")
    .primaryKey()
    .references(() => venues.id, { onDelete: "cascade" }),
  enabled: boolean().notNull().default(false),
  revision: integer().notNull().default(0),
  lastStartedAt: timestamp("last_started_at", {
    withTimezone: true,
    mode: "string",
  }),
  lastFinishedAt: timestamp("last_finished_at", {
    withTimezone: true,
    mode: "string",
  }),
  lastSucceededAt: timestamp("last_succeeded_at", {
    withTimezone: true,
    mode: "string",
  }),
  lastError: text("last_error"),
  lastPostCount: integer("last_post_count").notNull().default(0),
});
export const packageHistory = pgTable("package_history", {
  id: uuid().primaryKey().defaultRandom(),
  packageId: uuid("package_id")
    .notNull()
    .references(() => packages.id, { onDelete: "cascade" }),
  payload: jsonb().$type<PostPackage>().notNull(),
  replacedAt: timestamp("replaced_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const reconciliationTasks = pgTable(
  "reconciliation_tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    djId: uuid("dj_id").references(() => djs.id, { onDelete: "cascade" }),
    venueId: uuid("venue_id").references(() => venues.id, {
      onDelete: "cascade",
    }),
    checks: jsonb().$type<string[]>().notNull().default([]),
    reason: text(),
    priority: integer().notNull().default(0),
    state: text()
      .$type<"pending" | "processing" | "done" | "deferred">()
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    lastReason: text("last_reason"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    completedToken: uuid("completed_token"),
    // Checks and reason the claimant saw; anything added later becomes a
    // follow-up task when the claim completes.
    claimed: jsonb().$type<{ checks: string[]; reason: string | null }>(),
    outcome: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    check(
      "reconciliation_entity_valid",
      sql`num_nonnulls(${table.djId}, ${table.venueId}) = 1`,
    ),
    check(
      "reconciliation_state_valid",
      sql`${table.state} IN ('pending', 'processing', 'done', 'deferred')`,
    ),
    check(
      "reconciliation_claim_valid",
      sql`(${table.state} = 'processing' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.state} <> 'processing' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
    check(
      "reconciliation_done_valid",
      sql`${table.state} <> 'done' OR (${table.completedToken} IS NOT NULL AND ${table.outcome} IS NOT NULL)`,
    ),
    uniqueIndex("reconciliation_open_dj")
      .on(table.djId)
      .where(sql`${table.state} <> 'done' AND ${table.djId} IS NOT NULL`),
    uniqueIndex("reconciliation_open_venue")
      .on(table.venueId)
      .where(sql`${table.state} <> 'done' AND ${table.venueId} IS NOT NULL`),
    index("reconciliation_claim_order").on(
      table.state,
      table.priority,
      table.createdAt,
    ),
  ],
);
