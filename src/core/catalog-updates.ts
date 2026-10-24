import { z } from "zod";
import { labelOcrMediaIds } from "./media";
import {
  djInputSchema,
  eventSchema,
  mediaIdSchema,
  venueInputSchema,
  DomainError,
} from "./model";

const nonempty = (changes: Record<string, unknown>) =>
  Object.values(changes).some((value) => value !== undefined);

// Field sets without the "something must change" rule, shared by the update
// tools and by reconciliation, where an empty change set is legitimate.
export const djChangesFields = djInputSchema
  .omit({ slug: true })
  .partial()
  .extend({
    translations: djInputSchema.shape.translations.nullable(),
    sampleMediaId: mediaIdSchema.nullable().optional(),
  })
  .strict();
// The Instagram profile stays with set_venue_profile because it controls
// collection; venue slugs are immutable.
export const venueChangesFields = venueInputSchema
  .omit({ slug: true, instagramUrl: true })
  .partial()
  .extend({ translations: venueInputSchema.shape.translations.nullable() })
  .strict();
const sampleExclusive = (changes: {
  sampleMediaId?: string | null | undefined;
  samplePostUrl?: string | null | undefined;
}) =>
  changes.sampleMediaId === undefined || changes.samplePostUrl === undefined;
const sampleMessage = "Supply sampleMediaId or samplePostUrl, never both";
export const djChangesSchema = djChangesFields
  .refine(nonempty, "Supply at least one field to update")
  .refine(sampleExclusive, sampleMessage);
export const venueChangesSchema = venueChangesFields.refine(
  nonempty,
  "Supply at least one field to update",
);
/** Reconciliation changes: either entity's fields, validated per entity later. */
export const reconciliationChangesFields = djChangesFields
  .extend(venueChangesFields.shape)
  .strict();
export function parseDjChanges(changes: unknown) {
  const parsed = djChangesFields
    .refine(sampleExclusive, sampleMessage)
    .safeParse(changes);
  if (!parsed.success)
    throw new DomainError("invalid_input", parsed.error.message);
  return parsed.data;
}
export const eventChangesSchema = z
  .object(eventSchema.shape)
  .omit({
    id: true,
    slug: true,
    sourceUrl: true,
    sourceAccountUrl: true,
    observedAt: true,
  })
  .partial()
  .extend({
    translations: eventSchema.shape.translations.nullable(),
    imageMediaId: mediaIdSchema.nullable().optional(),
  })
  .strict()
  .refine(nonempty, "Supply at least one field to update")
  .refine(
    (changes) =>
      changes.imageMediaId === undefined || changes.imageUrl === undefined,
    "Supply imageMediaId or imageUrl, never both",
  )
  .refine(
    (changes) =>
      changes.djIds === undefined ||
      new Set(changes.djIds).size === changes.djIds.length,
    "An event cannot repeat DJs",
  );
export const updateDjSchema = z
  .object({ djId: z.uuid(), changes: djChangesSchema })
  .strict();
export const updateVenueSchema = z
  .object({ venueId: z.uuid(), changes: venueChangesSchema })
  .strict();
export const updateEventSchema = z
  .object({ eventId: z.uuid(), changes: eventChangesSchema })
  .strict();
export type DjChanges = z.infer<typeof djChangesSchema>;
export type DjFieldChanges = z.infer<typeof djChangesFields>;
export type VenueChanges = z.infer<typeof venueChangesFields>;
export type EventChanges = z.infer<typeof eventChangesSchema>;

/** Recognize exact media tokens inside OCR provenance labels, including old captures. */
export function ocrReferencesMediaId(
  sourceUrl: string,
  ocrText: string,
  mediaId: string,
): boolean {
  const labeled = labelOcrMediaIds(sourceUrl, ocrText);
  for (const match of labeled.matchAll(
    /^\[[^\]\n]*?; media ID ([^;\]\s]+)(?=[;\]\s])/gm,
  )) {
    if (match[1] === mediaId) return true;
  }
  return false;
}
