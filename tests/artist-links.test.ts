import { describe, expect, it } from "vitest";
import { artistLinkUrlSchema } from "../src/core/claims";

describe("artist links", () => {
  it("accepts HTTPS links and a plain email booking link", () => {
    expect(
      artistLinkUrlSchema.safeParse("https://example.com/booking").success,
    ).toBe(true);
    expect(artistLinkUrlSchema.safeParse("mailto:du@example.com").success).toBe(
      true,
    );
  });
  it("rejects malformed email, injected mail headers and unsafe schemes", () => {
    for (const url of [
      "mailto:bad",
      "mailto:du@example.com?bcc=other@example.com",
      "javascript:alert(1)",
      "http://example.com",
    ]) {
      expect(artistLinkUrlSchema.safeParse(url).success).toBe(false);
    }
  });
});
