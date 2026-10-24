import { instagramMediaId, mediaIdSchema } from "./media";
export { instagramMediaId, mediaIdSchema } from "./media";
import { soundcloudProfileSchema } from "./soundcloud";
export { soundcloudProfileSchema } from "./soundcloud";
import { z } from "zod";

const text = z.string().trim().min(1).max(200);
export const httpsUrlSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS URL without credentials");
export const instagramCdnImageUrlSchema = httpsUrlSchema.refine((value) => {
  const url = new URL(value);
  return (
    !url.port &&
    ["cdninstagram.com", "fbcdn.net"].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  );
}, "Use a direct Instagram CDN image URL");
const publishableImageUrlSchema = httpsUrlSchema.refine((value) => {
  const url = new URL(value);
  const instagramMediaHost = [
    "cdninstagram.com",
    "fbcdn.net",
    "instagram.com",
  ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  return (
    !instagramMediaHost &&
    !(
      (url.hostname === "evryvibe.com" ||
        url.hostname.endsWith(".evryvibe.com")) &&
      url.pathname.startsWith("/media/")
    )
  );
}, "Captured Instagram images and EVRYVIBE media assets cannot be published as images");
const eventImageUrlSchema = httpsUrlSchema.refine((value) => {
  const url = new URL(value);
  return !(
    (url.hostname === "evryvibe.com" ||
      url.hostname.endsWith(".evryvibe.com")) &&
    url.pathname.startsWith("/media/")
  );
}, "EVRYVIBE does not host captured media");
function instagramUrl(kind: "profile" | "post" | "source") {
  return httpsUrlSchema.transform((value, ctx) => {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "");
    const post = /^\/(p|reel)\/([A-Za-z0-9_-]+)$/.test(path);
    const storyMatch = /^\/stories\/([A-Za-z0-9._]{1,30})\/(\d+)$/.exec(path);
    const story = !!storyMatch && storyMatch[1]?.toLowerCase() !== "highlights";
    const profile =
      /^\/[A-Za-z0-9._]{1,30}$/.test(path) &&
      !["/p", "/reel", "/stories", "/explore", "/accounts"].includes(
        path.toLowerCase(),
      );
    const match =
      kind === "profile" ? profile : kind === "post" ? post : post || story;
    if (
      !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      url.port ||
      !match
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Use an Instagram ${kind} permalink`,
      });
      return z.NEVER;
    }
    return `https://www.instagram.com${kind === "profile" || story ? path.toLowerCase() : path}/`;
  });
}
export const instagramProfileSchema = instagramUrl("profile");
export const instagramPostSchema = instagramUrl("post");
// Story permalinks are source evidence only; DJ embeds remain post/reel-only.
export const instagramSourceSchema = instagramUrl("source");
export const instantSchema = z.iso.datetime({ offset: true });
export const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone");
export const descriptionTranslationsSchema = z
  .object({
    en: z
      .object({ description: z.string().max(10000).optional() })
      .strict()
      .optional(),
  })
  .strict();
export const eventTranslationsSchema = z
  .object({
    en: z
      .object({
        title: text.optional(),
        description: z.string().max(10000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DescriptionTranslations = z.infer<
  typeof descriptionTranslationsSchema
>;
export type EventTranslations = z.infer<typeof eventTranslationsSchema>;
export const imageCandidateSchema = z
  .object({
    url: instagramCdnImageUrlSchema,
    mediaId: mediaIdSchema.optional(),
    slide: z.number().int().min(1).max(20),
  })
  .strict();

const socialFields = {
  imageUrl: httpsUrlSchema.nullable(),
  instagramUrl: instagramProfileSchema.nullable(),
  websiteUrl: httpsUrlSchema.nullable(),
  soundcloudUrl: soundcloudProfileSchema.nullable(),
};
export const venueSchema = z
  .object({
    id: z.string().uuid(),
    slug: slugSchema,
    name: text,
    city: text,
    country: z.string().trim().min(2).max(100),
    address: text,
    timezone: timezoneSchema,
    description: z.string().max(10000),
    translations: descriptionTranslationsSchema.optional(),
    ...socialFields,
  })
  .strict();
export const djSchema = z
  .object({
    id: z.string().uuid(),
    slug: slugSchema,
    name: text,
    description: z.string().max(10000),
    translations: descriptionTranslationsSchema.optional(),
    genres: z.array(text).max(20),
    ...socialFields,
    samplePostUrl: instagramPostSchema.nullable(),
  })
  .strict();
export const eventSchema = z
  .object({
    id: z.string().uuid(),
    slug: slugSchema,
    title: text,
    description: z.string().max(10000),
    translations: eventTranslationsSchema.optional(),
    venueId: z.string().uuid(),
    djIds: z.array(z.string().uuid()).max(100),
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    genres: z.array(text).max(20),
    imageUrl: eventImageUrlSchema.nullable(),
    ticketUrl: httpsUrlSchema.nullable(),
    websiteUrl: httpsUrlSchema.nullable(),
    sourceUrl: instagramSourceSchema,
    sourceAccountUrl: instagramProfileSchema.nullable().optional(),
    observedAt: instantSchema,
    status: z.enum(["scheduled", "cancelled"]),
  })
  .strict()
  .refine(
    (event) =>
      !event.endsAt || Date.parse(event.endsAt) > Date.parse(event.startsAt),
    { message: "Event end must follow start", path: ["endsAt"] },
  );
export type Venue = z.infer<typeof venueSchema>;
export type Dj = z.infer<typeof djSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Catalog = {
  events: Event[];
  venues: Venue[];
  djs: Dj[];
  mode: "demo" | "database" | "empty";
};

export const postPackageInputSchema = z
  .object({
    postUrl: instagramSourceSchema,
    caption: z.string().max(30000),
    ocrText: z.string().max(60000),
    accountUrl: instagramProfileSchema,
    capturedAt: instantSchema,
    // Only public post/reel covers are retained. Story captures must never
    // carry image candidates, even while their OCR remains usable evidence.
    imageCandidates: z.array(imageCandidateSchema).max(20).optional(),
  })
  .strict();
export const postPackageSchema = postPackageInputSchema
  .refine(
    (source) =>
      new Set(source.imageCandidates?.map((candidate) => candidate.slide))
        .size === (source.imageCandidates?.length ?? 0),
    {
      message: "Image candidates must have unique source slides",
      path: ["imageCandidates"],
    },
  )
  .refine(
    (source) =>
      !source.postUrl.includes("/stories/") || !source.imageCandidates?.length,
    {
      message: "Stories cannot publish image candidates",
      path: ["imageCandidates"],
    },
  )
  .refine(
    (source) => {
      const story =
        /^https:\/\/www\.instagram\.com\/stories\/([^/]+)\/\d+\/$/.exec(
          source.postUrl,
        );
      return (
        !story || source.accountUrl === `https://www.instagram.com/${story[1]}/`
      );
    },
    { message: "Story account must match accountUrl", path: ["accountUrl"] },
  )
  .refine(
    (source) =>
      source.imageCandidates?.every(
        (candidate) =>
          candidate.mediaId === undefined ||
          candidate.mediaId ===
            instagramMediaId(source.postUrl, candidate.slide),
      ) ?? true,
    {
      message: "Image media ID must match source permalink and slide",
      path: ["imageCandidates"],
    },
  )
  .transform((source) => ({
    ...source,
    ...(source.imageCandidates === undefined
      ? {}
      : {
          imageCandidates: source.imageCandidates.map((candidate) => ({
            ...candidate,
            mediaId: instagramMediaId(source.postUrl, candidate.slide),
          })),
        }),
  }));
export type PostPackage = z.infer<typeof postPackageSchema>;
// soundcloudUrl is optional for writers that predate it: omitted keeps the
// stored profile on update and stores null on insert.
// imageUrl and websiteUrl are optional: omitted keeps the stored value on an
// existing venue and stores null on insert; null clears. instagramUrl stays
// required because it is the identity.
export const venueInputSchema = venueSchema.omit({ id: true }).extend({
  imageUrl: publishableImageUrlSchema.nullable().optional(),
  websiteUrl: httpsUrlSchema.nullable().optional(),
  soundcloudUrl: soundcloudProfileSchema.nullable().optional(),
});
export const djInputSchema = djSchema.omit({ id: true }).extend({
  imageUrl: publishableImageUrlSchema.nullable(),
  soundcloudUrl: soundcloudProfileSchema.nullable().optional(),
});
export const eventInputSchema = z
  .object({
    slug: slugSchema,
    title: text,
    // Omitted description, genres, links and cover keep the stored values on an
    // existing event; a new event gets "", [], null and no cover.
    description: z.string().max(10000).optional(),
    translations: eventTranslationsSchema.optional(),
    venueSlug: slugSchema,
    djSlugs: z.array(slugSchema).max(100),
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    genres: z.array(text).max(20).optional(),
    imageUrl: eventImageUrlSchema.nullable().optional(),
    imageMediaId: mediaIdSchema.nullable().optional(),
    ticketUrl: httpsUrlSchema.nullable().optional(),
    websiteUrl: httpsUrlSchema.nullable().optional(),
    status: z.enum(["scheduled", "cancelled"]),
  })
  .strict()
  .refine((event) => !event.imageMediaId || !event.imageUrl, {
    message: "Provide imageMediaId or imageUrl, not both",
    path: ["imageMediaId"],
  })
  .refine(
    (event) =>
      !event.endsAt || Date.parse(event.endsAt) > Date.parse(event.startsAt),
    { message: "Event end must follow start", path: ["endsAt"] },
  );
// Bundle DJs may omit description and genres: an existing DJ keeps its stored
// values, a new one gets "" and []. Repeat a DJ here only to create or fill it.
export const bundleDjSchema = djInputSchema.extend({
  description: z.string().max(10000).optional(),
  genres: z.array(text).max(20).optional(),
  // Omitted keeps the stored value, null clears; insert stores null.
  imageUrl: publishableImageUrlSchema.nullable().optional(),
  websiteUrl: httpsUrlSchema.nullable().optional(),
  samplePostUrl: instagramPostSchema.nullable().optional(),
});
export const bundleSchema = z
  .object({
    venues: z.array(venueInputSchema).max(20),
    djs: z.array(bundleDjSchema).max(100),
    events: z.array(eventInputSchema).min(1).max(50),
  })
  .strict();
export type PublishBundle = z.infer<typeof bundleSchema>;
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "stale_source"
      | "source_disabled"
      | "missing_facts"
      | "stale_lease"
      | "invalid_input"
      | "identity_conflict"
      | "not_found"
      // A dependency (for example SoundCloud) is unreachable; retry later.
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
