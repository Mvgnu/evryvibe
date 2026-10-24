import { createHash, timingSafeEqual } from "node:crypto";

export function isOperatorAuthorized(
  authorization: string | null,
  password: string | undefined,
): boolean {
  if (!password || !authorization) return false;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match?.[1]) return false;
  const supplied = Buffer.from(match[1], "base64").toString("utf8");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`operator:${password}`));
}

export function isSameOrigin(
  origin: string | null,
  host: string | null,
  protocol: string | null,
): boolean {
  if (!origin || !host || !protocol || !["http", "https"].includes(protocol))
    return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.origin === origin &&
      parsed.host === host &&
      parsed.protocol === `${protocol}:`
    );
  } catch {
    return false;
  }
}
