import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import { connectDatabase } from "../src/db/client";
import { artistClaimLinks, djs } from "../src/db/schema";
import {
  getArtistProfile,
  getArtistSession,
  issueClaim,
  redeemClaim,
  revokeArtistSession,
  saveArtistProfile,
} from "../src/db/claims";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("Instagram claim ownership on Postgres", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const db = connection.db;
  const secret = "claim-secret-test-value-at-least-32-bytes";
  const message = {
    instagramUsername: "artist_one",
    instagramScopedId: "ig-1",
    messageId: "m1",
    follows: true,
  };
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error("Tests require a disposable test database");
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE artist_sessions, artist_profiles, artist_claim_links, artist_owners, event_djs, events, djs, venues CASCADE`,
    );
    await db
      .insert(djs)
      .values({
        slug: "artist-one",
        name: "Artist One",
        description: "",
        genres: [],
        instagramUrl: "https://www.instagram.com/artist_one/",
      });
  });
  afterAll(() => connection.close());
  it("requires follow and an exact known profile; retries produce the same one-time link", async () => {
    expect(
      await issueClaim(db, { ...message, follows: false }, secret),
    ).toEqual({ kind: "not_following" });
    expect(
      await issueClaim(
        db,
        { ...message, instagramUsername: "unknown" },
        secret,
      ),
    ).toEqual({ kind: "not_found" });
    const result = await issueClaim(db, message, secret);
    expect(result.kind).toBe("issued");
    if (result.kind !== "issued") throw new Error("claim not issued");
    expect(await issueClaim(db, message, secret)).toEqual(result);
    const [a, b] = await Promise.all([
      redeemClaim(db, result.token),
      redeemClaim(db, result.token),
    ]);
    const success = a ?? b;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(success?.djSlug).toBe("artist-one");
    expect(await redeemClaim(db, result.token)).toBeNull();
    expect(await issueClaim(db, message, secret)).toEqual({ kind: "expired" });
    if (!success) throw new Error("no session");
    expect(await getArtistSession(db, success.sessionToken)).toMatchObject({
      djId: success.djId,
    });
    expect(await getArtistProfile(db, success.djId)).toBeNull();
    const content = {
      bio: "Hello",
      links: [
        { label: "Booking", icon: "booking", url: "https://example.com" },
      ],
    };
    expect(await saveArtistProfile(db, success.djId, content)).toEqual(content);
    expect(await getArtistProfile(db, success.djId)).toEqual(content);
    await revokeArtistSession(db, success.sessionToken);
    expect(await getArtistSession(db, success.sessionToken)).toBeNull();
  });
  it("refuses expired links, changed identities, and conflicting ownership", async () => {
    const result = await issueClaim(db, message, secret);
    if (result.kind !== "issued") throw new Error("claim not issued");
    await db
      .update(artistClaimLinks)
      .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(artistClaimLinks.messageId, message.messageId));
    expect(await redeemClaim(db, result.token)).toBeNull();
    const second = await issueClaim(
      db,
      { ...message, messageId: "m2" },
      secret,
    );
    if (second.kind !== "issued") throw new Error("claim not issued");
    await db
      .update(djs)
      .set({ instagramUrl: "https://www.instagram.com/changed/" })
      .where(eq(djs.slug, "artist-one"));
    expect(await redeemClaim(db, second.token)).toBeNull();
    await db
      .update(djs)
      .set({ instagramUrl: "https://www.instagram.com/artist_one/" })
      .where(eq(djs.slug, "artist-one"));
    expect(await redeemClaim(db, second.token)).not.toBeNull();
    expect(
      await issueClaim(
        db,
        { ...message, messageId: "m3", instagramScopedId: "other" },
        secret,
      ),
    ).toEqual({ kind: "already_claimed" });
  });
});
