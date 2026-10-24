import { z } from "zod";
import { soundcloudProfileSchema } from "./soundcloud";

// Best-effort identity evidence for a SoundCloud profile, looked up through
// SoundCloud's public oEmbed endpoint. The lookup never blocks a write: the
// agent's profile URL is trusted, and a missing profile, an outage or an odd
// reply only leaves the echoed title and bio empty. Only the URL is stored.

export type SoundcloudEvidence = {
  url: string;
  title: string;
  bioExcerpt: string;
};
export interface SoundcloudVerifier {
  /** Resolve a canonical profile URL. Never call inside a DB transaction. */
  verify(profileUrl: string): Promise<SoundcloudEvidence>;
}

// SoundCloud sends `"description": null` for profiles without a bio.
const oembedSchema = z.object({
  title: z.string().nullish(),
  author_name: z.string().nullish(),
  description: z.string().nullish(),
});
const excerptLength = 400;

export function soundcloudOembedVerifier(
  fetcher: typeof fetch = fetch,
  timeoutMs = 3000,
): SoundcloudVerifier {
  return {
    async verify(profileUrl) {
      const url = soundcloudProfileSchema.parse(profileUrl);
      const endpoint = new URL("https://soundcloud.com/oembed");
      endpoint.searchParams.set("format", "json");
      endpoint.searchParams.set("url", url);
      const body = await fetcher(endpoint, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const parsed = oembedSchema.safeParse(body);
      const data = parsed.success ? parsed.data : {};
      const description = (data.description ?? "").replace(/\s+/g, " ").trim();
      return {
        url,
        title: (data.title ?? data.author_name ?? "").trim(),
        bioExcerpt: description.slice(0, excerptLength),
      };
    },
  };
}

/**
 * Look up only a new or changed profile: undefined/null never calls out, and
 * a value equal to the stored one was already looked up.
 */
export async function verifyChangedProfile(
  verifier: SoundcloudVerifier,
  next: string | null | undefined,
  stored: string | null | undefined,
): Promise<SoundcloudEvidence | undefined> {
  if (!next || next === stored) return undefined;
  return verifier.verify(next);
}
