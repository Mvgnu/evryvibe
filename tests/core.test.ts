import { describe, expect, it } from "vitest";
import {
  eventInputSchema,
  httpsUrlSchema,
  instagramPostSchema,
  instagramProfileSchema,
  timezoneSchema,
} from "../src/core/model";
describe("canonical input boundaries", () => {
  it("normalizes Instagram tracking and profile case without changing post IDs", () => {
    expect(
      instagramProfileSchema.parse(
        "https://instagram.com/MiRa/?utm_source=ig#x",
      ),
    ).toBe("https://www.instagram.com/mira/");
    expect(
      instagramPostSchema.parse(
        "https://instagram.com/reel/AbC12/?igsh=secret",
      ),
    ).toBe("https://www.instagram.com/reel/AbC12/");
  });
  it("rejects spoofed hosts, unsupported paths, credentials and unsafe URL schemes", () => {
    for (const value of [
      "https://instagram.com.evil.test/p/abc/",
      "https://evil.test/p/abc/",
      "https://instagram.com/stories/abc/",
      "http://instagram.com/p/abc/",
      "https://user:pass@instagram.com/p/abc/",
    ])
      expect(instagramPostSchema.safeParse(value).success).toBe(false);
    for (const value of [
      "javascript:alert(1)",
      "http://tickets.test",
      "data:text/html,hello",
    ])
      expect(httpsUrlSchema.safeParse(value).success).toBe(false);
    expect(timezoneSchema.safeParse("invented/timezone").success).toBe(false);
  });
  it("requires an offset and rejects reverse event intervals", () => {
    const event = {
      slug: "night",
      title: "Night",
      description: "",
      venueSlug: "room",
      djSlugs: [],
      startsAt: "2026-09-25T23:00:00+02:00",
      endsAt: "2026-09-26T06:00:00+02:00",
      genres: [],
      imageUrl: null,
      ticketUrl: null,
      websiteUrl: null,
      status: "scheduled",
    };
    expect(eventInputSchema.safeParse(event).success).toBe(true);
    expect(
      eventInputSchema.safeParse({ ...event, startsAt: "2026-09-25T23:00:00" })
        .success,
    ).toBe(false);
    expect(
      eventInputSchema.safeParse({ ...event, endsAt: "2026-09-25T20:00:00Z" })
        .success,
    ).toBe(false);
  });
});
