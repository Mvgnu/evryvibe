import { eq } from "drizzle-orm";
import { isPublicPostUrl } from "../core/media";
import { postPackageSchema } from "../core/model";
import type { Database } from "./client";
import { eventSources, packages } from "./schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CoverCandidate = {
  url: string;
  slide: number;
  mediaId: string;
  /** The public post/reel the candidate belongs to. */
  sourceUrl: string;
};

/**
 * Image candidates of every public post/reel package already linked to the
 * event. Stories never carry candidates, so a story update can still select
 * the cover of an earlier post.
 */
export async function linkedCoverCandidates(
  tx: Transaction,
  eventId: string,
): Promise<CoverCandidate[]> {
  const rows = await tx
    .select({ payload: packages.payload })
    .from(packages)
    .innerJoin(eventSources, eq(eventSources.packageId, packages.id))
    .where(eq(eventSources.eventId, eventId));
  return rows.flatMap(({ payload }) => {
    const parsed = postPackageSchema.safeParse(payload);
    if (!parsed.success || !isPublicPostUrl(parsed.data.postUrl)) return [];
    const sourceUrl = parsed.data.postUrl;
    return (parsed.data.imageCandidates ?? []).flatMap((candidate) =>
      candidate.mediaId
        ? [
            {
              url: candidate.url,
              slide: candidate.slide,
              mediaId: candidate.mediaId,
              sourceUrl,
            },
          ]
        : [],
    );
  });
}

export function isInstagramImage(url: string) {
  const host = new URL(url).hostname;
  return ["cdninstagram.com", "fbcdn.net"].some(
    (base) => host === base || host.endsWith(`.${base}`),
  );
}
