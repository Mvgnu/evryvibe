import { expect, test, type Page } from "@playwright/test";

const storageKey = "evryvibe.listen.v1";
const artist = (page: Page) => page.locator("#listen-artist-name");

async function providerStubs(page: Page) {
  const requests: string[] = [];
  await page.route(
    /^https:\/\/([a-z0-9-]+\.)*(soundcloud|sndcdn)\.com\//,
    (route) => {
      const url = route.request().url();
      requests.push(url);
      if (url === "https://w.soundcloud.com/player/api.js") {
        return route.fulfill({
          contentType: "text/javascript",
          body: `
        (() => {
          const Events = { READY: 'ready', PLAY: 'play', FINISH: 'finish', ERROR: 'error' };
          function Widget(frame) {
            const handlers = {};
            const profile = new URL(frame.src).searchParams.get('url');
            const handle = new URL(profile).pathname.slice(1);
            let number = [...handle].reduce((total, c) => total * 31 + c.charCodeAt(0), 0) >>> 0;
            let sound = {id:number+1, title:'Test set: '+handle, permalink_url:profile+'/test-set', bpm:142, key_signature:'E-flat major'};
            const widget = {
              bind(event, callback) {handlers[event] = callback; if (event === 'ready') setTimeout(() => handlers.ready?.(), 0);},
              unbind(event) {delete handlers[event];},
              pause() {},
              getCurrentSound(callback) {const current = sound; setTimeout(() => callback(current), 10);}
            };
            window.__changeListenSound = () => {sound = {...sound, id:number+2, title:'Second test set', permalink_url:profile+'/second-set', bpm:null, key_signature:null}; handlers.play?.();};
            return widget;
          }
          Widget.Events = Events;
          window.SC = {Widget};
        })();
      `,
        });
      }
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body><button>Fixture player</button></body></html>",
      });
    },
  );
  return requests;
}

async function stored(page: Page) {
  return page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : { feedback: [] };
  }, storageKey);
}

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

test("neutral navigation, explicit feedback, matching nights, undo and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const external = await providerStubs(page);
  await page.goto("/listen");
  await expect(artist(page)).toBeVisible();
  await expect(page.locator(".demo-notice")).toContainText("FIKTIVE VORSCHAU");
  const first = (await artist(page).textContent()) ?? "";
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(external).toEqual([]);
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(artist(page)).not.toHaveText(first);
  expect((await stored(page)).feedback).toEqual([]);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(artist(page)).toHaveText(first);
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(artist(page)).not.toHaveText(first);
  expect((await stored(page)).feedback).toHaveLength(1);
  await expect(
    page.locator(".listen-recommendations .listen-night").first(),
  ).toBeVisible();
  await expect(page.locator(".listen-recommendations")).toContainText(first);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(artist(page)).toHaveText(first);
  expect((await stored(page)).feedback).toHaveLength(0);
  await expect(
    page.locator(".listen-recommendations .listen-night"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Dislike", exact: true }).click();
  expect((await stored(page)).feedback[0].value).toBe(-1);
  await page.reload();
  expect((await stored(page)).feedback).toHaveLength(1);
  await page.getByRole("button", { name: /Zurücksetzen/i }).click();
  expect((await stored(page)).feedback).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("radius precedes ranking and stays after reload", async ({ page }) => {
  await providerStubs(page);
  await page.goto("/listen");
  await page
    .getByRole("combobox", { name: "Startpunkt", exact: true })
    .selectOption("de:leipzig");
  await page
    .getByRole("combobox", { name: "Radius", exact: true })
    .selectOption("50");
  await expect(artist(page)).toBeVisible();
  await expect(page.locator(".listen-card-events")).toContainText("Leipzig");
  await expect(page.locator(".listen-card-events")).not.toContainText(
    "München",
  );
  await page.getByRole("button", { name: "Like", exact: true }).click();
  for (const row of await page
    .locator(".listen-recommendations .listen-night")
    .all()) {
    await expect(row).toContainText("Leipzig");
  }
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Startpunkt", exact: true }),
  ).toHaveValue("de:leipzig");
  await expect(
    page.getByRole("combobox", { name: "Radius", exact: true }),
  ).toHaveValue("50");
  await page
    .getByRole("combobox", { name: "Startpunkt", exact: true })
    .selectOption("ie:dublin");
  await expect(
    page.getByRole("heading", { name: "Hier ist es gerade still" }),
  ).toBeVisible();
  await expect(
    page.locator(".listen-recommendations .listen-night"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Überall · 90 Tage", exact: true })
    .click();
  await expect(artist(page)).toBeVisible();
});

test("consented widget binds actual sound, clears changed metadata and unloads on withdrawal", async ({
  page,
}) => {
  const external = await providerStubs(page);
  await page.goto("/listen");
  expect(external).toEqual([]);
  await page
    .getByRole("button", { name: "SoundCloud laden", exact: true })
    .click();
  await expect(page.locator(".listen-player iframe")).toHaveCount(1);
  await expect(page.locator(".listen-sound-values")).toContainText(
    "5B · Es-Dur",
  );
  await expect(page.locator(".listen-sound-values")).toContainText("142 BPM");
  await page.evaluate(() => {
    const change: unknown = Reflect.get(window, "__changeListenSound");
    if (typeof change === "function") change();
  });
  await expect(page.locator(".listen-sound-title")).toHaveText(
    "Second test set",
  );
  await expect(page.locator(".listen-sound-values")).not.toContainText("5B");
  await page.getByRole("button", { name: "Like", exact: true }).click();
  const feedback = (await stored(page)).feedback[0];
  expect(feedback.sound.title).toBe("Second test set");
  expect(feedback.sound.key).toBeNull();
  expect(feedback.sound.bpm).toBeNull();
  await expect(page.locator(".listen-player iframe")).toHaveCount(1);
  await expect(page.locator(".listen-sound-title")).not.toHaveText(
    "Second test set",
  );
  const settings = page.getByRole("button", {
    name: "Einstellungen für Instagram und SoundCloud",
  });
  // Let the mobile browser update iframe hit testing after scrolling back
  // from the player; an immediate auto-scroll/click can hit its old position.
  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeInViewport();
  await settings.click();
  const dialog = page.getByRole("dialog", {
    name: "Instagram und SoundCloud laden?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(page.locator(".listen-player iframe")).toHaveCount(0);
  await expect(page.locator(".listen-sound-title")).toHaveCount(0);
  await expect(page.locator(".listen-player .sc-link")).toBeVisible();
  const count = external.length;
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  expect(external).toHaveLength(count);
});

for (const locale of ["de", "en"] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`${locale}/${theme}: small screens, language and key reference`, async ({
      page,
    }, testInfo) => {
      await providerStubs(page);
      await page.addInitScript((theme) => {
        localStorage.setItem("evryvibe-theme", theme);
      }, theme);
      await page.goto(locale === "de" ? "/listen" : "/en/listen");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(artist(page)).toBeVisible();
      await page
        .getByRole("button", {
          name: locale === "de" ? "SoundCloud laden" : "Load SoundCloud",
          exact: true,
        })
        .click();
      await expect(page.locator(".listen-sound-values")).toContainText("5B");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`listen-${locale}-${theme}.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 320, height: 750 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const summary = page.locator(".listen-key-reference summary");
      await summary.click();
      await expect(page.locator(".listen-key-reference")).toContainText("12B");
      await expect(page.locator(".listen-key-reference")).toContainText(
        locale === "de" ? "Es-Dur" : "E♭ major",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("blocked browser storage retains a usable feed", async ({ page }) => {
  await providerStubs(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage disabled for test");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage disabled for test");
    };
  });
  await page.goto("/listen");
  await expect(artist(page)).toBeVisible();
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(
    page.locator(".listen-recommendations .listen-night").first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Feedback gilt nur für diese Sitzung/),
  ).toBeVisible();
});

test("without JavaScript the feed provides catalogue navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/listen");
  await expect(
    page.getByRole("button", { name: "Like", exact: true }),
  ).toBeHidden();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.locator("noscript").getByRole("link").first(),
  ).toBeVisible();
  await context.close();
});

test("reset in another tab is honoured after leaving and returning to the feed", async ({
  page,
  context,
}) => {
  await providerStubs(page);
  await page.goto("/listen");
  await page.getByRole("button", { name: "Like", exact: true }).click();
  expect((await stored(page)).feedback).toHaveLength(1);
  await page
    .locator("footer")
    .getByRole("link", { name: "DJs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/djs$/);
  const other = await context.newPage();
  await providerStubs(other);
  await other.goto("/listen");
  await other
    .getByRole("button", { name: "Alles zurücksetzen", exact: true })
    .click();
  await page
    .locator(".site-nav")
    .getByRole("link", { name: "Hören", exact: true })
    .click();
  await expect(artist(page)).toBeVisible();
  await expect(
    page.locator(".listen-recommendations .listen-night"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Like", exact: true }).click();
  expect((await stored(page)).feedback).toHaveLength(1);
  await other.close();
});

test("full storage quota keeps session-only feedback through soft navigation", async ({
  page,
}) => {
  await providerStubs(page);
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("Quota reached", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, storageKey);
  await page.goto("/listen");
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(
    page.locator(".listen-recommendations .listen-night").first(),
  ).toBeVisible();
  await page
    .locator("footer")
    .getByRole("link", { name: "DJs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/djs$/);
  await page
    .locator(".site-nav")
    .getByRole("link", { name: "Hören", exact: true })
    .click();
  await expect(
    page.locator(".listen-recommendations .listen-night").first(),
  ).toBeVisible();
  await expect(
    page.getByText(/Feedback gilt nur für diese Sitzung/),
  ).toBeVisible();
});
