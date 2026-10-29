import { cookies } from "next/headers";
import { geocodeQuerySchema } from "@/core/geocoding";
import { siteUrl } from "@/core/site";
import { getArtistSession } from "@/db/claims";
import { database } from "@/db/client";
import { searchGeocoding } from "@/db/geocoding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const response = (status: number) =>
  Response.json(
    {
      error:
        status === 429
          ? "rate_limited"
          : status === 503
            ? "unavailable"
            : "invalid_request",
    },
    {
      status,
      headers: status === 429 ? { ...headers, "Retry-After": "1" } : headers,
    },
  );
export async function POST(request: Request): Promise<Response> {
  if (!process.env.DATABASE_URL || process.env.EVRYVIBE_DEMO === "1")
    return response(503);
  const expectedOrigin =
    process.env.NODE_ENV === "production"
      ? siteUrl
      : new URL(request.url).origin;
  if (
    request.headers.get("origin") !== expectedOrigin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return response(403);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  )
    return response(415);
  const jar = await cookies();
  if (
    !(await getArtistSession(
      database(),
      jar.get("evryvibe-artist-session")?.value,
    ))
  )
    return response(401);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 2048))
    return response(413);
  if (!request.body) return response(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      count += next.value.byteLength;
      if (count > 2048) {
        await reader.cancel();
        return response(413);
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      return response(400);
    }
    const parsed = geocodeQuerySchema.safeParse(input);
    if (!parsed.success) return response(400);
    const result = await searchGeocoding(database(), parsed.data);
    if (result.kind === "rate_limited") return response(429);
    if (result.kind === "unavailable") return response(503);
    return Response.json({ results: result.results }, { headers });
  } catch {
    return response(503);
  } finally {
    reader.releaseLock();
  }
}
