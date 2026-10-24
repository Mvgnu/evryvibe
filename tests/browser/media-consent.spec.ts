import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

// Isolated component harness: fictional catalogue data never contains real
// embeds, so Instagram and SoundCloud are exercised against routed stubs.
let bundle: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from "react";
        import { createRoot } from "react-dom/client";
        import { MediaConsentProvider, useConsentSettings } from "./src/components/media-consent";
        import { InstagramProfile } from "./src/components/instagram-profile";
        import { InstagramEmbed } from "./src/components/instagram-embed";
        import { SoundcloudPlayer, ListenGroup, ListenButton, ListenPanel } from "./src/components/soundcloud";
        const params = new URLSearchParams(location.search);
        const locale = params.get("locale") || "de";
        function Settings() {
          const open = useConsentSettings();
          return <button type="button" onClick={open} aria-label={locale === "de" ? "Einstellungen für Instagram und SoundCloud" : "Instagram and SoundCloud settings"}>{locale === "de" ? "Einstellungen" : "Settings"}</button>;
        }
        function Harness() {
          const [url, setUrl] = React.useState(params.get("invalid") ? "https://example.com/profile/" : "https://instagram.com/lehmannclubstuttgart/?tracking=discard");
          return <MediaConsentProvider locale={locale}>
            <header className="site-header"><strong className="wordmark">EVRYVIBE</strong><Settings /></header>
            <main style={{maxWidth:650,margin:24}}>
              {!params.get("empty") && <>
                <InstagramProfile url={url} name="Lehmann Club" locale={locale} />
                {!params.get("invalid") && <><InstagramEmbed url="https://www.instagram.com/reel/ABC123/" title="DJ sample" locale={locale} /><button onClick={() => setUrl("https://www.instagram.com/instagram/")}>Change profile for test</button></>}
                <SoundcloudPlayer url={params.get("invalid") ? "https://soundcloud.com/discover" : "https://soundcloud.com/Test-Artist"} name="Test Artist" locale={locale} />
                <ListenGroup><ol>
                  {["first-dj", "second-dj"].map((id) => <li key={id}><span>{id}</span><ListenButton id={id} url={"https://soundcloud.com/" + id} name={id} locale={locale} /><ListenPanel id={id} url={"https://soundcloud.com/" + id} name={id} locale={locale} /></li>)}
                </ol></ListenGroup>
              </>}
            </main>
          </MediaConsentProvider>;
        }
        createRoot(document.getElementById("root")).render(<Harness />);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("Media harness did not produce a bundle");
  bundle = output.text;
  css = [
    await readFile("src/app/globals.css", "utf8"),
    await readFile("src/app/detail.css", "utf8"),
  ].join("\n");
});

async function mount(
  page: Page,
  locale: "de" | "en",
  theme: "light" | "dark",
  extra = "",
) {
  await page.route("**/__media-test.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/__media-test?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html lang="${locale}" data-theme="${theme}" data-js><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/__media-test.js"></script></body></html>`,
    }),
  );
  await page.goto(`/__media-test?locale=${locale}${extra}`);
}

// Records every request to a provider and answers it with an empty page.
async function stubProviders(page: Page) {
  const meta: string[] = [];
  const soundcloud: string[] = [];
  await page.route("https://www.instagram.com/**", async (route) => {
    meta.push(route.request().url());
    await route.fulfill({ status: 503, contentType: "text/html", body: "" });
  });
  await page.route(
    /^https:\/\/([a-z0-9-]+\.)*soundcloud\.com\//,
    async (route) => {
      soundcloud.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "" });
    },
  );
  return { meta, soundcloud };
}

const cookie = async (page: Page, provider: "instagram" | "soundcloud") =>
  (await page.context().cookies()).find(
    (entry) => entry.name === `evryvibe-${provider}-consent`,
  );

const words = {
  de: {
    dialog: "Instagram und SoundCloud laden?",
    settings: "Einstellungen für Instagram und SoundCloud",
    reject: "Ablehnen",
    all: "Alle laden",
    save: "Auswahl speichern",
    loadPlayer: "SoundCloud-Player laden",
    listen: "Auf SoundCloud anhören",
    profile: "Vollständiges Profil auf Instagram öffnen",
  },
  en: {
    dialog: "Load Instagram and SoundCloud?",
    settings: "Instagram and SoundCloud settings",
    reject: "Reject",
    all: "Load all",
    save: "Save choice",
    loadPlayer: "Load SoundCloud player",
    listen: "Listen on SoundCloud",
    profile: "Open full profile on Instagram",
  },
} as const;

for (const locale of ["de", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme}: first visit, cookie choice, settings and withdrawal`, async ({
      page,
    }, testInfo) => {
      const t = words[locale];
      const requests = await stubProviders(page);
      await mount(page, locale, theme);
      const dialog = page.getByRole("dialog", { name: t.dialog });
      const settings = page.getByRole("button", { name: t.settings });
      await expect(dialog).toBeVisible();
      await expect(page.locator("iframe")).toHaveCount(0);
      expect(requests).toEqual({ meta: [], soundcloud: [] });
      await expect(page.getByRole("link", { name: t.profile })).toHaveAttribute(
        "href",
        "https://www.instagram.com/lehmannclubstuttgart/",
      );
      // The plain SoundCloud profile link is there before any consent.
      await expect(page.getByRole("link", { name: t.listen })).toHaveAttribute(
        "href",
        "https://soundcloud.com/test-artist",
      );
      if (locale === "de" && theme === "light") {
        await page.screenshot({
          path: testInfo.outputPath("media-consent.png"),
          fullPage: true,
        });
      }
      await dialog.getByRole("button", { name: t.reject }).click();
      await expect(dialog).toHaveCount(0);
      expect(requests).toEqual({ meta: [], soundcloud: [] });
      for (const provider of ["instagram", "soundcloud"] as const) {
        const rejected = await cookie(page, provider);
        expect(rejected?.value).toBe("rejected");
        expect(rejected?.sameSite).toBe("Lax");
        expect(rejected?.path).toBe("/");
      }
      await page.reload();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("iframe")).toHaveCount(0);
      await settings.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: t.all }).click();
      await expect(page.locator("iframe")).toHaveCount(3);
      await expect.poll(() => requests.meta.length).toBe(2);
      await expect.poll(() => requests.soundcloud.length).toBe(1);
      await expect(page.locator("iframe").nth(0)).toHaveAttribute(
        "src",
        "https://www.instagram.com/lehmannclubstuttgart/embed/",
      );
      await expect(page.locator("iframe").nth(1)).toHaveAttribute(
        "src",
        "https://www.instagram.com/reel/ABC123/embed/",
      );
      await expect(page.locator(".sc-player iframe")).toHaveAttribute(
        "src",
        /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Ftest-artist&/,
      );
      expect((await cookie(page, "instagram"))?.value).toBe("accepted");
      expect((await cookie(page, "soundcloud"))?.value).toBe("accepted");
      await page.reload();
      await expect(page.locator("iframe")).toHaveCount(3);
      await expect(dialog).toHaveCount(0);
      await settings.click();
      await dialog.getByRole("button", { name: t.reject }).click();
      await expect(page.locator("iframe")).toHaveCount(0);
      const requestCount = requests.meta.length + requests.soundcloud.length;
      await page
        .getByRole("button", { name: "Change profile for test" })
        .click();
      await expect(page.locator("iframe")).toHaveCount(0);
      expect(requests.meta.length + requests.soundcloud.length).toBe(
        requestCount,
      );
      for (const placeholder of await page
        .locator(".embed-placeholder, .sc-placeholder")
        .all()) {
        expect(
          await placeholder.evaluate(
            (element) => element.scrollHeight <= element.clientHeight + 1,
          ),
        ).toBe(true);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.goto(`/__media-test?locale=${locale}&invalid=1`);
      await expect(page.locator("iframe")).toHaveCount(0);
      await expect(dialog).toHaveCount(0);
    });
  }
}

test("providers are chosen separately and an embed's own button asks for its provider only", async ({
  page,
}) => {
  const requests = await stubProviders(page);
  await mount(page, "en", "dark");
  const dialog = page.getByRole("dialog", { name: words.en.dialog });
  await dialog.getByRole("checkbox", { name: /SoundCloud/ }).check();
  await dialog.getByRole("button", { name: words.en.save }).click();
  await expect(dialog).toHaveCount(0);
  expect((await cookie(page, "soundcloud"))?.value).toBe("accepted");
  expect((await cookie(page, "instagram"))?.value).toBe("rejected");
  await expect(page.locator(".sc-player iframe")).toHaveCount(1);
  await expect(page.locator(".instagram-media iframe")).toHaveCount(0);
  expect(requests.meta).toEqual([]);

  // Withdraw SoundCloud in settings, then load Instagram from the embed itself.
  await page.getByRole("button", { name: words.en.settings }).click();
  await expect(
    dialog.getByRole("checkbox", { name: /SoundCloud/ }),
  ).toBeChecked();
  await dialog.getByRole("checkbox", { name: /SoundCloud/ }).uncheck();
  await dialog.getByRole("button", { name: words.en.save }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  const soundcloudRequests = requests.soundcloud.length;
  await page.getByRole("button", { name: "Load Instagram post" }).click();
  expect((await cookie(page, "instagram"))?.value).toBe("accepted");
  expect((await cookie(page, "soundcloud"))?.value).toBe("rejected");
  await expect(page.locator(".instagram-media iframe")).toHaveCount(2);
  await expect(page.locator(".sc-player iframe")).toHaveCount(0);
  expect(requests.soundcloud).toHaveLength(soundcloudRequests);
});

test("an earlier Instagram-only answer asks once more for SoundCloud", async ({
  page,
  context,
}) => {
  const requests = await stubProviders(page);
  await context.addCookies([
    {
      name: "evryvibe-instagram-consent",
      value: "accepted",
      url: "http://localhost:3100",
      sameSite: "Lax",
    },
  ]);
  await mount(page, "de", "dark");
  const dialog = page.getByRole("dialog", { name: words.de.dialog });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Neu: DJ-Player von SoundCloud");
  await expect(
    dialog.getByRole("checkbox", { name: /Instagram/ }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /SoundCloud/ }),
  ).not.toBeChecked();
  // The Instagram acceptance never loads SoundCloud.
  await expect(page.locator(".sc-player iframe")).toHaveCount(0);
  expect(requests.soundcloud).toEqual([]);
  await dialog.getByRole("button", { name: words.de.save }).click();
  expect((await cookie(page, "instagram"))?.value).toBe("accepted");
  expect((await cookie(page, "soundcloud"))?.value).toBe("rejected");
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".instagram-media iframe")).toHaveCount(2);
  await expect(page.locator(".sc-player iframe")).toHaveCount(0);
  expect(requests.soundcloud).toEqual([]);
});

test("a line-up plays one artist at a time after SoundCloud consent", async ({
  page,
}) => {
  const requests = await stubProviders(page);
  await mount(page, "de", "light");
  await page
    .getByRole("dialog", { name: words.de.dialog })
    .getByRole("button", { name: words.de.reject })
    .click();
  // The toggle's name changes with its state, so find it by what it controls.
  const first = page.locator('button[aria-controls="listen-first-dj"]');
  await page.getByRole("button", { name: "first-dj anhören" }).click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator("#listen-first-dj");
  await expect(panel).toBeVisible();
  await expect(panel.locator("iframe")).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "Auf SoundCloud anhören" }),
  ).toHaveAttribute("href", "https://soundcloud.com/first-dj");
  expect(requests.soundcloud).toEqual([]);
  await panel.getByRole("button", { name: words.de.loadPlayer }).click();
  await expect(panel.locator("iframe")).toHaveAttribute(
    "src",
    /url=https%3A%2F%2Fsoundcloud\.com%2Ffirst-dj/,
  );
  await page.getByRole("button", { name: "second-dj anhören" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".listen-panel iframe")).toHaveCount(1);
  await expect(page.locator("#listen-second-dj iframe")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Player von second-dj schließen" })
    .click();
  await expect(page.locator(".listen-panel iframe")).toHaveCount(0);
});

test("first visit asks on a page without any embed", async ({ page }) => {
  await mount(page, "en", "light", "&empty=1");
  const dialog = page.getByRole("dialog", { name: words.en.dialog });
  await expect(dialog).toBeVisible();
  const reject = dialog.getByRole("button", { name: "Reject" });
  await expect(reject).toBeFocused();
  // Focus stays inside the dialog in both directions.
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: words.en.save }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reject).toBeFocused();
  await reject.click();
  const settings = page.getByRole("button", { name: words.en.settings });
  await settings.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("migrates a previous localStorage Instagram choice once", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("evryvibe-instagram-consent", "rejected");
      sessionStorage.setItem("seeded", "1");
    }
  });
  await mount(page, "en", "light", "&empty=1");
  await expect
    .poll(async () => (await cookie(page, "instagram"))?.value)
    .toBe("rejected");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("evryvibe-instagram-consent"),
    ),
  ).toBeNull();
  // SoundCloud was never answered, so the dialog still asks for it.
  await expect(
    page.getByRole("dialog", { name: words.en.dialog }),
  ).toBeVisible();
});

test("real homepage offers media settings after the first choice", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /https:\/\/[^/]*(?:instagram|facebook|fbcdn|soundcloud|sndcdn)\./i.test(
        request.url(),
      )
    ) {
      external.push(request.url());
    }
  });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: words.de.dialog });
  await expect(dialog).toBeVisible();
  expect(external).toEqual([]);
  await dialog.getByRole("button", { name: "Ablehnen" }).click();
  await page.getByRole("button", { name: words.de.settings }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("footer")).not.toContainText("Einwilligung");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect((bounds?.x ?? 0) + (bounds?.width ?? Infinity)).toBeLessThanOrEqual(
      width,
    );
  }
  expect(external).toEqual([]);
});

for (const choice of ["accepted", "rejected"] as const) {
  test(`saved ${choice} choices never show a first-visit dialog during page load`, async ({
    page,
    context,
  }) => {
    await context.addCookies(
      ["instagram", "soundcloud"].map((provider) => ({
        name: `evryvibe-${provider}-consent`,
        value: choice,
        url: "http://localhost:3100",
        sameSite: "Lax" as const,
      })),
    );
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector(".consent-overlay")) {
          document.documentElement.dataset.consentDialogSeen = "yes";
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.consentDialogSeen ?? null,
      ),
    ).toBeNull();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.consentDialogSeen ?? null,
      ),
    ).toBeNull();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
