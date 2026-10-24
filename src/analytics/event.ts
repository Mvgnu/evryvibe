import { z } from "zod";

export const MAX_BODY_BYTES = 16_384;
export const MAX_ENGAGEMENT_MS = 300_000;

export function publicPath(raw: string): string | null {
  try {
    const path = new URL(raw, "https://evryvibe.com").pathname;
    return /^\/(?:en\/?|(?:en\/)?(?:impressum|datenschutz|kontakt|takedown|cities)\/?|(?:en\/)?(?:events|venues|djs|cities)\/[^/]+\/?|(?:en\/)?cities\/[^/]+\/\d{4}-\d{2}\/?)?$/.test(
      path,
    )
      ? path
      : null;
  } catch {
    return null;
  }
}

export function referrerOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

const pathSchema = z
  .string()
  .max(1024)
  .transform((raw, context) => {
    const path = publicPath(raw);
    if (path !== null) return path;
    context.addIssue({
      code: "custom",
      message: "Expected a public page path",
    });
    return z.NEVER;
  });
const targetSchema = z
  .string()
  .max(2048)
  .transform((raw, context) => {
    try {
      const url = new URL(raw);
      if (["http:", "https:"].includes(url.protocol))
        return `${url.origin}${url.pathname}`;
    } catch {}
    context.addIssue({ code: "custom", message: "Expected an HTTP link" });
    return z.NEVER;
  });
const common = {
  sessionId: z.uuid(),
  runtimeSession: z.literal("memory-v1"),
  path: pathSchema,
  occurredAt: z.iso.datetime(),
  attribution: z.object({
    landingPath: pathSchema,
    landingReferrer: z.string().max(2048).transform(referrerOrigin),
  }),
};
const interaction = {
  targetUrl: targetSchema.optional(),
  targetLabel: z.string().max(100).optional(),
};
// Strip unrecognized keys, including visitor IDs, arbitrary properties and titles.
export const analyticsEventSchema = z.discriminatedUnion("eventType", [
  z.object({ ...common, eventType: z.literal("pageview") }),
  z.object({
    ...common,
    ...interaction,
    eventType: z.enum(["click", "outbound", "form_submit"]),
  }),
  z.object({
    ...common,
    eventType: z.literal("engagement"),
    properties: z.object({
      engagementMs: z.number().int().min(1).max(MAX_ENGAGEMENT_MS),
    }),
  }),
]);
export type AnalyticsEvent = z.output<typeof analyticsEventSchema>;
