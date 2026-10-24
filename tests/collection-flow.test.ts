import { test, expect, vi } from "vitest";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "../src/db/client";
import { connectCollectorMcp } from "../src/collector/mcp";
import { collectSources } from "../src/collector/runner";
import { recognizeImage } from "../src/collector/media";
import { venueSourceSchema } from "../src/core/sources";
import { postPackageSchema, venueSchema } from "../src/core/model";

const url = process.env.COLLECTOR_TEST_DATABASE_URL;
test.skipIf(!url)(
  "real OCR flows through source controls and stdio MCP into a claimable package",
  async () => {
    if (!url || !new URL(url).pathname.includes("_test"))
      throw new Error("Use a dedicated collector test database");
    vi.stubEnv("DATABASE_URL", url);
    const db = connectDatabase(url);
    const temp = await mkdtemp(join(tmpdir(), "evryvibe-collection-flow-"));
    const browser = await chromium.launch();
    const mcp = await connectCollectorMcp();
    try {
      await migrate(db.db, { migrationsFolder: "./drizzle" });
      await db.db.execute(
        sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages CASCADE`,
      );
      const venue = venueSchema.parse(
        await mcp.call("upsert_venue", {
          venue: {
            slug: "ocr-fixture-room",
            name: "OCR Fixture Room",
            city: "Berlin",
            country: "Germany",
            address: "Test fixture only",
            timezone: "Europe/Berlin",
            description: "",
            imageUrl: null,
            instagramUrl: "https://www.instagram.com/ocr_fixture_room/",
            websiteUrl: null,
          },
        }),
      );
      const page = await browser.newPage({
        viewport: { width: 1000, height: 650 },
      });
      await page.setContent(
        '<main style="font:48px Arial;padding:50px;background:white;color:black">SIGNAL NIGHT<br>25 SEPTEMBER 2030<br>MIRA PHASE<br>DOORS 23:00</main>',
      );
      const file = join(temp, "flyer.png");
      await page.locator("main").screenshot({ path: file });
      const ocrText = await recognizeImage(file);
      expect(ocrText).toMatch(/SIGNAL NIGHT/);
      const pack = postPackageSchema.parse({
        postUrl: "https://www.instagram.com/p/OCR_FIXTURE/",
        accountUrl: venue.instagramUrl,
        caption: "Fictional test only",
        ocrText,
        capturedAt: new Date().toISOString(),
      });
      let captures = 0;
      const capture = async function* () {
        captures++;
        yield pack;
      };
      expect(await collectSources({ mcp, capture, stateDir: temp })).toEqual({
        sources: 0,
        failed: 0,
      });
      expect(captures).toBe(0);
      const on = venueSourceSchema.parse(
        await mcp.call("set_venue_source", {
          venueId: venue.id,
          expectedRevision: 0,
          enabled: true,
        }),
      );
      expect(await collectSources({ mcp, capture, stateDir: temp })).toEqual({
        sources: 1,
        failed: 0,
      });
      const claim = z
        .object({
          claimed: z.literal(true),
          claimToken: z.uuid(),
          package: z.object({ id: z.uuid(), payload: postPackageSchema }),
        })
        .parse(await mcp.call("claim_next_package", {}));
      expect(claim.package.payload.ocrText).toContain("MIRA PHASE");
      const sources = z
        .object({ sources: z.array(venueSourceSchema) })
        .parse(await mcp.call("list_venue_sources", {}));
      expect(sources.sources[0]).toMatchObject({
        lastPostCount: 1,
        lastError: null,
      });
      expect(sources.sources[0]?.lastSucceededAt).toBeTruthy();
      const off = venueSourceSchema.parse(
        await mcp.call("set_venue_source", {
          venueId: venue.id,
          expectedRevision: on.revision,
          enabled: false,
        }),
      );
      await expect(
        mcp.call("enqueue_collected_package", {
          venueId: venue.id,
          expectedRevision: off.revision,
          package: pack,
        }),
      ).rejects.toThrow(/source_disabled/);
      const renamed = venueSourceSchema.parse(
        await mcp.call("set_venue_profile", {
          venueId: venue.id,
          expectedRevision: off.revision,
          instagramUrl: "https://www.instagram.com/renamed_fixture_room/",
        }),
      );
      expect(renamed.enabled).toBe(false);
      expect(renamed.instagramUrl).toContain("renamed_fixture_room");
    } finally {
      await mcp.close();
      await browser.close();
      await db.close();
      await rm(temp, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  },
  45000,
);
