import { databaseReady } from "@/db/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let ready = false;
  try {
    ready = await databaseReady();
  } catch {
    // Configuration and connection failures must not expose credentials or errors.
  }
  return Response.json(
    { status: ready ? "ok" : "unavailable" },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    },
  );
}
