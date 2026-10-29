"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { database } from "@/db/client";
import {
  getArtistSession,
  redeemClaim,
  revokeArtistSession,
  saveArtistProfile,
} from "@/db/claims";
import { artistProfileSchema } from "@/core/claims";

const sessionCookie = "evryvibe-artist-session";
const liveDatabase = () =>
  Boolean(process.env.DATABASE_URL && process.env.EVRYVIBE_DEMO !== "1");

export async function redeemArtistClaim(form: FormData) {
  if (!liveDatabase()) redirect("/artist/claim?error=unavailable");
  const claim = await redeemClaim(database(), form.get("token"));
  if (!claim) redirect("/artist/claim?error=invalid");
  (await cookies()).set(sessionCookie, claim.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  redirect("/artist/profile");
}

export async function saveArtist(form: FormData) {
  if (!liveDatabase()) redirect("/artist/claim?error=unavailable");
  const token = (await cookies()).get(sessionCookie)?.value;
  const session = await getArtistSession(database(), token);
  if (!session) redirect("/artist/claim?error=session");
  const labels = form.getAll("label");
  const urls = form.getAll("url");
  const icons = form.getAll("icon");
  const links = labels
    .map((label, index) => ({ label, url: urls[index], icon: icons[index] }))
    .filter((row) => row.label !== "" || row.url !== "");
  const parsed = artistProfileSchema.safeParse({ bio: form.get("bio"), links });
  if (!parsed.success) redirect("/artist/profile?status=invalid");
  await saveArtistProfile(database(), session.djId, parsed.data);
  redirect("/artist/profile?status=saved");
}

export async function artistLogout() {
  const jar = await cookies();
  if (liveDatabase())
    await revokeArtistSession(database(), jar.get(sessionCookie)?.value);
  jar.delete(sessionCookie);
  redirect("/artist/claim");
}
