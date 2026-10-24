import { describe, expect, it } from "vitest";
import {
  djChangesSchema,
  ocrReferencesMediaId,
  eventChangesSchema,
  updateDjSchema,
  updateEventSchema,
} from "../src/core/catalog-updates";

describe("targeted catalog update inputs", () => {
  it("accepts one field without requiring the original bundle", () => {
    expect(
      updateDjSchema.parse({
        djId: "00000000-0000-4000-8000-000000000001",
        changes: { description: "Neue Beschreibung" },
      }).changes,
    ).toEqual({ description: "Neue Beschreibung" });
    expect(eventChangesSchema.parse({ status: "cancelled" })).toEqual({
      status: "cancelled",
    });
  });
  it("rejects empty patches, unknown fields and identity/source replacement", () => {
    for (const changes of [
      {},
      { name: undefined },
      { slug: "new-slug" },
      { surprise: true },
    ])
      expect(djChangesSchema.safeParse(changes).success).toBe(false);
    for (const changes of [
      {},
      { sourceUrl: "https://www.instagram.com/p/Other/" },
      { observedAt: "2026-10-01T12:00:00Z" },
    ])
      expect(eventChangesSchema.safeParse(changes).success).toBe(false);
    expect(
      updateEventSchema.safeParse({
        eventId: "not-a-uuid",
        changes: { title: "Title" },
      }).success,
    ).toBe(false);
  });
  it("allows explicit clears and whole-array replacement", () => {
    expect(
      djChangesSchema.parse({
        websiteUrl: null,
        translations: null,
        genres: [],
      }),
    ).toEqual({ websiteUrl: null, translations: null, genres: [] });
    expect(
      eventChangesSchema.parse({
        djIds: [],
        ticketUrl: null,
        imageMediaId: null,
      }),
    ).toEqual({ djIds: [], ticketUrl: null, imageMediaId: null });
    expect(djChangesSchema.safeParse({ name: null }).success).toBe(false);
  });
  it("accepts persistent media references, rejects ambiguous selectors and duplicate lineup IDs", () => {
    expect(
      djChangesSchema.parse({ sampleMediaId: "ig:ABC:slide:1:image" })
        .sampleMediaId,
    ).toBe("ig:ABC:slide:1:image");
    expect(
      eventChangesSchema.parse({ imageMediaId: "ig:ABC:slide:2:image" })
        .imageMediaId,
    ).toBe("ig:ABC:slide:2:image");
    expect(
      djChangesSchema.safeParse({
        sampleMediaId: "ig:ABC:slide:1:image",
        samplePostUrl: null,
      }).success,
    ).toBe(false);
    expect(
      eventChangesSchema.safeParse({
        imageMediaId: "ig:ABC:slide:2:image",
        imageUrl: null,
      }).success,
    ).toBe(false);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(eventChangesSchema.safeParse({ djIds: [id, id] }).success).toBe(
      false,
    );
  });
});

describe("DJ sample OCR provenance", () => {
  const sourceUrl = "https://www.instagram.com/reel/FrameTest/";
  it("recognizes an actual collector frame label with trailing source metadata", () => {
    const ocrText =
      "[Post slide 2: Video sampled frame at 1.50s of 10.00s; media ID ig:FrameTest:slide:2:frame:1.5; source https://www.instagram.com/reel/FrameTest/; representative frames only, not complete video transcription]\nFixture";
    expect(
      ocrReferencesMediaId(
        sourceUrl,
        ocrText,
        "ig:FrameTest:slide:2:frame:1.5",
      ),
    ).toBe(true);
    expect(
      ocrReferencesMediaId(sourceUrl, ocrText, "ig:FrameTest:slide:2:frame:1"),
    ).toBe(false);
    expect(
      ocrReferencesMediaId(
        sourceUrl,
        ocrText,
        "ig:FrameTest:slide:2:frame:1.50",
      ),
    ).toBe(false);
  });
  it("derives media provenance from legacy frame and image labels", () => {
    const ocrText =
      "[Post slide 2: Video sampled frame at 1.50s of 10.00s; source https://www.instagram.com/reel/FrameTest/]\nFrame\n[Image 3, carousel slide 3]\nImage";
    expect(
      ocrReferencesMediaId(
        sourceUrl,
        ocrText,
        "ig:FrameTest:slide:2:frame:1.5",
      ),
    ).toBe(true);
    expect(
      ocrReferencesMediaId(sourceUrl, ocrText, "ig:FrameTest:slide:3:image"),
    ).toBe(true);
    expect(
      ocrReferencesMediaId(sourceUrl, ocrText, "ig:Other:slide:3:image"),
    ).toBe(false);
    expect(
      ocrReferencesMediaId(
        sourceUrl,
        "media ID ig:FrameTest:slide:3:image",
        "ig:FrameTest:slide:3:image",
      ),
    ).toBe(false);
  });
});
