import Link from "next/link";
import type { ArtistProfile } from "@/core/claims";
import { ArtistEventForm } from "@/components/artist-event-form";
import { ArtistProfileForm } from "@/components/artist-profile-form";
import type { ArtistOption, VenueOption } from "@/components/artist-pickers";
import { artistLogout } from "@/app/artist/actions";

export function ArtistStudio({
  name,
  slug,
  profile,
  venues,
  artists,
  preview = false,
  status,
}: {
  name: string;
  slug: string;
  profile: ArtistProfile;
  venues: VenueOption[];
  artists: ArtistOption[];
  preview?: boolean;
  status?: string;
}) {
  return (
    <main id="main" className="artist-preview">
      {preview && (
        <div className="artist-demo-note">
          <strong>FIKTIVE VORSCHAU</strong> Alle Angaben sind Demo-Inhalte.
          Eingaben werden nicht gespeichert.
        </div>
      )}
      <div className="artist-preview-shell">
        <header className="artist-preview-head">
          <div>
            <p className="artist-kicker">EVRYVIBE / ARTIST STUDIO</p>
            <h1>
              Deine Bühne.
              <br />
              Dein Profil.
            </h1>
            <p>Dein Auftritt, deine Links, deine nächsten Nächte.</p>
          </div>
          <div className="artist-preview-card">
            <span>ARTIST</span>
            <strong>{name}</strong>
            <small>{preview ? "FIKTIVES PROFIL" : "DEIN PROFIL"}</small>
          </div>
        </header>
        <nav className="artist-preview-nav">
          <a href="#profil">Profil & Links</a>
          <a href="#event">Event hinzufügen</a>
          <Link href={`/djs/${slug}`}>Profil ansehen ↗</Link>
        </nav>
        {status === "saved" && (
          <p className="artist-status">Dein Profil wurde gespeichert.</p>
        )}
        {status === "invalid" && (
          <p className="artist-status">
            Bitte prüfe deine Angaben. Links benötigen eine Bezeichnung und eine
            gültige HTTPS-Adresse oder eine E-Mail mit mailto:.
          </p>
        )}
        <div className="artist-preview-grid">
          <section id="profil" className="artist-preview-section">
            <p className="artist-kicker">01 / DEIN PROFIL</p>
            <h2>Zeig, wer du bist.</h2>
            <p>Erzähl von deinem Sound und verlinke alles, was dazugehört.</p>
            <ArtistProfileForm preview={preview} profile={profile} />
          </section>
          <section className="artist-preview-section">
            <ArtistEventForm
              preview={preview}
              venues={venues}
              artists={artists}
            />
            {preview && (
              <p className="artist-status">
                Fiktive Vorschau: Keine Eventdaten werden gespeichert oder
                veröffentlicht.
              </p>
            )}
          </section>
        </div>
        {!preview && (
          <form action={artistLogout}>
            <button className="chip-button" type="submit">
              Abmelden
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
