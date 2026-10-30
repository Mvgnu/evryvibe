import { expect as baseExpect, test, type Page } from "@playwright/test";

// The map draws tiles from itstiles.com; give the network and the dev server
// room before calling a step failed.
const expect = baseExpect.configure({ timeout: 20000 });

test.beforeEach(async ({ context }) => {
  await context.addCookies(
    ["instagram", "soundcloud"].map((provider) => ({
      name: `evryvibe-${provider}-consent`,
      value: "rejected",
      url: "http://localhost:3100",
      sameSite: "Lax" as const,
    })),
  );
});

const stagePosition = (page: Page) =>
  page.locator("#karte").evaluate((stage) => getComputedStyle(stage).position);

test("the night map shows the filtered nights, opens full screen and leaves one map behind", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const stage = page.getByRole("region", { name: "Karte der Nächte" });
  await expect(stage.locator(".maplibregl-map")).toHaveCount(1);
  // The tile credit stays visible, with the itstiles.com link.
  const credit = stage.locator(".maplibregl-ctrl-attrib");
  await expect(credit).toBeVisible();
  await expect(
    credit.getByRole("link", { name: "itstiles.com" }),
  ).toBeVisible();
  // Demo venues have no coordinates: the map says the points are approximate.
  await expect(
    stage
      .getByText(/ungefähr/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(
    stage.getByText("Demo · fiktive Orte").filter({ visible: true }).first(),
  ).toBeVisible();

  // The list's filters drive the map: only Hamburg's nights remain.
  await page
    .getByRole("group", { name: "Wo", exact: true })
    .getByRole("link", { name: /Hamburg/ })
    .click();
  await expect(page).toHaveURL(/city=hamburg/);
  await expect
    .poll(async () => {
      const places = await stage.locator(".nm-card-place").allTextContents();
      return (
        places.length > 0 && places.every((place) => place.includes("Hamburg"))
      );
    })
    .toBe(true);

  await stage.getByRole("button", { name: "Vollbild" }).click();
  await expect.poll(() => stagePosition(page)).toBe("fixed");
  await expect(page).toHaveURL(/#karte$/);
  await page.keyboard.press("Escape");
  await expect.poll(() => stagePosition(page)).not.toBe("fixed");
  await expect(page).not.toHaveURL(/#karte/);

  // A card leads to its event; coming back leaves exactly one map.
  await stage.locator(".nm-card-title a").first().click();
  await expect(page).toHaveURL(/\/events\//);
  await page.goBack();
  await expect(page.locator(".maplibregl-map")).toHaveCount(1);
  await page.waitForTimeout(1000);
  await expect(page.locator(".maplibregl-map")).toHaveCount(1);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("listening on the map asks for SoundCloud first and loads nothing before", async ({
  page,
}) => {
  const soundcloud: string[] = [];
  page.on("request", (request) => {
    if (/soundcloud|sndcdn/.test(request.url())) soundcloud.push(request.url());
  });
  await page.goto("/");
  const stage = page.getByRole("region", { name: "Karte der Nächte" });
  await stage.getByRole("button", { name: /^Anhören · \d+ DJs$/ }).click();
  const dock = page.getByRole("region", { name: "SoundCloud-Player" });
  await expect(
    dock.getByRole("button", { name: "SoundCloud laden und abspielen" }),
  ).toBeVisible();
  // The plain profile link works without loading anything.
  await expect(
    dock.getByRole("link", { name: "Auf SoundCloud anhören" }),
  ).toHaveAttribute("href", /^https:\/\/soundcloud\.com\//);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(soundcloud).toEqual([]);

  // Accepting loads one player (stubbed here: demo profiles are fictional).
  await page.route(/https:\/\/w\.soundcloud\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "" }),
  );
  await dock
    .getByRole("button", { name: "SoundCloud laden und abspielen" })
    .click();
  await expect(dock.locator("iframe")).toHaveCount(1);
  await expect(dock.getByRole("button", { name: "Nächster DJ" })).toBeVisible();
  await dock.getByRole("button", { name: "Player schließen" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("old /map links open the full-screen map with their filters", async ({
  page,
}) => {
  await page.goto("/map?city=berlin");
  await expect(page).toHaveURL(/\/\?city=berlin#karte$/);
  await expect.poll(() => stagePosition(page)).toBe("fixed");
  await expect(
    page.getByRole("button", { name: "Karte schließen, zur Liste" }),
  ).toBeVisible();
});

test("card panel content cannot resize the fullscreen map", async ({
  page,
}) => {
  await page.goto("/?when=week#karte");
  const stage = page.getByRole("region", { name: "Karte der Nächte" });
  await expect.poll(() => stagePosition(page)).toBe("fixed");
  await expect(stage.locator(".nm-card-actions").first()).toBeVisible();
  const canvasHeight = () =>
    stage
      .locator(".nm-canvas")
      .evaluate((element) => element.getBoundingClientRect().height);
  await page.evaluate(() => document.fonts.ready);
  const populatedHeight = await canvasHeight();
  await page.goto("/?q=no-matching-night-for-layout-regression#karte");
  await expect.poll(() => stagePosition(page)).toBe("fixed");
  await expect(stage.locator(".nm-empty")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(Math.abs((await canvasHeight()) - populatedHeight)).toBeLessThan(1);
});
