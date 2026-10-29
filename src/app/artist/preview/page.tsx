import { notFound } from "next/navigation";
import { ArtistStudio } from "@/components/artist-studio";
import "../artist.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Artist Vorschau",
  robots: { index: false, follow: false },
};
export default function ArtistPreview() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.EVRYVIBE_DEMO !== "1"
  )
    notFound();
  return (
    <ArtistStudio
      preview
      name="MIRA PHASE"
      slug="mira-phase"
      profile={{
        bio: "Fiktive DJ zwischen hypnotischem Techno und gebrochenen Rhythmen.",
        links: [
          { label: "Booking", url: "mailto:du@beispiel.de", icon: "booking" },
          {
            label: "SoundCloud",
            url: "https://soundcloud.com/example",
            icon: "soundcloud",
          },
        ],
      }}
      venues={[
        {
          id: "demo-venue",
          name: "Signal Room",
          city: "Berlin",
          timezone: "Europe/Berlin",
        },
        {
          id: "demo-venue-2",
          name: "Hafen Studio",
          city: "Hamburg",
          timezone: "Europe/Berlin",
        },
      ]}
      artists={[
        {
          id: "demo-dj-2",
          name: "Arlo Static",
          slug: "arlo-static",
          instagramUrl: null,
        },
        {
          id: "demo-dj-3",
          name: "Low Tide",
          slug: "low-tide",
          instagramUrl: null,
        },
      ]}
    />
  );
}
