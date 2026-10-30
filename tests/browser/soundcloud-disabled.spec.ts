import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "evryvibe-soundcloud-consent",
      value: "accepted",
      url: "http://localhost:3100",
    },
    {
      name: "evryvibe-instagram-consent",
      value: "rejected",
      url: "http://localhost:3100",
    },
  ]);
});

test("SoundCloud stays off sitewide even with an existing accepted consent cookie", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (/soundcloud\.com|sndcdn\.com/.test(new URL(request.url()).hostname))
      external.push(request.url());
  });
  for (const path of [
    "/",
    "/djs/mira-phase",
    "/events/after-hours-frequency",
    "/venues/signal-room",
    "/genres/techno",
    "/djs",
    "/reels",
  ]) {
    await page.goto(path);
    await expect(
      page.locator(
        'iframe[src*="soundcloud"], script[src*="w.soundcloud.com"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "SoundCloud-Player laden",
        exact: true,
      }),
    ).toHaveCount(0);
  }
  expect(external).toEqual([]);
});

test("map buttons browse the whole lineup without starting a player or leaving blank space", async ({
  page,
}) => {
  await page.goto("/?q=after+hours+frequency#karte");
  const stage = page.getByRole("region", { name: "Karte der Nächte" });
  await expect
    .poll(() => stage.evaluate((e) => getComputedStyle(e).position))
    .toBe("fixed");
  const height = () =>
    stage
      .locator(".nm-canvas")
      .evaluate((e) => e.getBoundingClientRect().height);
  const originalHeight = await height();
  await stage
    .locator('[data-slug="after-hours-frequency"] .nm-card-listen')
    .click();
  const browser = stage.getByRole("region", { name: "DJs der Nacht" });
  await expect(browser).toBeVisible();
  await expect(browser.getByText("1 / 2 · LINE-UP")).toBeVisible();
  const first = await browser
    .locator(".nm-dj-browser-name a")
    .getAttribute("href");
  const openHeight = await height();
  expect(Math.abs(originalHeight - openHeight - 104)).toBeLessThan(1);
  await browser
    .getByRole("button", { name: "Nächster DJ", exact: true })
    .click();
  await expect(browser.getByText("2 / 2 · LINE-UP")).toBeVisible();
  expect(
    await browser.locator(".nm-dj-browser-name a").getAttribute("href"),
  ).not.toBe(first);
  expect(await height()).toBe(openHeight);
  await expect(
    page.locator(".nm-dock, .map-player-shell, iframe[src*=soundcloud]"),
  ).toHaveCount(0);
  await browser.getByRole("button", { name: "DJ-Auswahl schließen" }).click();
  expect(await height()).toBe(originalHeight);
});

test("Reels route is disabled while its implementation is retained", async ({
  page,
}) => {
  for (const path of ["/reels", "/en/reels"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
  await page.goto("/");
  await expect(
    page.locator('a[href="/reels"], a[href="/en/reels"]'),
  ).toHaveCount(0);
});
