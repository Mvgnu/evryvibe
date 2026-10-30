import { expect as baseExpect, test, type Page } from "@playwright/test";

// Chip and filter links are client navigations rendered on demand by the dev
// server; under load they can take longer than the 5s default.
const expect = baseExpect.configure({ timeout: 15000 });

test.beforeEach(async ({ context }) => {
  // Discovery behavior is exercised after the visitor has rejected external media.
  await context.addCookies(
    ["instagram", "soundcloud"].map((provider) => ({
      name: `evryvibe-${provider}-consent`,
      value: "rejected",
      url: "http://localhost:3100",
      sameSite: "Lax" as const,
    })),
  );
});

const rows = (page: Page) => page.locator(".ev-row");
const group = (page: Page, name: string) =>
  page.getByRole("group", { name, exact: true });
const berlinDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

test("discovery filters, empty recovery, and entity links work without login", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByText("FIKTIVE VORSCHAU", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Techno-Partys" }),
  ).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  await expect(
    page.locator('.site-nav a[data-section="nights"]'),
  ).toHaveAttribute("aria-current", "page");
  const mainNav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(mainNav.getByRole("link", { name: "Städte" })).toBeVisible();

  await page.getByRole("searchbox").fill("no such fictional night");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await expect(page).toHaveURL(/q=no/);
  await expect(
    page.getByRole("heading", { name: "Keine Nächte für diese Filter" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Alle Nächte anzeigen" }).click();
  await expect(rows(page).first()).toBeVisible();
  await expect(page).not.toHaveURL(/q=/);

  await group(page, "Wo")
    .getByRole("link", { name: /Hamburg/ })
    .click();
  await expect(page).toHaveURL(/city=hamburg/);
  // The client navigation renders right after the URL changes.
  await expect
    .poll(async () => {
      const places = await page.locator(".ev-row-place").allTextContents();
      return (
        places.length > 0 && places.every((place) => place.includes("Hamburg"))
      );
    })
    .toBe(true);
  await expect(
    group(page, "Wo").getByRole("link", { name: /Hamburg/ }),
  ).toHaveAttribute("aria-current", "true");
  await page.getByRole("link", { name: "Filter Hamburg entfernen" }).click();
  await expect(page).not.toHaveURL(/city=/);
  // Let the client navigation finish before leaving the page.
  await page.waitForLoadState("networkidle");

  await page.goto("/events/after-hours-frequency", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "After Hours Frequency", exact: true }),
  ).toBeVisible();
  // Demo listings never link a source post.
  await expect(page.getByRole("link", { name: /Quelle/ })).toHaveCount(0);
  await page.locator(".detail-venue").getByRole("link").click();
  await expect(page).toHaveURL(/\/venues\/signal-room$/, { timeout: 15000 });
  await expect(
    page.getByRole("heading", { name: "Signal Room", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.goto("/djs/mira-phase");
  await expect(
    page.getByRole("heading", { name: "Mira Phase", exact: true }),
  ).toBeVisible();
  expect(await page.locator("iframe").count()).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("share copies a link and malformed filters recover visibly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedUrl = text;
        },
      },
      configurable: true,
    });
  });
  await page.goto("/events/after-hours-frequency");
  await page.getByRole("button", { name: "Teilen" }).click();
  await expect(page.getByRole("status")).toHaveText("Link kopiert.");
  expect(await page.locator("html").getAttribute("data-copied-url")).toContain(
    "/events/after-hours-frequency",
  );
  await page.goto("/?date=not-a-date&city=berlin&sound=foo");
  // The notice names what was ignored.
  await expect(
    page.getByRole("alert").filter({ hasText: "Diese Filter" }),
  ).toContainText("Datum, Sound");
  // The valid filter keeps working beside the malformed one.
  await expect(rows(page).first()).toBeVisible();
  for (const place of await page.locator(".ev-row-place").allTextContents())
    expect(place).toContain("Berlin");
  // An out-of-range number is brought into range, not reported.
  await page.goto("/?limit=-5");
  await expect(page.locator(".filter-error")).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
  // A past date says so instead of showing a bare empty list.
  await page.goto("/?date=2020-01-01");
  await expect(
    page.getByRole("heading", { name: /2020 liegt in der Vergangenheit/ }),
  ).toBeVisible();
  await page.goto("/events/missing-night");
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
});

test("events are in the first viewport and the page never scrolls sideways", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(rows(page).first()).toBeAttached();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize()?.height ?? 0;
  // The night map leads the page: its first card names date, night and place
  // on the first screen, before the map itself has loaded.
  const firstCard = await page.locator(".nm-card-place").first().boundingBox();
  expect(firstCard).not.toBeNull();
  expect((firstCard?.y ?? Infinity) + (firstCard?.height ?? 0)).toBeLessThan(
    viewport,
  );
  // Wide screens show the programme beside the map.
  if (testInfo.project.name === "desktop") {
    const firstPlace = await page
      .locator(".ev-row-place")
      .first()
      .boundingBox();
    expect(firstPlace).not.toBeNull();
    expect(
      (firstPlace?.y ?? Infinity) + (firstPlace?.height ?? 0),
    ).toBeLessThan(viewport);
  }
  // Chip rows scroll sideways instead of wrapping into walls.
  for (const row of await page.locator(".filter-panel .chip-scroll").all()) {
    const heights = await row
      .locator(".chip")
      .evaluateAll((chips) =>
        chips.map((chip) => Math.round(chip.getBoundingClientRect().top)),
      );
    expect(new Set(heights).size).toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: testInfo.outputPath("discovery.png"),
    fullPage: true,
  });
});

test("old sound links and alias genres still land on the taxonomy", async ({
  page,
}) => {
  await page.goto("/?sound=hard");
  const sound = group(page, "Sound");
  await expect(
    sound.getByRole("link", { name: /^Hard Techno/ }),
  ).toHaveAttribute("aria-current", "true");
  await page.goto("/?genre=hardtechno");
  await expect(
    sound.getByRole("link", { name: /^Hard Techno/ }),
  ).toHaveAttribute("aria-current", "true");
});

test("when, sound and date filters apply at once and compose in the URL", async ({
  page,
}) => {
  await page.goto("/");
  const total = await rows(page).count();
  await group(page, "Sound")
    .getByRole("link", { name: /^Techno/ })
    .click();
  await expect(page).toHaveURL(/sound=techno/);
  const techno = await rows(page).count();
  expect(techno).toBeGreaterThan(0);
  expect(techno).toBeLessThan(total);
  for (const tags of await page.locator(".ev-row-sound").allTextContents())
    expect(tags).toMatch(/Techno/i);

  await group(page, "Wann")
    .getByRole("link", { name: /^7 Tage/ })
    .click();
  await expect(page).toHaveURL(/when=week/);
  await expect(page).toHaveURL(/sound=techno/);

  const firstStart = await rows(page)
    .first()
    .locator("time")
    .getAttribute("datetime");
  if (!firstStart) throw new Error("First event has no datetime");
  const day = berlinDate(firstStart);
  await page.locator(".date-pick summary").click();
  await page.getByLabel("Anderes Datum").fill(day);
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${day}`));
  await expect(page).toHaveURL(/sound=techno/);
  await expect(page).not.toHaveURL(/when=/);
  for (const start of await rows(page)
    .locator("time")
    .evaluateAll((times) => times.map((time) => time.getAttribute("datetime"))))
    expect(berlinDate(start ?? "")).toBe(day);

  await page.getByRole("link", { name: "Alle löschen" }).click();
  await expect(page).not.toHaveURL(/[?&](date|sound)=/);
  await expect(rows(page)).toHaveCount(total);
});

test("the listing grows with a server-rendered more link", async ({ page }) => {
  await page.goto("/?limit=1");
  const first = await rows(page).count();
  const more = page.getByRole("link", { name: /Weitere Nächte anzeigen/ });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page).toHaveURL(/limit=\d+/);
  // A dev server renders the longer page on demand, which can take a while.
  await expect
    .poll(() => rows(page).count(), { timeout: 20000 })
    .toBeGreaterThan(first);
});

test("a first visit without JavaScript is never blocked; chips and search work", async ({
  browser,
}) => {
  // No saved choice: the consent dialog must not cover the page without JS.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeHidden();
  // Controls that need JavaScript are not offered.
  await expect(
    page.getByRole("button", { name: "Hell-/Dunkelmodus wechseln" }),
  ).toBeHidden();
  await group(page, "Wo")
    .getByRole("link", { name: /Berlin/ })
    .click();
  await expect(page).toHaveURL(/city=berlin/);
  await page.getByRole("searchbox").fill("Soft");
  await page.getByRole("button", { name: "Suchen", exact: true }).click();
  await expect(page).toHaveURL(/q=Soft/);
  await expect(page).toHaveURL(/city=berlin/);
  await expect(
    page.getByRole("heading", { name: "Soft Focus", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("language switch retains filters, localizes details and metadata", async ({
  page,
}) => {
  await page.goto("/?q=Soft&city=Berlin&genre=House");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(/\/en\?q=Soft&city=Berlin&genre=House/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { level: 1, name: "Techno parties" }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("Soft");
  await expect(
    page.getByRole("link", { name: "Remove filter Berlin" }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "Soft Focus", exact: true })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/en\/events\/soft-focus$/);
  await expect(
    page.getByText(
      "A fictional house session from sunset into the early hours. Demo only.",
    ),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/en\/events\/soft-focus$/,
  );
  await page.getByRole("link", { name: "DE", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/soft-focus$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(
    page.getByText(
      "Eine fiktive House-Session vom Sonnenuntergang bis in die frühen Morgenstunden. Nur eine Demo.",
    ),
  ).toBeVisible();
});

test("theme defaults to dark and preserves an explicit choice", async ({
  page,
}, testInfo) => {
  // A light device preference does not override the dark default.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: testInfo.outputPath("discovery-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Hell-/Dunkelmodus wechseln" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: testInfo.outputPath("discovery-light.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Hell-/Dunkelmodus wechseln" })
    .click();
  await page.goto("/en/djs/mira-phase");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByText(
      "Fictional artist exploring hypnotic techno and broken rhythms.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("dj-dark-english.png"),
    fullPage: true,
  });
});
