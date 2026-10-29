import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  artistProfileSchema,
  verifiedMessageSchema,
  type ArtistProfile,
} from "../core/claims";
import { instagramProfileSchema, DomainError } from "../core/model";
import type { Database } from "./client";
import {
  artistClaimLinks,
  artistOwners,
  artistProfiles,
  artistSessions,
  djs,
} from "./schema";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const profile = (username: string) =>
  instagramProfileSchema.parse(`https://www.instagram.com/${username}/`);
const failInput = (error: unknown): never => {
  throw new DomainError(
    "invalid_input",
    error instanceof Error ? error.message : "Invalid claim input",
  );
};

type IssueResult =
  | { kind: "issued"; token: string; djSlug: string }
  | { kind: "not_following" | "not_found" | "already_claimed" | "expired" };
/** The caller verifies the webhook and independently fetches the username and follow status from Meta. */
export async function issueClaim(
  db: Database,
  input: unknown,
  secret: string,
): Promise<IssueResult> {
  const parsed = verifiedMessageSchema.safeParse(input);
  if (!parsed.success) return failInput(parsed.error);
  if (Buffer.byteLength(secret, "utf8") < 32)
    throw new Error("Claim secret must be at least 32 bytes");
  const data = parsed.data;
  if (!data.follows) return { kind: "not_following" };
  const instagramUrl = profile(data.instagramUsername);
  const token = createHmac("sha256", secret)
    .update("evryvibe-claim-v1\0")
    .update(data.instagramScopedId)
    .update("\0")
    .update(data.messageId)
    .digest("base64url");
  const tokenHash = hash(token);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
    const [previous] = await tx
      .select()
      .from(artistClaimLinks)
      .where(eq(artistClaimLinks.messageId, data.messageId));
    if (previous) {
      if (
        previous.instagramScopedId !== data.instagramScopedId ||
        previous.instagramUrl !== instagramUrl ||
        previous.tokenHash !== tokenHash
      )
        throw new DomainError(
          "identity_conflict",
          "Message already associated with another identity",
        );
      const [valid] = await tx
        .select({ slug: djs.slug })
        .from(artistClaimLinks)
        .innerJoin(djs, eq(djs.id, artistClaimLinks.djId))
        .where(
          and(
            eq(artistClaimLinks.id, previous.id),
            isNull(artistClaimLinks.consumedAt),
            gt(artistClaimLinks.expiresAt, sql`clock_timestamp()`),
            eq(djs.instagramUrl, instagramUrl),
          ),
        );
      return valid
        ? { kind: "issued", token, djSlug: valid.slug }
        : { kind: "expired" };
    }
    const matches = await tx
      .select({ id: djs.id, slug: djs.slug })
      .from(djs)
      .where(eq(djs.instagramUrl, instagramUrl));
    if (matches.length !== 1) return { kind: "not_found" };
    const match = matches[0];
    if (!match) return { kind: "not_found" };
    const [owner] = await tx
      .select()
      .from(artistOwners)
      .where(eq(artistOwners.djId, match.id));
    const [senderOwner] = await tx
      .select()
      .from(artistOwners)
      .where(eq(artistOwners.instagramScopedId, data.instagramScopedId));
    if (
      (owner && owner.instagramScopedId !== data.instagramScopedId) ||
      (senderOwner && senderOwner.djId !== match.id)
    )
      return { kind: "already_claimed" };
    await tx
      .insert(artistClaimLinks)
      .values({
        messageId: data.messageId,
        djId: match.id,
        instagramScopedId: data.instagramScopedId,
        instagramUrl,
        tokenHash,
        expiresAt: sql`clock_timestamp() + interval '15 minutes'`,
      });
    return { kind: "issued", token, djSlug: match.slug };
  });
}

/** Atomic, single-use exchange. Subsequent sessions require another authenticated DM. */
export async function redeemClaim(
  db: Database,
  input: unknown,
): Promise<{ sessionToken: string; djId: string; djSlug: string } | null> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return null;
  const sessionToken = randomBytes(32).toString("base64url");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7349501)`);
    const [claim] = await tx
      .select()
      .from(artistClaimLinks)
      .where(
        and(
          eq(artistClaimLinks.tokenHash, hash(parsed.data)),
          isNull(artistClaimLinks.consumedAt),
          gt(artistClaimLinks.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .for("update");
    if (!claim) return null;
    const [dj] = await tx
      .select({ id: djs.id, slug: djs.slug })
      .from(djs)
      .where(
        and(eq(djs.id, claim.djId), eq(djs.instagramUrl, claim.instagramUrl)),
      );
    if (!dj) return null;
    const [owner] = await tx
      .select()
      .from(artistOwners)
      .where(eq(artistOwners.djId, dj.id));
    const [senderOwner] = await tx
      .select()
      .from(artistOwners)
      .where(eq(artistOwners.instagramScopedId, claim.instagramScopedId));
    if (
      (owner && owner.instagramScopedId !== claim.instagramScopedId) ||
      (senderOwner && senderOwner.djId !== dj.id)
    )
      return null;
    if (!owner)
      await tx
        .insert(artistOwners)
        .values({ djId: dj.id, instagramScopedId: claim.instagramScopedId });
    const [consumed] = await tx
      .update(artistClaimLinks)
      .set({ consumedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(artistClaimLinks.id, claim.id),
          isNull(artistClaimLinks.consumedAt),
          gt(artistClaimLinks.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .returning({ id: artistClaimLinks.id });
    if (!consumed) throw new Error("Claim expired during redemption");
    await tx
      .insert(artistSessions)
      .values({
        djId: dj.id,
        tokenHash: hash(sessionToken),
        expiresAt: sql`clock_timestamp() + interval '30 days'`,
      });
    return { sessionToken, djId: dj.id, djSlug: dj.slug };
  });
}

export async function getArtistSession(
  db: Database,
  input: unknown,
): Promise<{ djId: string; djSlug: string } | null> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return null;
  const [row] = await db
    .select({ djId: djs.id, djSlug: djs.slug })
    .from(artistSessions)
    .innerJoin(djs, eq(djs.id, artistSessions.djId))
    .where(
      and(
        eq(artistSessions.tokenHash, hash(parsed.data)),
        gt(artistSessions.expiresAt, sql`clock_timestamp()`),
      ),
    );
  return row ?? null;
}
export async function revokeArtistSession(
  db: Database,
  input: unknown,
): Promise<void> {
  const parsed = tokenSchema.safeParse(input);
  if (!parsed.success) return;
  await db
    .delete(artistSessions)
    .where(eq(artistSessions.tokenHash, hash(parsed.data)));
}
export async function getArtistProfile(
  db: Database,
  djId: string,
): Promise<ArtistProfile | null> {
  const [row] = await db
    .select({ bio: artistProfiles.bio, links: artistProfiles.links })
    .from(artistProfiles)
    .where(eq(artistProfiles.djId, djId));
  return row ? artistProfileSchema.parse(row) : null;
}
export async function saveArtistProfile(
  db: Database,
  djId: string,
  input: unknown,
): Promise<ArtistProfile> {
  const parsed = artistProfileSchema.safeParse(input);
  if (!parsed.success) return failInput(parsed.error);
  const [row] = await db
    .insert(artistProfiles)
    .values({ djId, ...parsed.data })
    .onConflictDoUpdate({
      target: artistProfiles.djId,
      set: { ...parsed.data, updatedAt: sql`clock_timestamp()` },
    })
    .returning({ bio: artistProfiles.bio, links: artistProfiles.links });
  if (!row) throw new Error("Artist profile write failed");
  return artistProfileSchema.parse(row);
}
