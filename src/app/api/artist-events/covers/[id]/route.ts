import { eq } from "drizzle-orm";
import { z } from "zod";
import { database } from "@/db/client";
import { artistEventCovers } from "@/db/schema";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = z.uuid().safeParse((await params).id);
  if (
    !id.success ||
    !process.env.DATABASE_URL ||
    process.env.EVRYVIBE_DEMO === "1"
  )
    return new Response(null, { status: 404 });
  const [cover] = await database()
    .select({ data: artistEventCovers.imageBase64 })
    .from(artistEventCovers)
    .where(eq(artistEventCovers.eventId, id.data));
  if (!cover) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(cover.data, "base64")), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
