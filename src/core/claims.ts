import { z } from "zod";
import { httpsUrlSchema } from "./model";

export const artistLinkIconSchema = z.enum([
  "link",
  "instagram",
  "soundcloud",
  "spotify",
  "youtube",
  "bandcamp",
  "tiktok",
  "booking",
  "merch",
  "tickets",
]);
// A booking email is a real action, not a web URL. Restrict mailto to a
// single plain mailbox; query headers and arbitrary schemes are not accepted.
export const artistLinkUrlSchema = z.union([
  httpsUrlSchema,
  z
    .string()
    .trim()
    .max(327)
    .regex(/^mailto:[^?&#\s]+$/i)
    .refine(
      (value) => z.email().safeParse(value.slice(7)).success,
      "Invalid email address",
    ),
]);
export const artistLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    url: artistLinkUrlSchema,
    icon: artistLinkIconSchema,
  })
  .strict();
export const artistProfileSchema = z
  .object({
    bio: z.string().trim().max(5000),
    links: z.array(artistLinkSchema).max(20),
  })
  .strict();
export type ArtistProfile = z.infer<typeof artistProfileSchema>;

// An IGSID is scoped to the Meta professional account; it is not a username.
export const verifiedMessageSchema = z
  .object({
    instagramUsername: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._]{1,30}$/),
    instagramScopedId: z.string().trim().min(1).max(200),
    messageId: z.string().trim().min(1).max(255),
    follows: z.boolean(),
  })
  .strict();
