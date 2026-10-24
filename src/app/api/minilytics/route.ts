import { isIP } from "node:net";
import { z } from "zod";
import { analyticsEventSchema, MAX_BODY_BYTES } from "@/analytics/event";
import { siteUrl } from "@/core/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const configSchema = z.object({
  collector: z.url().refine((raw) => new URL(raw).protocol === "https:"),
  siteId: z.string().min(1),
  secret: z.string().min(1),
});
function empty(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const config = configSchema.safeParse({
    collector: process.env.MINILYTICS_COLLECTOR_URL,
    siteId: process.env.MINILYTICS_SITE_ID,
    secret: process.env.MINILYTICS_SITE_SECRET,
  });
  if (!config.success || process.env.EVRYVIBE_DEMO === "1") return empty(503);
  const origin = request.headers.get("origin");
  if (
    (origin !== null
      ? origin !== siteUrl
      : request.headers.get("sec-fetch-site") !== "same-origin") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return empty(403);
  const ua = request.headers.get("user-agent") ?? "";
  if (
    request.headers.get("dnt") === "1" ||
    request.headers.get("sec-gpc") === "1" ||
    /bot\b|crawler|spider|headless|slurp|facebookexternalhit|preview|uptime|monitoring/i.test(
      ua,
    ) ||
    request.headers.get("next-router-prefetch") === "1" ||
    /prefetch/i.test(
      `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`,
    )
  )
    return empty(204);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  )
    return empty(415);
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)
  )
    return empty(413);
  if (request.body === null) return empty(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let payload: unknown;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return empty(413);
      }
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    return empty(400);
  } finally {
    reader.releaseLock();
  }
  const event = analyticsEventSchema.safeParse(payload);
  if (!event.success) return empty(400);
  // Production nginx must overwrite X-Real-IP with the actual request peer.
  // Never pass browser-supplied Minilytics identity/authentication headers through.
  const clientIp = request.headers.get("x-real-ip") ?? "";
  if (isIP(clientIp) === 0 || ua.length === 0 || ua.length > 2048)
    return empty(400);
  try {
    const response = await fetch(config.data.collector, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-minilytics-site": config.data.siteId,
        "x-minilytics-secret": config.data.secret,
        "x-minilytics-client-ip": clientIp,
        "x-minilytics-user-agent": ua,
        "x-minilytics-session-mode": "network",
      },
      body: JSON.stringify(event.data),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    });
    return empty(response.ok ? 204 : 502);
  } catch {
    return empty(502);
  }
}
export function GET(): Response {
  return empty(405);
}
