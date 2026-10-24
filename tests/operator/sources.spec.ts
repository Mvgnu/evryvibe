import { expect, test } from "@playwright/test";

test("operator access requires authentication", async () => {
  const response = await fetch("http://localhost:3102/ops/sources");
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("Basic");
  expect(await response.text()).not.toContain("Source control.");
});

test("venue opt-in, profile correction, and removal persist without stale status", async ({
  page,
}) => {
  const suffix = Date.now().toString();
  const name = `Operator test fixture ${suffix}`;
  await page.goto("/ops/sources");
  const form = page.locator(".ops-venue-form");
  const fields = {
    name,
    slug: `operator-test-${suffix}`,
    city: "Test city",
    country: "Germany",
    address: "Test address 1",
    timezone: "Europe/Berlin",
    instagramUrl: `https://www.instagram.com/test_${suffix}/`,
  };
  for (const [field, value] of Object.entries(fields))
    await form.locator(`input[name="${field}"]`).fill(value);
  await form.getByRole("button", { name: "Save venue +", exact: true }).click();
  const source = page
    .locator(".ops-source")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const toggle = source.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await source.getByText("Edit Instagram profile", { exact: true }).click();
  await source
    .getByLabel("Instagram profile URL")
    .fill(`https://www.instagram.com/fixed_${suffix}/`);
  await source
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    source.getByText("Collection enabled.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    source.getByRole("link", { name: `fixed_${suffix}`, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(
    source.getByText(
      "Profile saved; collection is disabled until you enable it again.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await source.getByText("Edit Instagram profile", { exact: true }).click();
  await source.getByLabel("Instagram profile URL").fill("");
  await source
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toBeDisabled();
  await expect(
    source.getByText("No Instagram profile", { exact: true }),
  ).toBeVisible();
});
