import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import {
  localizePath,
  localizedDescription,
  localizedTitle,
} from "../src/core/i18n";
import { pageMetadata } from "../src/core/site";

afterEach(() => vi.unstubAllEnvs());

describe("language URLs", () => {
  it("switches between German default and English without stacking prefixes", () => {
    expect(localizePath("/", "en")).toBe("/en");
    expect(localizePath("/en", "de")).toBe("/");
    expect(localizePath("/en/events/night?q=house#tickets", "de")).toBe(
      "/events/night?q=house#tickets",
    );
    expect(localizePath("/en/events/night", "en")).toBe("/en/events/night");
    expect(() => localizePath("//evil.test", "en")).toThrow();
  });

  it("only uses supplied translations and preserves the original when absent", () => {
    const entity = {
      title: "Nacht",
      description: "Original",
      translations: { en: { title: "Night", description: "Translation" } },
    };
    expect(localizedTitle(entity, "en")).toBe("Night");
    expect(localizedDescription(entity, "en")).toBe("Translation");
    expect(localizedDescription(entity, "de")).toBe("Original");
    expect(localizedDescription({ description: "Original" }, "en")).toBe(
      "Original",
    );
  });

  it("sets self canonical and bidirectional language alternatives", () => {
    const metadata = pageMetadata(
      "Night",
      "Description",
      "/events/night",
      "en",
    );
    expect(metadata.alternates).toEqual({
      canonical: "https://evryvibe.com/en/events/night",
      languages: {
        de: "https://evryvibe.com/events/night",
        en: "https://evryvibe.com/en/events/night",
        "x-default": "https://evryvibe.com/events/night",
      },
    });
  });
});

describe("locale proxy and operator boundary", () => {
  it("rewrites English public pages and retains query filters", () => {
    const response = proxy(
      new NextRequest("https://evryvibe.com/en?genre=house", {
        headers: { "x-evryvibe-locale": "de" },
      }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://evryvibe.com/?genre=house",
    );
    expect(response.headers.get("x-middleware-request-x-evryvibe-locale")).toBe(
      "en",
    );
  });

  it("rewrites only valid English city-month paths", () => {
    const response = proxy(
      new NextRequest("https://evryvibe.com/en/cities/stuttgart/2026-10"),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://evryvibe.com/cities/stuttgart/2026-10",
    );
    expect(response.headers.get("x-middleware-request-x-evryvibe-locale")).toBe(
      "en",
    );
    for (const path of [
      "/en/cities/stuttgart/2026-13",
      "/en/cities/stuttgart/2026-10/extra",
      "/en/ops/sources/2026-10",
    ])
      expect(
        proxy(new NextRequest(`https://evryvibe.com${path}`)).headers.get(
          "x-middleware-rewrite",
        ),
      ).toBeNull();
  });

  it("rewrites the English DJ directory and genre pages", () => {
    for (const path of ["/djs", "/genres", "/genres/hard-techno"]) {
      const response = proxy(new NextRequest(`https://evryvibe.com/en${path}`));
      expect(response.headers.get("x-middleware-rewrite")).toBe(
        `https://evryvibe.com${path}`,
      );
    }
    expect(
      proxy(
        new NextRequest("https://evryvibe.com/en/genres/hard-techno/extra"),
      ).headers.get("x-middleware-rewrite"),
    ).toBeNull();
  });

  it("overwrites a spoofed locale header on the default language path", () => {
    const response = proxy(
      new NextRequest("https://evryvibe.com/events/night", {
        headers: { "x-evryvibe-locale": "en" },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-evryvibe-locale")).toBe(
      "de",
    );
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it.each([
    "/en/ops/sources",
    "/en/api/health",
    "/en/robots.txt",
    "/en/_next/static/main.js",
    "/api/health",
    "/robots.txt",
  ])("does not create localized aliases for %s", (path) => {
    expect(
      proxy(new NextRequest(`https://evryvibe.com${path}`)).headers.get(
        "x-middleware-rewrite",
      ),
    ).toBeNull();
  });

  it("retains authentication and noindex for operator pages", () => {
    vi.stubEnv("EVRYVIBE_OPERATOR_PASSWORD", "secret");
    expect(
      proxy(new NextRequest("https://evryvibe.com/ops/sources")).status,
    ).toBe(401);
    const response = proxy(
      new NextRequest("https://evryvibe.com/ops/sources", {
        headers: {
          authorization: `Basic ${Buffer.from("operator:secret").toString("base64")}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
