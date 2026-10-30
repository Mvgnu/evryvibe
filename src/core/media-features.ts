// Public embeds stay off until the operator has obtained permission.
// Opt-in is restricted to local development for the permission screenshots.
export const SOUNDCLOUD_EMBEDS_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_EVRYVIBE_SC_PREVIEW === "1";
