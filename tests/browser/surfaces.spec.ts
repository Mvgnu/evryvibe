import { expect, test } from "@playwright/test";

for (const surface of [
  {
    path: "/events/after-hours-frequency",
    title: "After Hours Frequency",
    file: "event",
  },
  { path: "/venues/signal-room", title: "Signal Room", file: "venue" },
  { path: "/djs/mira-phase", title: "Mira Phase", file: "dj" },
]) {
  test(`${surface.file} is a readable complete surface`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(surface.path);
    await expect(
      page.getByRole("heading", { name: surface.title, exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (surface.file === "event") {
      const venue = await page.locator(".detail-venue").boundingBox();
      expect(venue).not.toBeNull();
      expect((venue?.y ?? Infinity) + (venue?.height ?? 0)).toBeLessThan(
        page.viewportSize()?.height ?? 0,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByText(
        "Alle Events, Orte und DJs hier sind fiktive Demoinhalte.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`${surface.file}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
