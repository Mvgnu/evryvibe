import { z } from "zod";
import { httpsUrlSchema, instantSchema, timezoneSchema } from "./model";

const required = z.string().trim().min(1).max(200);
const sourceUrl = httpsUrlSchema.refine((value) => {
  const url = new URL(value);
  return (
    ["www.openstreetmap.org", "openstreetmap.org"].includes(url.hostname) &&
    /^\/(node|way|relation)\/\d+\/?$/.test(url.pathname)
  );
}, "Select an OpenStreetMap location from search");
export const artistEventInputSchema = z
  .object({
    title: required,
    description: z.string().trim().max(10000),
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    ticketUrl: httpsUrlSchema.nullable(),
    lineupNames: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .refine(
        (names) =>
          new Set(names.map((name) => name.toLocaleLowerCase("de-DE"))).size ===
          names.length,
        "Duplicate artist name",
      ),
    djIds: z
      .array(z.uuid())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate artist"),
    venue: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("existing"), id: z.uuid() }).strict(),
      z
        .object({
          kind: z.literal("new"),
          name: required,
          address: required,
          city: required,
          country: z.string().trim().min(2).max(100),
          timezone: timezoneSchema,
          latitude: z.number().finite().min(-90).max(90),
          longitude: z.number().finite().min(-180).max(180),
          locationSourceUrl: sourceUrl,
        })
        .strict(),
    ]),
  })
  .strict()
  .refine(
    (data) =>
      !data.endsAt || Date.parse(data.endsAt) > Date.parse(data.startsAt),
    { message: "Event end must follow start", path: ["endsAt"] },
  );
export type ArtistEventInput = z.infer<typeof artistEventInputSchema>;
