import { describe, expect, it } from "vitest";
import { isOperatorAuthorized, isSameOrigin } from "../src/ops/auth";
import { parseVenueForm, sourceChangeSchema } from "../src/ops/forms";
const basic = (value: string) =>
  `Basic ${Buffer.from(value).toString("base64")}`;
describe("operator authentication", () => {
  it("fails closed with missing configuration and invalid credentials", () => {
    expect(isOperatorAuthorized(basic("operator:secret"), undefined)).toBe(
      false,
    );
    expect(isOperatorAuthorized(basic("operator:"), "")).toBe(false);
    expect(isOperatorAuthorized(null, "secret")).toBe(false);
    expect(isOperatorAuthorized("Basic !!!", "secret")).toBe(false);
    expect(isOperatorAuthorized(basic("admin:secret"), "secret")).toBe(false);
    expect(isOperatorAuthorized(basic("operator:wrong"), "secret")).toBe(false);
    expect(isOperatorAuthorized(basic("operator:secret"), "secret")).toBe(true);
    expect(
      isOperatorAuthorized(basic("operator:sécret:long"), "sécret:long"),
    ).toBe(true);
  });
  it("requires matching host and protocol for form requests", () => {
    expect(isSameOrigin("https://events.test", "events.test", "https")).toBe(
      true,
    );
    expect(
      isSameOrigin("http://localhost:3100", "localhost:3100", "http"),
    ).toBe(true);
    expect(isSameOrigin("http://events.test", "events.test", "https")).toBe(
      false,
    );
    expect(isSameOrigin("https://attacker.test", "events.test", "https")).toBe(
      false,
    );
    expect(isSameOrigin(null, "events.test", "https")).toBe(false);
    expect(isSameOrigin("null", "events.test", "https")).toBe(false);
    expect(
      isSameOrigin("https://events.test/path", "events.test", "https"),
    ).toBe(false);
  });
});
describe("operator form boundaries", () => {
  it("validates full venue details and maps optional blanks to null", () => {
    const form = new FormData();
    const data = {
      name: "Test venue",
      slug: "test-venue",
      city: "Berlin",
      country: "DE",
      address: "Example 1",
      timezone: "Europe/Berlin",
      description: "",
      instagramUrl: "https://instagram.com/TestVenue/",
      imageUrl: "",
      websiteUrl: "",
    };
    for (const [key, value] of Object.entries(data)) form.set(key, value);
    expect(parseVenueForm(form)).toMatchObject({
      instagramUrl: "https://www.instagram.com/testvenue/",
      imageUrl: null,
      websiteUrl: null,
    });
    form.set("timezone", "Not/AZone");
    expect(() => parseVenueForm(form)).toThrow();
    form.set("timezone", "Europe/Berlin");
    form.delete("address");
    expect(() => parseVenueForm(form)).toThrow();
  });
  it("does not coerce arbitrary source states into an enabled source", () => {
    const input = {
      venueId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: "2",
      enabled: "false",
    };
    expect(sourceChangeSchema.parse(input)).toMatchObject({
      enabled: false,
      expectedRevision: 2,
    });
    expect(() =>
      sourceChangeSchema.parse({ ...input, enabled: "yes" }),
    ).toThrow();
    expect(() =>
      sourceChangeSchema.parse({ ...input, expectedRevision: "-1" }),
    ).toThrow();
  });
});
