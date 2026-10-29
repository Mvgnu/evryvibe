import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { InstagramClaimConfig } from "./instagram-claim-config";

const id = z.string().regex(/^\d{1,40}$/);
const username = z.string().regex(/^[A-Za-z0-9._]{1,30}$/);
const senderProfile = z.object({
  username,
  is_user_follow_business: z.boolean(),
});
const webhook = z.object({
  object: z.literal("instagram"),
  entry: z
    .array(
      z.object({
        id,
        messaging: z
          .array(
            z.object({
              sender: z.object({ id }),
              recipient: z.object({ id }),
              message: z
                .object({
                  mid: z.string().min(1).max(1000),
                  text: z.string().max(4096).optional(),
                  is_echo: z.boolean().optional(),
                })
                .optional(),
            }),
          )
          .max(100)
          .optional(),
      }),
    )
    .max(100),
});
export type ClaimResult =
  | { kind: "issued"; token: string; djSlug: string }
  | { kind: "not_following" | "not_found" | "already_claimed" | "expired" };
export type ClaimIssuer = (
  args: {
    instagramUsername: string;
    instagramScopedId: string;
    messageId: string;
    follows: boolean;
  },
  secret: string,
) => Promise<ClaimResult>;

export function validSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const provided = Buffer.from(signature.slice(7), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

async function graphJson(
  url: URL,
  config: InstagramClaimConfig,
  init: RequestInit = {},
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Instagram API unavailable");
  return response.json();
}

export async function processInstagramClaim(
  body: unknown,
  config: InstagramClaimConfig,
  issue: ClaimIssuer,
  request: typeof fetch = fetch,
): Promise<void> {
  const payload = webhook.parse(body);
  for (const entry of payload.entry) {
    if (entry.id !== config.businessId) continue;
    for (const event of entry.messaging ?? []) {
      if (
        event.recipient.id !== config.businessId ||
        event.sender.id === config.businessId ||
        event.message?.is_echo ||
        event.message?.text?.trim().toUpperCase() !== "CLAIM"
      )
        continue;
      const sender = event.sender.id;
      const profileUrl = new URL(
        `https://graph.instagram.com/${config.apiVersion}/${sender}`,
      );
      profileUrl.searchParams.set("fields", "username,is_user_follow_business");
      const profile = senderProfile.parse(
        await graphJson(profileUrl, config, {}, request),
      );
      const result = await issue(
        {
          instagramUsername: profile.username,
          instagramScopedId: sender,
          messageId: event.message.mid,
          follows: profile.is_user_follow_business,
        },
        config.claimSecret,
      );
      const text =
        result.kind === "issued"
          ? `Dein EVRYVIBE-Profil: https://evryvibe.com/artist/claim#token=${encodeURIComponent(result.token)}\nDieser Link ist einmalig und läuft ab.`
          : result.kind === "not_following"
            ? "Bitte folge @evryvibe und sende CLAIM erneut, damit wir dein Profil freischalten können."
            : result.kind === "already_claimed"
              ? "Dieses Profil wurde bereits beansprucht. Bitte antworte hier, wenn du Hilfe benötigst."
              : result.kind === "expired"
                ? "Dieser Link ist abgelaufen. Bitte sende CLAIM erneut."
                : "Wir konnten diesem Instagram-Konto kein eindeutiges DJ-Profil zuordnen. Bitte antworte hier, damit wir dir helfen können.";
      const sendUrl = new URL(
        `https://graph.instagram.com/${config.apiVersion}/${config.businessId}/messages`,
      );
      await graphJson(
        sendUrl,
        config,
        {
          method: "POST",
          body: JSON.stringify({
            recipient: { id: sender },
            message: { text },
          }),
        },
        request,
      );
    }
  }
}
