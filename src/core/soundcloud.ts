import { z } from "zod";

// SoundCloud profiles identify a DJ or venue the same way Instagram profiles
// do. EVRYVIBE stores only the canonical profile URL and embeds SoundCloud's
// own widget; it never stores, lists or rehosts tracks.

// First path segments that are SoundCloud pages, not profiles.
const reserved = new Set([
  "charts",
  "creators",
  "discover",
  "explore",
  "feed",
  "groups",
  "home",
  "imprint",
  "jobs",
  "logout",
  "messages",
  "mobile",
  "notifications",
  "pages",
  "people",
  "popular",
  "premium",
  "pro",
  "search",
  "settings",
  "signin",
  "signup",
  "stations",
  "stream",
  "tags",
  "terms-of-use",
  "upload",
  "you",
]);

/** Accepts https://soundcloud.com/<profile> (also www./m.) and normalizes it. */
export const soundcloudProfileSchema = z
  .string()
  .trim()
  .max(300)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Use a SoundCloud profile URL" });
      return z.NEVER;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const handle = segments[0]?.toLowerCase() ?? "";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(
        url.hostname,
      ) ||
      segments.length !== 1 ||
      !/^[a-z0-9_-]{1,100}$/.test(handle) ||
      reserved.has(handle)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Use the canonical SoundCloud profile URL https://soundcloud.com/<profile> (no track, set or on.soundcloud.com short link)",
      });
      return z.NEVER;
    }
    return `https://soundcloud.com/${handle}`;
  });

/**
 * SoundCloud's official embeddable player for a profile. A profile URL makes
 * the widget list that profile's latest uploads, so sets appear without any
 * track data stored here.
 */
export function soundcloudPlayerUrl(
  profileUrl: string,
  options: { visual?: boolean } = {},
): string {
  const params = new URLSearchParams({
    url: soundcloudProfileSchema.parse(profileUrl),
    color: "#d8ff00",
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    show_teaser: "false",
    visual: options.visual ? "true" : "false",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

export function isSoundcloudUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "soundcloud.com" || host.endsWith(".soundcloud.com");
  } catch {
    return false;
  }
}
