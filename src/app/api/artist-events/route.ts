import { cookies } from "next/headers";
import sharp from "sharp";
import { artistEventInputSchema } from "@/core/artist-event";
import { DomainError } from "@/core/model";
import { siteUrl } from "@/core/site";
import { getArtistSession } from "@/db/claims";
import { createArtistEvent } from "@/db/artist-event";
import { database } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBody = 6 * 1024 * 1024;
const error = (status: number, code: string) =>
  Response.json(
    { error: code },
    { status, headers: { "Cache-Control": "no-store" } },
  );

async function boundedBody(request: Request): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBody) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks, size);
}
function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}
async function readCover(form: FormData): Promise<Buffer | null> {
  const file = form.get("cover");
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (text(form, "rightsConfirmed") !== "true" || file.size > 5 * 1024 * 1024)
    throw new Error("invalid_cover");
  const input = Buffer.from(await file.arrayBuffer());
  const image = sharp(input, {
    limitInputPixels: 20_000_000,
    failOn: "error",
    animated: false,
  });
  const metadata = await image.metadata();
  if (
    !metadata.format ||
    !["jpeg", "png", "webp"].includes(metadata.format) ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("invalid_cover");
  const output = await image
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  if (output.length > 3 * 1024 * 1024) throw new Error("invalid_cover");
  return output;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.DATABASE_URL || process.env.EVRYVIBE_DEMO === "1")
    return error(503, "unavailable");
  const expectedOrigin =
    process.env.NODE_ENV === "production"
      ? siteUrl
      : new URL(request.url).origin;
  if (
    request.headers.get("origin") !== expectedOrigin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return error(403, "forbidden");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    return error(415, "invalid_request");
  const session = await getArtistSession(
    database(),
    (await cookies()).get("evryvibe-artist-session")?.value,
  );
  if (!session) return error(401, "unauthorized");
  const bytes = await boundedBody(request);
  if (!bytes) return error(413, "too_large");
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: new Uint8Array(bytes),
    }).formData();
  } catch {
    return error(400, "invalid_request");
  }
  const venueId = text(form, "venueId").trim();
  const lat = text(form, "latitude").trim();
  const lng = text(form, "longitude").trim();
  const input = artistEventInputSchema.safeParse({
    title: text(form, "title"),
    description: text(form, "description"),
    startsAt: text(form, "startsAt"),
    endsAt: text(form, "endsAt").trim() || null,
    ticketUrl: text(form, "ticketUrl").trim() || null,
    djIds: form.getAll("djIds"),
    lineupNames: form.getAll("lineupNames"),
    venue: venueId
      ? { kind: "existing", id: venueId }
      : {
          kind: "new",
          name: text(form, "venueName"),
          address: text(form, "address"),
          city: text(form, "city"),
          country: text(form, "country"),
          timezone: text(form, "timezone"),
          latitude: lat ? Number(lat) : NaN,
          longitude: lng ? Number(lng) : NaN,
          locationSourceUrl: text(form, "locationSourceUrl"),
        },
  });
  if (!input.success) return error(400, "invalid_event");
  let cover: Buffer | null;
  try {
    cover = await readCover(form);
  } catch {
    return error(400, "invalid_cover");
  }
  try {
    const created = await createArtistEvent(
      database(),
      session.djId,
      input.data,
      cover,
    );
    return Response.json(created, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (failure) {
    if (failure instanceof DomainError && failure.code === "identity_conflict")
      return error(409, "duplicate");
    if (failure instanceof DomainError && failure.code === "not_found")
      return error(404, "venue_not_found");
    if (failure instanceof DomainError && failure.code === "invalid_input")
      return error(400, "invalid_event");
    return error(500, "unavailable");
  }
}
