"use client";

import { useRef } from "react";
import { redeemArtistClaim } from "@/app/artist/actions";

export function ArtistClaimForm() {
  const token = useRef<HTMLInputElement>(null);
  return (
    <form
      action={redeemArtistClaim}
      onSubmit={() => {
        if (token.current)
          token.current.value =
            new URLSearchParams(window.location.hash.slice(1)).get("token") ??
            "";
        window.history.replaceState(null, "", window.location.pathname);
      }}
    >
      <input ref={token} type="hidden" name="token" defaultValue="" />
      <button className="artist-submit" type="submit">
        Profil öffnen
      </button>
    </form>
  );
}
