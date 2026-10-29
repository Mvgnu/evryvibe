import { database } from "@/db/client";
import { issueClaim } from "@/db/claims";
import { instagramClaimConfig } from "@/lib/instagram-claim-config";
import {
  processInstagramClaim,
  validSignature,
} from "@/lib/instagram-claim-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBytes = 256 * 1024;

export function GET(request: Request): Response {
  const config = instagramClaimConfig();
  if (!config || !process.env.DATABASE_URL)
    return new Response("Unavailable", { status: 503 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (
    mode !== "subscribe" ||
    token !== config.verifyToken ||
    !challenge ||
    challenge.length > 500
  )
    return new Response("Forbidden", { status: 403 });
  return new Response(challenge, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function boundedBody(request: Request): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks, size);
}

export async function POST(request: Request): Promise<Response> {
  const config = instagramClaimConfig();
  if (!config || !process.env.DATABASE_URL)
    return new Response("Unavailable", { status: 503 });
  const body = await boundedBody(request);
  if (!body) return new Response("Invalid request", { status: 400 });
  if (
    !validSignature(
      body,
      request.headers.get("x-hub-signature-256"),
      config.appSecret,
    )
  )
    return new Response("Forbidden", { status: 403 });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("Invalid request", { status: 400 });
  }
  try {
    await processInstagramClaim(payload, config, (args, secret) =>
      issueClaim(database(), args, secret),
    );
    return new Response("EVENT_RECEIVED", {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Do not log webhooks, access tokens or claim links. A transient failure
    // returns non-2xx so Meta can retry the same idempotent message.
    return new Response("Unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
