import { z } from "zod";
import {
  instantSchema,
  instagramProfileSchema,
  postPackageSchema,
  slugSchema,
} from "./model";

export const venueSourceSchema = z
  .object({
    venueId: z.string().uuid(),
    slug: slugSchema,
    name: z.string(),
    city: z.string(),
    instagramUrl: instagramProfileSchema.nullable(),
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    lastStartedAt: instantSchema.nullable(),
    lastSucceededAt: instantSchema.nullable(),
    lastError: z.string().nullable(),
    lastPostCount: z.number().int().nonnegative(),
  })
  .strict();
export type VenueSource = z.infer<typeof venueSourceSchema>;
export const setVenueSourceSchema = z
  .object({
    venueId: z.string().uuid(),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const enqueueCollectedPackageSchema = setVenueSourceSchema
  .omit({ enabled: true })
  .extend({ package: postPackageSchema });
export const setVenueProfileSchema = setVenueSourceSchema
  .omit({ enabled: true })
  .extend({ instagramUrl: instagramProfileSchema.nullable() });
export const recordSourceRunSchema = setVenueSourceSchema
  .omit({ enabled: true })
  .extend({
    startedAt: instantSchema,
    finishedAt: instantSchema,
    postsQueued: z.number().int().min(0).max(10000),
    error: z.string().trim().min(1).max(2000).nullable(),
  })
  .refine((v) => Date.parse(v.finishedAt) >= Date.parse(v.startedAt), {
    message: "Run finish must follow start",
  });
export const refreshPackageSchema = z
  .object({ packageId: z.string().uuid(), package: postPackageSchema })
  .strict();
