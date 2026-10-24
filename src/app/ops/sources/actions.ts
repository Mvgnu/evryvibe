"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setVenueProfileSchema } from "@/core/sources";
import { isOperatorAuthorized, isSameOrigin } from "@/ops/auth";
import {
  parseVenueForm,
  sourceChangeSchema,
  type ActionState,
} from "@/ops/forms";
import { callOperatorTool, OperatorToolError } from "@/ops/mcp";

async function authorize() {
  const h = await headers();
  if (
    !isOperatorAuthorized(
      h.get("authorization"),
      process.env.EVRYVIBE_OPERATOR_PASSWORD,
    )
  )
    throw new Error(
      "Authorization required. Reload this page and sign in again.",
    );
  // The deployment proxy supplies the protocol; direct local development uses HTTP.
  const protocol =
    h.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "development" ? "http" : "https");
  if (!isSameOrigin(h.get("origin"), h.get("host"), protocol))
    throw new Error(
      "Request origin did not match this site. Reload this page before trying again.",
    );
}
function failed(error: unknown): ActionState {
  if (error instanceof z.ZodError)
    return {
      status: "error",
      message: error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" · "),
    };
  if (error instanceof OperatorToolError)
    return {
      status: "error",
      message: `${error.message} Refresh the list before retrying a source change.`,
    };
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "This change could not be saved. Please retry.",
  };
}
export async function changeSource(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await authorize();
    const input = sourceChangeSchema.parse(
      Object.fromEntries(
        ["venueId", "expectedRevision", "enabled"].map((key) => [
          key,
          form.get(key),
        ]),
      ),
    );
    await callOperatorTool("set_venue_source", input);
    revalidatePath("/ops/sources");
    return {
      status: "success",
      message: input.enabled ? "Collection enabled." : "Collection disabled.",
    };
  } catch (error) {
    revalidatePath("/ops/sources");
    return failed(error);
  }
}
export async function registerVenue(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await authorize();
    const venue = parseVenueForm(form);
    await callOperatorTool("upsert_venue", { venue });
    revalidatePath("/ops/sources");
    return {
      status: "success",
      message:
        "Venue saved. New venues start with collection disabled. Find the venue in the source list to enable it.",
    };
  } catch (error) {
    return failed(error);
  }
}

export async function changeProfile(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await authorize();
    const input = setVenueProfileSchema.parse({
      venueId: form.get("venueId"),
      expectedRevision: z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(form.get("expectedRevision")),
      instagramUrl:
        form.get("instagramUrl") === "" ? null : form.get("instagramUrl"),
    });
    await callOperatorTool("set_venue_profile", input);
    revalidatePath("/ops/sources");
    return {
      status: "success",
      message:
        "Profile saved; collection is disabled until you enable it again.",
    };
  } catch (error) {
    revalidatePath("/ops/sources");
    return failed(error);
  }
}
