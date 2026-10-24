import {
  expect as baseExpect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// The DJ directory and genre pages against the fictional demo catalogue.
// Four demo DJs have (fictional) SoundCloud profiles; every request to
// SoundCloud or Instagram is answered by a stub and recorded.
// Chip links are client navigations rendered on demand by the dev server;
// under load they can take longer than the 5s default.
const expect = baseExpect.configure({ timeout: 15000 });

async function rejectMedia(context: BrowserContext) {
  await context.addCookies(
    ["instagram", "soundcloud"].map((provider) => ({
      name: `evryvibe-${provider}-consent`,
      value: "rejected",
      url: "http://localhost:3100",
      sameSite: "Lax" as const,
    })),
  );
}

async function stubProviders(page: Page) {
  const soundcloud: string[] = [];
  const meta: string[] = [];
  await page.route(
    /^https:\/\/([a-z0-9-]+\.)*(soundcloud|sndcdn)\.com\//,
    async (route) => {
      soundcloud.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "" });
    },
  );
  await page.route(
    /^https:\/\/([a-z0-9-]+\.)*(instagram|cdninstagram|fbcdn)\.(com|net)\//,
    async (route) => {
      meta.push(route.request().url());
      await route.fulfill({ status: 503, body: "" });
    },
  );
  return { soundcloud, meta };
}

const noHorizontalOverflow = () =>
  document.documentElement.scrollWidth <= window.innerWidth;
const row = (page: Page, name: string) =>
  page
    .locator(".dj-row")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("the DJ directory puts SoundCloud first and plays one DJ at a time after consent", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await rejectMedia(context);
  const requests = await stubProviders(page);
  await page.goto("/djs");
  await expect(
    page.getByText("Alle Events, Orte und DJs hier sind fiktive Demoinhalte."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Techno-DJs" }),
  ).toBeVisible();

  const listenable = page.getByRole("region", { name: "Auf SoundCloud" });
  const others = page.getByRole("region", { name: "Ohne SoundCloud" });
  await expect(listenable.locator(".dj-row")).toHaveCount(4);
  await expect(listenable.locator("button.listen-toggle")).toHaveCount(4);
  await expect(others.locator(".dj-row")).toHaveCount(6);
  await expect(others.locator("button.listen-toggle")).toHaveCount(0);
  const [first, second] = await Promise.all([
    listenable.boundingBox(),
    others.boundingBox(),
  ]);
  expect(first?.y ?? Infinity).toBeLessThan(second?.y ?? 0);

  // The toggle sits above the row's stretched link and opens the player in
  // place; nothing reaches SoundCloud before consent.
  await page.getByRole("button", { name: "Vera Kaltwerk anhören" }).click();
  const vera = page.locator("#listen-vera-kaltwerk");
  await expect(vera).toBeVisible();
  await expect(page).toHaveURL(/\/djs$/);
  await expect(vera.locator("iframe")).toHaveCount(0);
  await expect(
    vera.getByRole("link", { name: "Auf SoundCloud anhören" }),
  ).toHaveAttribute(
    "href",
    "https://soundcloud.com/evryvibe-demo-vera-kaltwerk",
  );
  expect(requests.soundcloud).toEqual([]);
  if (testInfo.project.name === "mobile")
    await page.screenshot({
      path: testInfo.outputPath("directory-consent.png"),
    });
  await vera.getByRole("button", { name: "SoundCloud-Player laden" }).click();
  await expect(vera.locator("iframe")).toHaveAttribute(
    "src",
    /url=https%3A%2F%2Fsoundcloud\.com%2Fevryvibe-demo-vera-kaltwerk/,
  );
  // One player at a time across the whole list.
  await page.getByRole("button", { name: "Teo Brandt anhören" }).click();
  await expect(vera).toBeHidden();
  await expect(page.locator(".listen-panel iframe")).toHaveCount(1);
  await expect(page.locator("#listen-teo-brandt iframe")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("directory-player.png") });
  await page
    .getByRole("button", { name: "Player von Teo Brandt schließen" })
    .click();
  await expect(page.locator(".listen-panel iframe")).toHaveCount(0);
  expect(requests.meta).toEqual([]);

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  expect(jsonLd).toContain('"@type":"CollectionPage"');
  // Fictional people never become structured data.
  expect(jsonLd).not.toContain('"Person"');
  expect(await page.evaluate(noHorizontalOverflow)).toBe(true);
  expect(errors).toEqual([]);
});

test("the city filter counts gigs there and never calls an announced night played", async ({
  page,
  context,
}) => {
  await rejectMedia(context);
  await page.goto("/djs");
  const cities = page.getByRole("group", { name: "Gigs in", exact: true });
  await cities.getByRole("link", { name: /^Hamburg/ }).click();
  await expect(page).toHaveURL(/\/djs\?city=hamburg$/);
  await expect(cities.getByRole("link", { name: /^Hamburg/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.locator(".dj-row")).toHaveCount(5);
  // Noor Halim's only Hamburg night is over; Mira Phase's is announced.
  await expect(row(page, "Noor Halim")).toContainText("1× in Hamburg");
  await expect(row(page, "Noor Halim")).toContainText("Zuletzt");
  await expect(row(page, "Mira Phase")).toContainText("1× in Hamburg");
  await expect(row(page, "Mira Phase")).toContainText("Nächster Gig");
  await expect(row(page, "Mira Phase")).not.toContainText("Zuletzt");
  await page.getByRole("link", { name: "Filter löschen" }).click();
  await expect(page).toHaveURL(/\/djs$/);
  await expect(page.locator(".dj-row")).toHaveCount(10);

  // Any spelling answers with the one canonical URL.
  await page.goto("/djs?genre=hardtechno&city=Hamburg");
  await expect(page).toHaveURL(
    /\/djs\?sound=hard-techno&genre=Hard\+Techno&city=hamburg$/,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Hard-Techno-DJs" }),
  ).toBeVisible();
  await expect(page.locator(".dj-row")).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "Hard Techno: DJs und Partys" }),
  ).toHaveAttribute("href", "/genres/hard-techno");

  await page.goto("/djs?city=atlantis");
  await expect(page.locator(".filter-error")).toContainText("Stadt");
  await expect(page.locator(".dj-row")).toHaveCount(10);
  expect(await page.evaluate(noHorizontalOverflow)).toBe(true);
});

test("a genre page lists its DJs and upcoming nights, and a city limits both", async ({
  page,
  context,
}) => {
  await rejectMedia(context);
  await page.goto("/en/genres/hardtechno");
  await expect(page).toHaveURL(/\/en\/genres\/hard-techno$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Hard Techno DJs and parties",
    }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Hard Techno DJs and parties/);
  await expect(page.locator(".dj-row")).toHaveCount(2);
  await expect(row(page, "Vera Kaltwerk")).toBeVisible();
  await expect(row(page, "Teo Brandt")).toBeVisible();
  const nights = page.locator("#nights");
  await expect(nights).toContainText("Kaltstart");
  // A past night is a gig in the DJ rows, never an upcoming party.
  await expect(nights).not.toContainText("Rückspiegel Hart");

  await page.goto("/en/genres/hard-techno?city=hamburg");
  await expect(page.locator(".dj-row")).toHaveCount(2);
  for (const name of ["Vera Kaltwerk", "Teo Brandt"])
    await expect(row(page, name)).toContainText("Last gig");
  await expect(nights).toContainText(
    "No upcoming Hard Techno parties in Hamburg are published right now.",
  );

  // Sibling genres of the family; one without upcoming nights only
  // promises DJs.
  await page
    .getByRole("navigation", { name: "Genres" })
    .getByRole("link", { name: /^Schranz/ })
    .click();
  await expect(page).toHaveURL(/\/en\/genres\/schranz\?city=hamburg$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Schranz DJs" }),
  ).toBeVisible();
  expect(await page.evaluate(noHorizontalOverflow)).toBe(true);

  const missing = await page.goto("/genres/polka");
  expect(missing?.status()).toBe(404);
  // A known taxonomy topic retains its honest empty state after inventory expires.
  const empty = await page.goto("/genres/idm");
  expect(empty?.status()).toBe(200);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.locator(".quiet-empty").first()).toBeVisible();
});

test("genre rows lead with the page's genre", async ({ page, context }) => {
  await rejectMedia(context);
  await page.goto("/genres/schranz");
  const rows = page.locator(".dj-row-sound");
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allTextContents())
    expect(text.split(" · ")[0]).toBe("Schranz");
});

test("filtered and paged variants carry the base URL in structured data", async ({
  page,
  context,
}) => {
  await rejectMedia(context);
  for (const [url, base] of [
    ["/djs?city=hamburg&limit=6", "/djs"],
    ["/genres/hard-techno?city=hamburg&limit=1", "/genres/hard-techno"],
  ] as const) {
    await page.goto(url);
    const jsonLd =
      (await page
        .locator('script[type="application/ld+json"]')
        .first()
        .textContent()) ?? "";
    expect(jsonLd).toContain(`https://evryvibe.com${base}"`);
    expect(jsonLd).not.toMatch(/[?&](city|limit|sound)=/);
  }
});

test("a family slug redirects and an alias of a genre wins over the family", async ({
  request,
}) => {
  const family = await request.get("/genres/electro-wave", {
    maxRedirects: 0,
  });
  expect(family.status()).toBe(308);
  expect(family.headers().location).toMatch(/\/djs\?sound=electro-wave$/);
  // "bass" is a family slug and an alias of the genre Bass Music.
  const alias = await request.get("/genres/bass", { maxRedirects: 0 });
  expect(alias.status()).toBe(308);
  expect(alias.headers().location).toMatch(/\/genres\/bass-music$/);
});

test('"more" moves focus to the first new row', async ({ page, context }) => {
  await rejectMedia(context);
  await page.goto("/djs?limit=4");
  await expect(page.locator(".dj-row")).toHaveCount(4);
  await page.getByRole("link", { name: /Weitere DJs anzeigen/ }).click();
  await expect(page).toHaveURL(/\/djs\?limit=64#dj-[a-z0-9-]+$/);
  await expect(page.locator(".dj-row")).toHaveCount(10);
  const hash = new URL(page.url()).hash.slice(1);
  await expect(page.locator(`#${hash} .dj-row-name a`)).toBeFocused();
});

test("the header keeps the current section visible at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const [url, visible, hidden] of [
    ["/", "djs", "cities"],
    ["/djs", "djs", "cities"],
    ["/genres/hard-techno", "djs", "cities"],
    ["/djs/vera-kaltwerk", "djs", "cities"],
    ["/cities", "cities", "djs"],
  ] as const) {
    await page.goto(url);
    await expect(
      page.locator(`.site-nav a[data-section="${visible}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`.site-nav a[data-section="${hidden}"]`),
    ).toBeHidden();
    expect(await page.evaluate(noHorizontalOverflow)).toBe(true);
  }
});

test("navigation and genre tags lead to the directory and genre pages", async ({
  page,
  context,
}) => {
  await rejectMedia(context);
  await page.goto("/");
  // Past demo nights stay off the upcoming programme.
  await expect(page.locator(".ev-row").first()).toBeVisible();
  await expect(page.getByText("Rückspiegel Hart")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "DJs" })
    .click();
  await expect(page).toHaveURL(/\/djs$/);
  await expect(page.locator('.site-nav a[data-section="djs"]')).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.goto("/genres");
  await expect(
    page.getByRole("heading", { level: 1, name: "Techno-DJs nach Genre" }),
  ).toBeVisible();
  await page
    .locator(".genre-rows")
    .getByRole("link", { name: /^Hard Techno/ })
    .click();
  await expect(page).toHaveURL(/\/genres\/hard-techno$/);

  await page.goto("/djs/vera-kaltwerk");
  await expect(
    page.locator(".pf-eyebrow").getByRole("link", { name: "Hard Techno" }),
  ).toHaveAttribute("href", "/genres/hard-techno");
  await expect(
    page.getByRole("link", { name: "Mehr Hard-Techno-DJs" }),
  ).toHaveAttribute("href", "/genres/hard-techno");
  await expect(page.locator(".pf-dates")).toContainText("Kaltstart");
  await expect(page.locator(".pf-dates")).not.toContainText("Rückspiegel Hart");

  await page.goto("/events/kaltstart");
  await expect(
    page.locator(".ev-eyebrow").getByRole("link", {
      name: "Industrial Techno",
    }),
  ).toHaveAttribute("href", "/genres/industrial-techno");
  await expect(
    page.getByRole("link", { name: "Mehr Hard-Techno-DJs" }),
  ).toHaveAttribute("href", "/genres/hard-techno");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the directory filters and links to SoundCloud", async ({
    page,
    context,
  }) => {
    await rejectMedia(context);
    await page.goto("/djs");
    await expect(page.locator("button.listen-toggle").first()).toBeHidden();
    await expect(
      row(page, "Vera Kaltwerk").getByRole("link", { name: "SoundCloud" }),
    ).toHaveAttribute(
      "href",
      "https://soundcloud.com/evryvibe-demo-vera-kaltwerk",
    );
    await page
      .getByRole("group", { name: "Gigs in", exact: true })
      .getByRole("link", { name: /^Berlin/ })
      .click();
    await expect(page).toHaveURL(/\/djs\?city=berlin$/);
    await expect(row(page, "Kiko Ferreira")).toContainText("1× in Berlin");
    await expect(row(page, "Kiko Ferreira")).toContainText("Zuletzt");
  });
});
