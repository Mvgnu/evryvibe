import { readFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { parseInstagramCookies } from "../src/collector/cookies";
import { createInterface } from "node:readline/promises";
import { openInstagram } from "../src/collector/instagram";
const args = process.argv.slice(2);
if (
  args.length &&
  (args.length !== 2 || args[0] !== "--import-cookies" || !args[1])
)
  throw new Error("Usage: npm run instagram:login -- --import-cookies <path>");
const browser = await openInstagram(false);
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const timeout = setTimeout(
  () => {
    prompt.close();
    void browser.close();
  },
  10 * 60 * 1000,
);
try {
  if (args[1]) {
    const raw: unknown = JSON.parse(await readFile(resolve(args[1]), "utf8"));
    await browser.addCookies(parseInstagramCookies(raw));
    console.log("Instagram cookies imported into the dedicated local session.");
  }
  const page = await browser.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await prompt.question(
    "Complete Instagram login/checkpoint in the browser, then press Enter here to save the session. ",
  );
  console.log("Browser session saved locally. Collection will verify access.");
} finally {
  clearTimeout(timeout);
  prompt.close();
  await browser.close();
  await chmod(
    resolve(process.env.EVRYVIBE_INSTAGRAM_STATE_DIR ?? ".local/instagram"),
    0o700,
  );
}
