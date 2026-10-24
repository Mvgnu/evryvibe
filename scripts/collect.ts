import { resolve } from "node:path";
import { connectCollectorMcp } from "../src/collector/mcp";
import { openInstagram, captureProfile } from "../src/collector/instagram";
import { collectSources } from "../src/collector/runner";
import {
  assertOutsideDailyRest,
  collectionDefaults,
  isDailyRest,
  sleep,
} from "../src/collector/pacing";
import { slugSchema } from "../src/core/model";
const args = process.argv.slice(2);
const scheduled = args[0] === "--scheduled";
const onlyVenueSlug = args[0]?.startsWith("--venue=")
  ? slugSchema.parse(args[0].slice("--venue=".length))
  : undefined;
if (args.length > 1 || (args.length === 1 && !scheduled && !onlyVenueSlug))
  throw new Error("Usage: npm run collect -- [--scheduled | --venue=<slug>]");
if (scheduled && isDailyRest(new Date())) {
  console.log("Scheduled collection skipped during Berlin daytime rest");
  process.exit(0);
}
const assertActive = () => assertOutsideDailyRest(new Date());
assertActive();
const mcp = await connectCollectorMcp();
try {
  const result = await collectSources({
    mcp,
    capture: async function* (source, shouldCapture) {
      // A fresh Chromium process per venue bounds memory across a long walk.
      assertActive();
      const browser = await openInstagram(true);
      try {
        yield* captureProfile(browser, source, {
          shouldCapture,
          assertActive,
          beforePost: async () => {
            await sleep(collectionDefaults.postDelayMs);
            assertActive();
          },
        });
      } finally {
        await browser.close();
      }
    },
    stateDir: resolve(".local/collector"),
    onlyVenueSlug,
    assertActive,
  });
  console.log(
    `Collection finished: ${result.sources} sources, ${result.failed} failed`,
  );
  if (result.failed) process.exitCode = 1;
} finally {
  await mcp.close();
}
