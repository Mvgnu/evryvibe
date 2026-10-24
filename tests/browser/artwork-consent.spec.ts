import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from "react";
        import { createRoot } from "react-dom/client";
        import { MediaConsentProvider, useConsentSettings } from "./src/components/media-consent";
        import { Artwork } from "./src/components/artwork";
        function Settings() {
          const open = useConsentSettings();
          return <button type="button" onClick={open}>Media settings</button>;
        }
        const sourceUrl = new URLSearchParams(location.search).has("story")
          ? "https://www.instagram.com/stories/testroom/123456789/"
          : "https://www.instagram.com/reel/ABC123/";
        const event = {
          id: "00000000-0000-4000-8000-000000000001", slug: "test-night", title: "Test night",
          description: "", venueId: "00000000-0000-4000-8000-000000000002", djIds: [],
          startsAt: "2030-09-21T23:00:00+02:00", endsAt: null, genres: [],
          imageUrl: "https://s.cdninstagram.com/test-cover.jpg", ticketUrl: null,
          websiteUrl: null, sourceUrl, sourceAccountUrl: null,
          observedAt: "2030-09-21T12:00:00Z", status: "scheduled"
        };
        createRoot(document.getElementById("root")).render(
          <MediaConsentProvider locale="en"><Settings /><Artwork event={event} locale="en" /></MediaConsentProvider>
        );`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  bundle = result.outputFiles[0]?.text ?? "";
});

test("accepted public reel cover replaces artwork and withdrawal unloads it", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://s.cdninstagram.com/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  });
  await page.route("**/__artwork-test.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/__artwork-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="root"></div><script type="module" src="/__artwork-test.js"></script></body></html>',
    }),
  );
  await page.goto("/__artwork-test");
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Load all" }).click();
  await expect(page.locator(".artwork-cover")).toBeVisible();
  await expect(page.locator(".artwork-fallback")).toHaveCount(0);
  expect(requests).toEqual(["https://s.cdninstagram.com/test-cover.jpg"]);
  await page.getByRole("button", { name: "Media settings" }).click();
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.locator(".artwork-cover")).toHaveCount(0);
  await expect(page.locator(".artwork-fallback")).toBeVisible();
});

test("public reel cover is requested only after consent; failed image falls back", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://s.cdninstagram.com/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/__artwork-test.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/__artwork-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__artwork-test.js"></script></body></html>',
    }),
  );
  await page.goto("/__artwork-test");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".artwork img")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Load all" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.locator(".artwork img")).toHaveCount(0);
  await expect(page.locator(".artwork-fallback")).toBeVisible();
});

test("story evidence never requests a cover, even with consent", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://s.cdninstagram.com/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/__artwork-test.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/__artwork-test?story", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="root"></div><script type="module" src="/__artwork-test.js"></script></body></html>',
    }),
  );
  await page.goto("/__artwork-test?story");
  await page.getByRole("button", { name: "Load all" }).click();
  await expect(page.locator(".artwork img")).toHaveCount(0);
  expect(requests).toEqual([]);
});
