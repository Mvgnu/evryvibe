import { z } from "zod";

export const cityContentSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a city URL slug");

function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !/<[^>]*>/.test(value) &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      "Supply plain text without HTML or control characters",
    );
}

export const cityEditorialLocaleSchema = z
  .object({
    heading: plainText(160),
    intro: plainText(2000),
    seoTitle: plainText(160),
    metaDescription: plainText(320),
  })
  .strict();

export const cityEditorialInputSchema = z
  .object({
    citySlug: cityContentSlugSchema,
    de: cityEditorialLocaleSchema,
    en: cityEditorialLocaleSchema,
  })
  .strict();

export const cityEditorialSchema = cityEditorialInputSchema.extend({
  updatedAt: z.iso.datetime(),
});

export type CityEditorialInput = z.infer<typeof cityEditorialInputSchema>;
export type CityEditorial = z.infer<typeof cityEditorialSchema>;
