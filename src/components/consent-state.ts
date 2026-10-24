// Shared by the server layout (reading request cookies) and the client
// consent provider. Each external media provider has its own cookie, so an
// earlier Instagram-only answer never counts for SoundCloud.
export type ConsentState = "unset" | "accepted" | "rejected";
export type MediaProvider = "instagram" | "soundcloud";

export const consentCookies: Record<MediaProvider, string> = {
  instagram: "evryvibe-instagram-consent",
  soundcloud: "evryvibe-soundcloud-consent",
};

export function parseConsent(value: string | undefined): ConsentState {
  return value === "accepted" || value === "rejected" ? value : "unset";
}
