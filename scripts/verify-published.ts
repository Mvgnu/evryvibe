import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { z } from "zod";
import { connectDatabase } from "../src/db/client";
import { readCatalog } from "../src/db/catalog";

const url = process.env.MCP_TEST_DATABASE_URL;
const baseUrl = process.env.VERIFY_BASE_URL ?? "http://localhost:3101";
const englishUrl = `${baseUrl}/en`;
if (!url || !new URL(url).pathname.includes("_test"))
  throw new Error("Use the disposable MCP test database");
const connection = connectDatabase(url);
try {
  const catalog = await readCatalog(connection.db);
  const event = catalog.events.find(
    (item) =>
      item.sourceAccountUrl &&
      item.djIds.some((id) =>
        catalog.djs.some(
          (dj) =>
            dj.id === id && dj.slug.startsWith("mcp-dj-") && dj.samplePostUrl,
        ),
      ),
  );
  const dj = catalog.djs.find(
    (item) => event?.djIds.includes(item.id) && item.samplePostUrl,
  );
  const venue = catalog.venues.find((item) => item.id === event?.venueId);
  if (!dj || !event || !venue)
    throw new Error("Run tests/mcp.test.ts against this database first");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let instagramRequests = 0;
    await page.route("https://www.instagram.com/**", (route) => {
      instagramRequests += 1;
      return route.fulfill({
        status: 403,
        body: "Provider unavailable during isolated acceptance test",
      });
    });
    await page.goto(`${englishUrl}/?q=MCP%20Acceptance%20Night`);
    await page
      .getByRole("link", { name: "Details for MCP Acceptance Night" })
      .first()
      .waitFor();
    assert.equal(
      await page.getByText("FICTIONAL PREVIEW", { exact: false }).count(),
      0,
    );
    await page.goto(`${englishUrl}/events/${event.slug}`);
    await page
      .getByRole("heading", { name: event.title, exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Get tickets" })
        .getAttribute("href"),
      event.ticketUrl,
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Original announcement" })
        .getAttribute("href"),
      event.sourceUrl,
    );
    const rawGraph = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) =>
        nodes.flatMap(
          (node) => JSON.parse(node.textContent ?? "{}")["@graph"] ?? [],
        ),
      );
    const graph = z
      .array(
        z.object({
          "@type": z.union([z.string(), z.array(z.string())]),
          name: z.string().optional(),
          inLanguage: z.union([z.string(), z.array(z.string())]).optional(),
          author: z.object({ "@id": z.string() }).optional(),
        }),
      )
      .parse(rawGraph);
    assert(
      graph.some(
        (node) => node["@type"] === "MusicEvent" && node.name === event.title,
      ),
    );
    assert(
      graph.some(
        (node) =>
          Array.isArray(node["@type"]) &&
          node["@type"].includes("LocalBusiness"),
      ),
    );
    assert(
      graph.some((node) => node["@type"] === "Person" && node.name === dj.name),
    );
    assert(
      graph.some(
        (node) => node["@type"] === "WebPage" && node.inLanguage === "en",
      ),
    );
    assert(
      graph.some((node) => node["@type"] === "CreativeWork" && node.author),
    );
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      `https://evryvibe.com/en/events/${event.slug}`,
    );
    await page.getByRole("link", { name: new RegExp(venue.name) }).click();
    await page
      .getByRole("heading", { name: venue.name, exact: true })
      .waitFor();
    await page.goto(`${englishUrl}/djs/${dj.slug}`);
    await page.getByRole("heading", { name: dj.name, exact: true }).waitFor();
    assert.equal(await page.locator("iframe").count(), 0);
    assert.equal(instagramRequests, 0);
    await page.getByRole("button", { name: "Load Instagram post" }).click();
    const frame = page.locator("iframe");
    await frame.waitFor();
    assert.equal(await frame.getAttribute("src"), `${dj.samplePostUrl}embed/`);
    assert.equal(
      await page
        .getByRole("link", { name: "Open on Instagram" })
        .getAttribute("href"),
      dj.samplePostUrl,
    );
    await page.getByRole("button", { name: "Unload Instagram post" }).click();
    assert.equal(await page.locator("iframe").count(), 0);
    await page.goto(`${baseUrl}/events/${event.slug}`);
    assert.equal(await page.locator("html").getAttribute("lang"), "de");
    await page.getByRole("link", { name: "Tickets kaufen" }).waitFor();
    const storyEvent = catalog.events.find(
      (item) =>
        item.sourceUrl !== null &&
        new URL(item.sourceUrl).pathname.startsWith("/stories/"),
    );
    if (!storyEvent?.sourceAccountUrl)
      throw new Error("Run the story case in tests/mcp.test.ts first");
    for (const locale of ["de", "en"] as const) {
      const storyPath: string = `${locale === "en" ? "/en" : ""}/events/${storyEvent.slug}`;
      await page.goto(`${baseUrl}${storyPath}`);
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(
        await page
          .getByRole("link", {
            name: locale === "de" ? "Original-Story" : "Original story",
            exact: true,
          })
          .getAttribute("href"),
        storyEvent.sourceUrl,
      );
      assert.equal(
        await page
          .getByRole("link", {
            name:
              locale === "de"
                ? "Instagram-Profil der Quelle"
                : "Source Instagram profile",
            exact: true,
          })
          .getAttribute("href"),
        storyEvent.sourceAccountUrl,
      );
      assert.equal(
        await page.locator('link[rel="canonical"]').getAttribute("href"),
        `https://evryvibe.com${storyPath}`,
      );
      const schemaText = await page
        .locator('script[type="application/ld+json"]')
        .textContent();
      assert(
        storyEvent.sourceUrl && schemaText?.includes(storyEvent.sourceUrl),
      );
      assert(schemaText?.includes('"author"'));
      assert.equal(await page.locator("iframe").count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: stdio-published post/story records render in production; schema, ticket/source/profile links and click-to-load embed fallback work.",
    );
  } finally {
    await browser.close();
  }
} finally {
  await connection.close();
}
