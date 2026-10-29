import "server-only";
import { z } from "zod";

const configSchema = z.object({
  appSecret: z.string().min(1),
  verifyToken: z.string().min(1),
  accessToken: z.string().min(1),
  businessId: z.string().regex(/^\d{1,40}$/),
  apiVersion: z.string().regex(/^v\d{1,3}\.\d{1,2}$/),
  claimSecret: z.string().min(32),
});
export type InstagramClaimConfig = z.infer<typeof configSchema>;

export function instagramClaimConfig(): InstagramClaimConfig | null {
  const parsed = configSchema.safeParse({
    appSecret: process.env.META_APP_SECRET,
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
    accessToken: process.env.META_INSTAGRAM_ACCESS_TOKEN,
    businessId: process.env.META_INSTAGRAM_ACCOUNT_ID,
    apiVersion: process.env.META_GRAPH_API_VERSION,
    claimSecret: process.env.CLAIM_TOKEN_SECRET,
  });
  return parsed.success ? parsed.data : null;
}
export function claimWebhookConfigured(): boolean {
  return instagramClaimConfig() !== null && Boolean(process.env.DATABASE_URL);
}
