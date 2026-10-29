import { ArtistClaimForm } from "@/components/artist-claim-form";
import "../artist.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Profil beanspruchen",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main id="main" className="artist-shell">
      <p className="artist-kicker">EVRYVIBE / ARTIST</p>
      <h1>Dein Profil.</h1>
      <p>
        Öffne dein Artist-Profil mit dem einmaligen Link aus deiner
        Instagram-Nachricht.
      </p>
      {error === "invalid" && (
        <p className="artist-status">
          Dieser Link ist abgelaufen, ungültig oder wurde bereits benutzt.
          Schreibe uns erneut CLAIM auf Instagram.
        </p>
      )}
      {error === "session" && (
        <p className="artist-status">
          Deine Sitzung ist abgelaufen. Fordere über Instagram einen neuen Link
          an.
        </p>
      )}
      {error === "unavailable" && (
        <p className="artist-status">
          Der Claim ist momentan nicht verfügbar. Versuche es später erneut.
        </p>
      )}
      {!error && <ArtistClaimForm />}
    </main>
  );
}
