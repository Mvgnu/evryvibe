import { describe, expect, it } from "vitest";
import {
  instagramPostSchema,
  instagramSourceSchema,
  postPackageSchema,
  eventSchema,
  djSchema,
} from "../src/core/model";
import {
  enqueueCollectedPackageSchema,
  refreshPackageSchema,
} from "../src/core/sources";
import { demoCatalog } from "../src/db/demo";

const source = {
  postUrl:
    "https://instagram.com/stories/Test_Room/1234567890123456789/?utm_source=ig#top",
  accountUrl: "https://instagram.com/TEST_ROOM/",
  caption: "Captured story",
  ocrText: "Event source evidence",
  capturedAt: "2026-09-21T12:00:00Z",
};

describe("Instagram story source contracts", () => {
  it("canonicalizes stories and preserves post/reel shortcode case", () => {
    expect(instagramSourceSchema.parse(source.postUrl)).toBe(
      "https://www.instagram.com/stories/test_room/1234567890123456789/",
    );
    expect(
      instagramSourceSchema.parse("https://instagram.com/p/Ab_C-12/?igsh=x"),
    ).toBe("https://www.instagram.com/p/Ab_C-12/");
    expect(
      instagramSourceSchema.parse("https://instagram.com/reel/Ab_C-12/"),
    ).toBe("https://www.instagram.com/reel/Ab_C-12/");
  });

  it.each([
    "https://instagram.com/stories/test_room/",
    "https://instagram.com/stories/test_room/notnumeric/",
    "https://instagram.com/stories/test_room/123/extra/",
    "https://instagram.com/stories/highlights/123/",
    "https://instagram.com/stories/test-room/123/",
    "https://instagram.com.evil.test/stories/test_room/123/",
    "https://evil.test/stories/test_room/123/",
    "https://user:secret@instagram.com/stories/test_room/123/",
    "http://instagram.com/stories/test_room/123/",
    "https://instagram.com:444/stories/test_room/123/",
  ])("rejects an invalid or unsupported source %s", (url) => {
    expect(instagramSourceSchema.safeParse(url).success).toBe(false);
  });

  it("requires story path ownership to match the canonical package account at every package boundary", () => {
    expect(postPackageSchema.parse(source).accountUrl).toBe(
      "https://www.instagram.com/test_room/",
    );
    const invalid = {
      ...source,
      accountUrl: "https://instagram.com/other_room/",
    };
    expect(postPackageSchema.safeParse(invalid).success).toBe(false);
    expect(
      enqueueCollectedPackageSchema.safeParse({
        venueId: "11111111-1111-4111-8111-111111111111",
        expectedRevision: 1,
        package: invalid,
      }).success,
    ).toBe(false);
    expect(
      refreshPackageSchema.safeParse({
        packageId: "11111111-1111-4111-8111-111111111111",
        package: invalid,
      }).success,
    ).toBe(false);
  });

  it("publishes stories as source links while keeping DJ embeds post/reel-only", () => {
    const event = eventSchema.parse({
      ...demoCatalog.events[0],
      sourceUrl: source.postUrl,
    });
    expect(event.sourceUrl).toContain("/stories/test_room/");
    expect(instagramPostSchema.safeParse(source.postUrl).success).toBe(false);
    expect(
      djSchema.safeParse({
        ...demoCatalog.djs[0],
        samplePostUrl: source.postUrl,
      }).success,
    ).toBe(false);
  });
});
