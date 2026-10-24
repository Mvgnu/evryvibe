import { z } from "zod";
import {
  reconciliationChangesFields,
  venueChangesFields,
} from "./catalog-updates";
import { DomainError } from "./model";
import { assessDescription } from "./reconciliation";
import { isSoundcloudUrl } from "./soundcloud";

// Entity-level repair queue: one open task per DJ or venue, claimed with an
// expiring lease like post packages. Agents research, then complete with the
// entity changes and an outcome recording how identity was confirmed.

export const reconciliationChecks = [
  "description_event_bound",
  "description_filler",
  "soundcloud_missing",
  "soundcloud_unverified",
  "soundcloud_in_website",
  "flagged",
] as const;
export const reconciliationCheckSchema = z.enum(reconciliationChecks);
export type ReconciliationCheck = z.infer<typeof reconciliationCheckSchema>;
export const reconciliationStateSchema = z.enum([
  "pending",
  "processing",
  "done",
  "deferred",
]);
export const entityTypeSchema = z.enum(["dj", "venue"]);
const reason = z.string().trim().min(1).max(2000);
const taskId = z.uuid();

export const seedReconciliationSchema = z
  .object({
    entityType: entityTypeSchema.optional(),
    checks: z.array(reconciliationCheckSchema).min(1).optional(),
    upcomingOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(5000).default(200),
  })
  .strict();
export const flagReconciliationSchema = z
  .object({ djId: z.uuid().optional(), venueId: z.uuid().optional(), reason })
  .strict()
  .refine(
    (input) => (input.djId === undefined) !== (input.venueId === undefined),
    {
      message: "Supply exactly one of djId or venueId",
    },
  );
export const listReconciliationSchema = z
  .object({
    state: reconciliationStateSchema.optional(),
    check: reconciliationCheckSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const claimReconciliationSchema = z
  .object({
    limit: z.number().int().min(1).max(10).default(5),
    leaseSeconds: z.number().int().min(30).max(3600).default(900),
  })
  .strict();
export const reconciliationOutcomeSchema = z
  .object({
    description: z.enum(["rewritten", "cleared", "kept"]),
    soundcloud: z.enum([
      "set",
      "confirmed",
      "removed",
      "not_found",
      "unchanged",
    ]),
    basis: z.string().trim().min(1).max(1000),
  })
  .strict();
export const completeReconciliationSchema = z
  .object({
    taskId,
    claimToken: z.uuid(),
    changes: reconciliationChangesFields,
    outcome: reconciliationOutcomeSchema,
  })
  .strict();
export const deferReconciliationSchema = z
  .object({ taskId, claimToken: z.uuid(), reason })
  .strict();
export const requeueReconciliationSchema = z.object({ taskId }).strict();
export type ReconciliationOutcome = z.infer<typeof reconciliationOutcomeSchema>;
export type EntityType = z.infer<typeof entityTypeSchema>;

type Profile = {
  description: string;
  translations: { en?: { description?: string | undefined } | undefined };
  websiteUrl: string | null;
  soundcloudUrl: string | null;
};

/** Description problems of the German text and the English translation. */
export function descriptionIssues(
  description: string,
  translations: Profile["translations"] | undefined,
): ReconciliationCheck[] {
  const issues = new Set<ReconciliationCheck>(assessDescription(description));
  const english = translations?.en?.description;
  if (english)
    for (const issue of assessDescription(english)) issues.add(issue);
  return [...issues];
}

/** Checks that currently apply to a profile, from stored data and past outcomes. */
export function profileChecks(
  profile: Profile,
  history: { soundcloudVerified: boolean; soundcloudNotFound: boolean },
): ReconciliationCheck[] {
  const checks = descriptionIssues(profile.description, profile.translations);
  if (profile.websiteUrl && isSoundcloudUrl(profile.websiteUrl))
    checks.push("soundcloud_in_website");
  if (!profile.soundcloudUrl && !history.soundcloudNotFound)
    checks.push("soundcloud_missing");
  if (profile.soundcloudUrl && !history.soundcloudVerified)
    checks.push("soundcloud_unverified");
  return checks;
}

type Changes = z.infer<typeof reconciliationChangesFields>;

export function parseVenueChanges(changes: unknown) {
  const parsed = venueChangesFields.safeParse(changes);
  if (!parsed.success)
    throw new DomainError("invalid_input", parsed.error.message);
  return parsed.data;
}

/**
 * Rules a completion must meet so a task cannot close with the original
 * problem still in place. Returns human-readable problems.
 */
export function completionProblems(input: {
  checks: readonly string[];
  stored: Profile;
  changes: Changes;
  outcome: ReconciliationOutcome;
}): string[] {
  const { checks, stored, changes, outcome } = input;
  const description = changes.description ?? stored.description;
  const translations =
    changes.translations === undefined
      ? stored.translations
      : (changes.translations ?? {});
  const websiteUrl =
    changes.websiteUrl === undefined ? stored.websiteUrl : changes.websiteUrl;
  const soundcloudUrl =
    changes.soundcloudUrl === undefined
      ? stored.soundcloudUrl
      : changes.soundcloudUrl;
  const problems: string[] = [];
  const has = (check: ReconciliationCheck) => checks.includes(check);

  if (outcome.description === "rewritten" && !description.trim())
    problems.push(
      "outcome.description is rewritten but no description was written",
    );
  if (outcome.description === "rewritten" && changes.description === undefined)
    problems.push(
      "outcome.description is rewritten but changes.description is missing",
    );
  if (outcome.description === "cleared" && description !== "")
    problems.push(
      "outcome.description is cleared but the description is not empty",
    );
  if (
    outcome.description === "kept" &&
    changes.description !== undefined &&
    changes.description !== stored.description
  )
    problems.push(
      "outcome.description is kept but changes.description differs",
    );
  // Whatever the task was about, never write a weaker description than a bio.
  if (changes.description && assessDescription(changes.description).length)
    problems.push(
      "changes.description reads like an event note or filler; describe the artist or venue, or leave it empty",
    );
  // The English text travels with the German one: it may not read like an
  // event note either, and a cleared German bio leaves no English bio behind.
  if (changes.description !== undefined || changes.translations !== undefined) {
    const english = translations?.en?.description;
    if (english && assessDescription(english).length)
      problems.push(
        "translations.en.description reads like an event note or filler; rewrite or clear it",
      );
    if (english && description === "")
      problems.push(
        "The description is cleared but translations.en.description is not; clear both",
      );
  }
  if (has("description_event_bound") || has("description_filler")) {
    const remaining = descriptionIssues(description, translations);
    if (remaining.length)
      problems.push(
        `The resulting description still has issues (${remaining.join(", ")}); rewrite it as an artist or venue bio, or clear it`,
      );
  }

  if (outcome.soundcloud === "set" && !changes.soundcloudUrl)
    problems.push(
      "outcome.soundcloud is set but changes.soundcloudUrl is missing",
    );
  if (outcome.soundcloud === "confirmed" && !soundcloudUrl)
    problems.push(
      "outcome.soundcloud is confirmed but the record has no SoundCloud profile",
    );
  if (
    (outcome.soundcloud === "removed" || outcome.soundcloud === "not_found") &&
    soundcloudUrl
  )
    problems.push(
      `outcome.soundcloud is ${outcome.soundcloud} but a SoundCloud profile remains; clear it with changes.soundcloudUrl null`,
    );
  if (
    outcome.soundcloud === "unchanged" &&
    changes.soundcloudUrl !== undefined &&
    changes.soundcloudUrl !== stored.soundcloudUrl
  )
    problems.push(
      "outcome.soundcloud is unchanged but changes.soundcloudUrl differs",
    );
  if (
    has("soundcloud_missing") &&
    !["set", "not_found"].includes(outcome.soundcloud)
  )
    problems.push(
      "soundcloud_missing needs outcome.soundcloud set or not_found",
    );
  if (
    has("soundcloud_unverified") &&
    !["set", "confirmed", "removed"].includes(outcome.soundcloud)
  )
    problems.push(
      "soundcloud_unverified needs outcome.soundcloud set, confirmed or removed",
    );
  if (has("soundcloud_in_website") && websiteUrl && isSoundcloudUrl(websiteUrl))
    problems.push(
      "websiteUrl still points at SoundCloud; move it to soundcloudUrl or clear it",
    );
  return problems;
}

/** True when clearing the German description should also clear a stored English one. */
export function clearsEnglishWithGerman(
  stored: Profile,
  changes: Changes,
): boolean {
  return (
    changes.description === "" &&
    changes.translations === undefined &&
    !!stored.translations?.en?.description
  );
}
