import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getArtistProfile, getArtistSession } from "@/db/claims";
import { database } from "@/db/client";
import { getCatalog } from "@/db/catalog";
import { ArtistStudio } from "@/components/artist-studio";
import "../artist.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Artist-Profil verwalten",
  robots: { index: false, follow: false },
};
export default async function ArtistProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  if (!process.env.DATABASE_URL || process.env.EVRYVIBE_DEMO === "1")
    redirect("/artist/claim?error=unavailable");
  const session = await getArtistSession(
    database(),
    (await cookies()).get("evryvibe-artist-session")?.value,
  );
  if (!session) redirect("/artist/claim?error=session");
  const [saved, catalog, query] = await Promise.all([
    getArtistProfile(database(), session.djId),
    getCatalog(),
    searchParams,
  ]);
  const dj = catalog.djs.find((item) => item.id === session.djId);
  if (!dj) redirect("/artist/claim?error=session");
  return (
    <ArtistStudio
      name={dj.name}
      slug={dj.slug}
      profile={saved ?? { bio: dj.description, links: [] }}
      status={query.status}
      venues={catalog.venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        city: venue.city,
        timezone: venue.timezone,
      }))}
      artists={catalog.djs
        .filter((artist) => artist.id !== session.djId)
        .map((artist) => ({
          id: artist.id,
          name: artist.name,
          slug: artist.slug,
          instagramUrl: artist.instagramUrl,
        }))}
    />
  );
}
