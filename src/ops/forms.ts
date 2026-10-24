import { z } from "zod";
import { venueInputSchema } from "@/core/model";

export function parseVenueForm(form: FormData) {
  const value = (key: string) => form.get(key);
  const nullable = (key: string) => (value(key) === "" ? null : value(key));
  return venueInputSchema.parse({
    slug: value("slug"),
    name: value("name"),
    city: value("city"),
    country: value("country"),
    address: value("address"),
    timezone: value("timezone"),
    description: value("description"),
    instagramUrl: nullable("instagramUrl"),
    websiteUrl: nullable("websiteUrl"),
    imageUrl: nullable("imageUrl"),
  });
}
export const sourceChangeSchema = z.object({
  venueId: z.uuid(),
  expectedRevision: z.coerce.number().int().min(0),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});
export type ActionState = {
  status: "idle" | "error" | "success";
  message: string;
};
export const initialActionState: ActionState = { status: "idle", message: "" };
