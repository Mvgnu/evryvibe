import { z } from "zod";

export const geocodeQuerySchema = z
  .object({
    query: z.string().trim().min(3).max(200),
  })
  .strict();
export const geocodeResultSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(1000),
    sourceUrl: z
      .url()
      .refine((url) =>
        /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(
          url,
        ),
      ),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export const geocodeResultsSchema = z.array(geocodeResultSchema).max(5);
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;
const numeric = z
  .string()
  .regex(/^-?(?:\d+)(?:\.\d+)?$/)
  .transform(Number);
const nominatimResultSchema = z.object({
  osm_type: z.enum(["node", "way", "relation"]),
  osm_id: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().positive().safe(),
  ]),
  display_name: z.string().trim().min(1).max(1000),
  lat: numeric.pipe(z.number().finite().min(-90).max(90)),
  lon: numeric.pipe(z.number().finite().min(-180).max(180)),
});
export function parseNominatimResponse(input: unknown): GeocodeResult[] {
  const parsed = z.array(nominatimResultSchema).max(5).safeParse(input);
  if (!parsed.success) throw new Error("Invalid geocoder response");
  return parsed.data.map((entry) => ({
    id: `${entry.osm_type}/${entry.osm_id}`,
    sourceUrl: `https://www.openstreetmap.org/${entry.osm_type}/${entry.osm_id}`,
    name: entry.display_name,
    latitude: entry.lat,
    longitude: entry.lon,
  }));
}
