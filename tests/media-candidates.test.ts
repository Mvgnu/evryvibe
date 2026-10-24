import { expect, test } from "vitest";
import { instagramMediaId, labelOcrMediaIds } from "../src/core/media";
import { eventInputSchema, postPackageSchema } from "../src/core/model";

const source = {
  postUrl: "https://www.instagram.com/p/FLYER1/",
  accountUrl: "https://www.instagram.com/testroom/",
  caption: "Original post caption",
  ocrText:
    "[Image 1, carousel slide 1]\nFRIDAY 25 SEPTEMBER\n\n[Post slide 2: Video sampled frame at 1.00s]\nDJ ALPHA",
  capturedAt: "2026-09-23T10:00:00.000Z",
};

test("post packages retain labeled OCR and source-scoped CDN candidates", () => {
  expect(postPackageSchema.parse(source)).toEqual(source);
  expect(
    postPackageSchema.safeParse({
      ...source,
      imageCandidates: [
        { url: "https://s.cdninstagram.com/flyer.jpg?oe=6AB97603", slide: 2 },
      ],
    }).success,
  ).toBe(true);
  expect(
    postPackageSchema.safeParse({
      ...source,
      imageCandidates: [{ url: "https://evryvibe.com/media/a.webp", slide: 1 }],
    }).success,
  ).toBe(false);
  expect(
    postPackageSchema.safeParse({
      ...source,
      postUrl: "https://www.instagram.com/stories/testroom/12345/",
      imageCandidates: [
        { url: "https://s.cdninstagram.com/story.jpg", slide: 1 },
      ],
    }).success,
  ).toBe(false);
  expect(
    postPackageSchema.safeParse({
      ...source,
      imageUrls: ["https://s.cdninstagram.com/flyer.jpg"],
    }).success,
  ).toBe(false);
});

test("event image input allows Instagram CDN for package-bound publication, never hosted media", () => {
  const event = {
    slug: "test-night",
    title: "Test night",
    description: "Test",
    venueSlug: "test-room",
    djSlugs: [],
    startsAt: "2030-09-21T23:00:00+02:00",
    endsAt: null,
    genres: [],
    imageUrl: null,
    ticketUrl: null,
    websiteUrl: null,
    status: "scheduled",
  };
  for (const url of ["https://evryvibe.com/media/a.webp"]) {
    expect(
      eventInputSchema.safeParse({ ...event, imageUrl: url }).success,
    ).toBe(false);
  }
  expect(
    eventInputSchema.safeParse({
      ...event,
      imageUrl: "https://s.cdninstagram.com/flyer.jpg",
    }).success,
  ).toBe(true);
  expect(
    eventInputSchema.safeParse({
      ...event,
      imageUrl: "https://example.com/authorized.jpg",
    }).success,
  ).toBe(true);
});

test("media identity persists through signed CDN refresh and permalink route changes", () => {
  const candidates = (url: string) =>
    postPackageSchema.parse({
      ...source,
      imageCandidates: [{ url, slide: 2 }],
    }).imageCandidates;
  const first = candidates("https://s.cdninstagram.com/old.jpg?oe=123");
  const refreshed = candidates("https://s.cdninstagram.com/new.jpg?oe=456");
  expect(first?.[0]?.mediaId).toBe("ig:FLYER1:slide:2:image");
  expect(refreshed?.[0]?.mediaId).toBe(first?.[0]?.mediaId);
  expect(instagramMediaId("https://www.instagram.com/reel/FLYER1/", 2)).toBe(
    first?.[0]?.mediaId,
  );
  expect(instagramMediaId(source.postUrl, 1)).not.toBe(first?.[0]?.mediaId);
  expect(
    postPackageSchema.safeParse({
      ...source,
      imageCandidates: [
        {
          url: "https://s.cdninstagram.com/flyer.jpg",
          slide: 2,
          mediaId: "ig:OTHER:slide:2:image",
        },
      ],
    }).success,
  ).toBe(false);
});

test("OCR identifies each slide, reel thumbnail and sampled frame including legacy labels", () => {
  const labeled = labelOcrMediaIds(source.postUrl, source.ocrText);
  expect(labeled).toContain(
    "carousel slide 1; media ID ig:FLYER1:slide:1:image",
  );
  expect(labeled).toContain("1.00s; media ID ig:FLYER1:slide:2:frame:1");
  expect(labelOcrMediaIds(source.postUrl, labeled)).toBe(labeled);
  expect(instagramMediaId("https://www.instagram.com/reel/REEL1/", 1)).toBe(
    "ig:REEL1:slide:1:image",
  );
  expect(instagramMediaId("https://www.instagram.com/reel/REEL1/", 1, 0)).toBe(
    "ig:REEL1:slide:1:frame:0",
  );
  expect(
    labelOcrMediaIds(
      "https://www.instagram.com/stories/testroom/12345/",
      "[Story 12345: video poster]\nTEXT",
    ),
  ).toContain("media ID ig:story:12345:slide:1:image");
  expect(labelOcrMediaIds(source.postUrl, "Unlabeled old OCR")).toBe(
    "Unlabeled old OCR",
  );
});

test("media references cannot ambiguously select two URLs for the same source slide", () => {
  expect(
    postPackageSchema.safeParse({
      ...source,
      imageCandidates: [
        { url: "https://s.cdninstagram.com/one.jpg", slide: 1 },
        { url: "https://s.cdninstagram.com/two.jpg", slide: 1 },
      ],
    }).success,
  ).toBe(false);
  expect(
    labelOcrMediaIds(
      source.postUrl,
      "[Image 1, carousel slide 999]\nUntrusted text",
    ),
  ).toContain("carousel slide 999]");
});
