"use client";

import { useState } from "react";
import type { ArtistProfile } from "@/core/claims";
import { saveArtist } from "@/app/artist/actions";
const icons = [
  "link",
  "instagram",
  "soundcloud",
  "spotify",
  "youtube",
  "bandcamp",
  "tiktok",
  "booking",
  "merch",
  "tickets",
] as const;
export function ArtistProfileForm({
  profile,
  preview = false,
}: {
  profile: ArtistProfile;
  preview?: boolean;
}) {
  const [extraRows, setExtraRows] = useState(profile.links.length ? 0 : 1);
  const rows = [
    ...profile.links,
    ...Array.from({ length: extraRows }, () => ({
      label: "",
      url: "",
      icon: "link" as const,
    })),
  ];
  return (
    <form
      className="artist-form"
      action={preview ? undefined : saveArtist}
      onSubmit={preview ? (event) => event.preventDefault() : undefined}
    >
      <label>
        Bio <textarea name="bio" maxLength={5000} defaultValue={profile.bio} />
      </label>
      <div>
        <h2>Deine Links</h2>
        <p>
          Booking, Musik, Merch – füge hinzu, was für dich wichtig ist.
          HTTPS-Links oder E-Mail mit mailto:.
        </p>
      </div>
      {rows.map((link, index) => (
        <fieldset key={index}>
          <legend>Link {index + 1}</legend>
          <label>
            Bezeichnung
            <input
              name="label"
              maxLength={60}
              defaultValue={link.label}
              placeholder="z. B. Booking"
            />
          </label>
          <label>
            URL
            <input
              name="url"
              type="text"
              defaultValue={link.url}
              placeholder="https:// oder mailto:du@beispiel.de"
            />
          </label>
          <label>
            Icon
            <select name="icon" defaultValue={link.icon}>
              {icons.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      ))}
      {rows.length < 20 && (
        <button
          className="chip-button"
          type="button"
          onClick={() => setExtraRows((count) => count + 1)}
        >
          + Link hinzufügen
        </button>
      )}
      {preview ? (
        <p className="artist-status">
          Vorschau: Änderungen werden nicht gespeichert.
        </p>
      ) : (
        <button className="artist-submit" type="submit">
          Profil speichern
        </button>
      )}
    </form>
  );
}
