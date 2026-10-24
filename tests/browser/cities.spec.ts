import { expect as baseExpect, test } from "@playwright/test";

// Chip links are client navigations rendered on demand by the dev server;
// under load they can take longer than the 5s default.
const expect = baseExpect.configure({ timeout: 15000 });

test.beforeEach(async ({ context }) => {
  // City pages are exercised after the visitor has rejected external media.
  await context.addCookies(
    ["instagram", "soundcloud"].map((provider) => ({
      name: `evryvibe-${provider}-consent`,
      value: "rejected",
      url: "http://localhost:3100",
      sameSite: "Lax" as const,
    })),
  );
});

const noHorizontalOverflow = () =>
  document.documentElement.scrollWidth <= window.innerWidth;

test("city index leads to a city page limited to that city's venues", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/cities");
  await expect(
    page.getByRole("heading", { level: 1, name: "Techno-Partys nach Stadt" }),
  ).toBeVisible();
  const index = page.locator(".city-index");
  for (const name of ["Berlin", "Hamburg", "Leipzig", "München"])
    await expect(
      index.getByRole("link", { name: new RegExp(name) }),
    ).toBeVisible();
  expect(await page.evaluate(noHorizontalOverflow)).toBe(true);

  await index.getByRole("link", { name: /Berlin/ }).click();
  await expect(page).toHaveURL(/\/cities\/berlin$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /Berlin/ }),
  ).toBeVisible();
  const places = await page.locator(".ev-row-place").allTextContents();
  expect(places.length).toBeGreaterThan(0);
  expect(places.every((place) => /Signal Room|Nachtgarten/.test(place))).toBe(
    true,
  );
  await expect(
    // Demo dates are relative to the clock, so the first day is today or tomorrow.
    page.getByRole("heading", { level: 3, name: /Heute|Morgen/ }).first(),
  ).toBeVisible();
  // The first night is reachable without scrolling past a wall of chips.
  const first = await page.locator(".ev-row").first().boundingBox();
  expect(first?.y ?? Infinity).toBeLessThan(page.viewportSize()?.height ?? 0);

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  const graph: unknown = JSON.parse(jsonLd ?? "null");
  expect(JSON.stringify(graph)).toContain('"@type":"CollectionPage"');
  // Demo listings never become structured event data.
  expect(JSON.stringify(graph)).not.toContain("MusicEvent");
  expect(await page.evaluate(noHorizontalOverflow)).toBe(true);
  expect(errors).toEqual([]);
});

test("genre chips filter the city listing and clearing restores it", async ({
  page,
}) => {
  await page.goto("/cities/berlin");
  const rows = page.locator(".ev-row");
  const total = await rows.count();
  const genres = page.getByRole("group", { name: "Genre", exact: true });
  await genres.getByRole("link", { name: /^House/ }).click();
  await expect(page).toHaveURL(/genre=House/);
  await expect(genres.getByRole("link", { name: /^House/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const filtered = await rows.count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);
  for (const tags of await page.locator(".ev-row-sound").allTextContents())
    expect(tags).toMatch(/House/i);
  await page.getByRole("link", { name: "Filter löschen" }).click();
  await expect(page).not.toHaveURL(/genre=/);
  await expect(rows).toHaveCount(total);

  // An alias spelling redirects to the canonical genre URL.
  await page.goto("/cities/berlin?genre=house");
  await expect(page).toHaveURL(/genre=House$/);

  await page.goto("/cities/berlin?genre=Polka");
  await expect(page.locator(".filter-error")).toContainText("Polka");
  await expect(rows).toHaveCount(total);
});

test("English city page keeps the city name and unknown cities are 404", async ({
  page,
}) => {
  await page.goto("/en/cities/muenchen");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { level: 1, name: /München/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Upcoming nights" }),
  ).toHaveCount(1);
  await expect(page).toHaveTitle(/Techno parties in München/);
  // A city page hands over to the home filters for date and sound.
  await expect(
    page.getByRole("link", { name: "Filter by date and sound" }),
  ).toHaveAttribute("href", "/en?city=muenchen");
  expect(await page.evaluate(noHorizontalOverflow)).toBe(true);

  const missing = await page.goto("/cities/nowhere");
  expect(missing?.status()).toBe(404);
});
