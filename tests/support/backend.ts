import type {
  SoundcloudEvidence,
  SoundcloudVerifier,
} from "../../src/core/soundcloud-oembed";

/**
 * In-memory SoundCloud mirroring the real lookup: known profiles echo their
 * title and bio; unknown profiles and `down` (an outage) echo empty evidence.
 */
export function fakeSoundcloud(
  profiles: Record<string, { title: string; bio: string }>,
  onVerify: (url: string) => Promise<void> | void = () => {},
): SoundcloudVerifier & { calls: string[]; down: boolean } {
  const fake = {
    calls: [] as string[],
    down: false,
    async verify(url: string): Promise<SoundcloudEvidence> {
      fake.calls.push(url);
      await onVerify(url);
      const found = fake.down ? undefined : profiles[url];
      return { url, title: found?.title ?? "", bioExcerpt: found?.bio ?? "" };
    },
  };
  return fake;
}

export const testVenue = {
  slug: "test-room",
  name: "Test Room",
  city: "Berlin",
  country: "Germany",
  address: "Test address",
  timezone: "Europe/Berlin",
  description: "",
  imageUrl: null,
  instagramUrl: "https://www.instagram.com/test_room/",
  websiteUrl: null,
};
export const testDj = {
  slug: "test-dj",
  name: "Test DJ",
  description: "",
  genres: ["Techno"],
  imageUrl: null,
  instagramUrl: "https://www.instagram.com/test_dj/",
  websiteUrl: null,
  samplePostUrl: null,
};
export const testEvent = {
  slug: "test-night",
  title: "Test Night",
  venueSlug: testVenue.slug,
  djSlugs: [testDj.slug],
  startsAt: "2026-12-25T23:00:00+01:00",
  endsAt: "2026-12-26T06:00:00+01:00",
  status: "scheduled",
};
export const postSource = (code: string, capturedAt: string, slides = 2) => ({
  postUrl: `https://www.instagram.com/p/${code}/`,
  caption: `Caption of ${code} with Test DJ`,
  ocrText: `[Post slide 1: Image (carousel slide 1)] Test DJ ${code}`,
  accountUrl: "https://www.instagram.com/test_room/",
  capturedAt,
  imageCandidates: Array.from({ length: slides }, (_, index) => ({
    slide: index + 1,
    url: `https://scontent.cdninstagram.com/${code}-${index + 1}.jpg`,
  })),
});
export const storySource = (id: string, capturedAt: string) => ({
  postUrl: `https://www.instagram.com/stories/test_room/${id}/`,
  caption: "Story update: Test DJ plays later",
  ocrText: "Story text Test DJ",
  accountUrl: "https://www.instagram.com/test_room/",
  capturedAt,
});
