import { z } from "zod";
const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.enum([".instagram.com", "instagram.com", "www.instagram.com"]),
  path: z.string().startsWith("/"),
  expiry: z.number().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(true),
  sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
});
export function parseInstagramCookies(value: unknown) {
  return z
    .array(cookieSchema)
    .max(200)
    .parse(value)
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expiry ?? cookie.expires ?? -1,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }))
    .filter(
      (cookie) => cookie.expires === -1 || cookie.expires > Date.now() / 1000,
    );
}
