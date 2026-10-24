import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { z } from "zod";
import { expect, test } from "vitest";
import { closeDatabase, connectDatabase } from "../src/db/client";

const url = process.env.MCP_TEST_DATABASE_URL;
test.skipIf(!url).each(["post", "story"])(
  "a real stdio client can refresh and publish a %s package, replay it, and read the linked catalog",
  async (sourceKind) => {
    if (!url || !new URL(url).pathname.includes("_test"))
      throw new Error("Use a dedicated _test database");
    process.env.DATABASE_URL = url;
    const connection = connectDatabase(url);
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("src/mcp/server.ts")],
      env: {
        PATH: process.env.PATH ?? "",
        DATABASE_URL: url,
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "evryvibe-acceptance",
      version: "1.0.0",
    });
    async function call(name: string, args: Record<string, unknown>) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const blocks = z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .parse(response.content);
      const block = blocks.find((value) => value.type === "text");
      if (!block?.text) throw new Error("Tool did not return JSON text");
      const result: unknown = JSON.parse(block.text);
      return result;
    }
    try {
      await client.connect(transport);
      const inventory = await client.listTools();
      expect(inventory.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "enqueue_package",
          "claim_next_package",
          "complete_package",
          "search_catalogue",
          "list_genres",
          "update_dj",
          "update_event",
        ]),
      );
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const source = {
        postUrl:
          sourceKind === "story"
            ? `https://www.instagram.com/stories/test_${suffix}/${Date.now()}12345/`
            : `https://www.instagram.com/p/TEST_${suffix}/`,
        accountUrl: `https://www.instagram.com/test_${suffix}/`,
        caption: "Fictional automated acceptance data",
        ocrText: "MCP acceptance night. Venue + two DJs.",
        capturedAt: new Date().toISOString(),
      };
      const rowSchema = z.object({ id: z.uuid() });
      const queued = rowSchema.parse(await call("enqueue_package", source));
      expect(
        inventory.tools.some((tool) => tool.name === "preview_image_candidate"),
      ).toBe(false);
      expect(rowSchema.parse(await call("enqueue_package", source)).id).toBe(
        queued.id,
      );
      if (sourceKind === "story") {
        const invalidSource = await client.callTool({
          name: "enqueue_package",
          arguments: {
            ...source,
            accountUrl: "https://www.instagram.com/another_account/",
          },
        });
        expect(invalidSource.isError).toBe(true);
        const refreshed = {
          ...source,
          caption: "Updated story evidence",
          capturedAt: new Date(
            Date.parse(source.capturedAt) + 1000,
          ).toISOString(),
        };
        await call("refresh_package", {
          packageId: queued.id,
          package: refreshed,
        });
        const stored = z
          .object({
            payload: z.object({
              postUrl: z.string(),
              caption: z.string(),
            }),
            state: z.string(),
          })
          .parse(await call("get_package", { packageId: queued.id }));
        expect(stored.payload.postUrl).toBe(source.postUrl);
        expect(stored.payload.caption).toBe(refreshed.caption);
        expect(stored.state).toBe("pending");
      }
      const claim = z
        .object({
          claimed: z.literal(true),
          claimToken: z.uuid(),
          package: rowSchema,
        })
        .parse(await call("claim_next_package", {}));
      expect(claim.package.id).toBe(queued.id);
      const venueSlug = `mcp-room-${suffix}`,
        djSlug = `mcp-dj-${suffix}`,
        eventSlug = `mcp-night-${suffix}`;
      const bundle = {
        venues: [
          {
            slug: venueSlug,
            name: "MCP Test Room",
            city: "Berlin",
            country: "Germany",
            address: "Fictional test address",
            timezone: "Europe/Berlin",
            description: "Test only",
            imageUrl: null,
            instagramUrl: source.accountUrl,
            websiteUrl: null,
          },
        ],
        djs: [
          {
            slug: djSlug,
            name: "MCP Test DJ",
            description: "Test only",
            genres: ["Techno"],
            imageUrl: null,
            instagramUrl: null,
            websiteUrl: null,
            samplePostUrl: sourceKind === "post" ? source.postUrl : null,
          },
        ],
        events: [
          {
            slug: eventSlug,
            title: "MCP Acceptance Night",
            description: "Fictional automated test",
            venueSlug,
            djSlugs: [djSlug],
            startsAt: "2030-09-21T23:00:00+02:00",
            endsAt: "2030-09-22T06:00:00+02:00",
            genres: ["Techno"],
            imageUrl: null,
            ticketUrl: "https://example.com/tickets",
            websiteUrl: null,
            status: "scheduled",
          },
        ],
      };
      const completion = {
        packageId: queued.id,
        claimToken: claim.claimToken,
        bundle,
      };
      const resultSchema = z.object({
        eventIds: z.array(z.uuid()).length(1),
        replayed: z.boolean(),
      });
      const result = resultSchema.parse(
        await call("complete_package", completion),
      );
      expect(result.replayed).toBe(false);
      expect(
        resultSchema.parse(await call("complete_package", completion)),
      ).toEqual({ ...result, replayed: true });
      const catalog = z
        .object({
          events: z.array(
            z.object({
              id: z.uuid(),
              venueId: z.uuid(),
              djIds: z.array(z.uuid()),
              sourceUrl: z.string(),
              imageUrl: z.string().nullable(),
              imageMediaId: z.string().nullable(),
              sourcePackageIds: z.array(z.uuid()),
            }),
          ),
        })
        .parse(await call("search_catalogue", { query: eventSlug }));
      expect(catalog.events).toHaveLength(1);
      expect(catalog.events[0]?.id).toBe(result.eventIds[0]);
      expect(catalog.events[0]?.djIds).toHaveLength(1);
      expect(catalog.events[0]?.sourceUrl).toBe(source.postUrl);
      expect(catalog.events[0]?.imageUrl).toBeNull();
      expect(catalog.events[0]?.imageMediaId).toBeNull();
      expect(catalog.events[0]?.sourcePackageIds).toContain(queued.id);
      expect(
        z.object({ description: z.string() }).parse(
          await call("update_event", {
            eventId: result.eventIds[0],
            changes: { description: "Corrected fixture description" },
          }),
        ).description,
      ).toBe("Corrected fixture description");
      const invalid = await client.callTool({
        name: "complete_package",
        arguments: { ...completion, claimToken: randomUUID() },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await connection.close();
      await closeDatabase();
      delete process.env.DATABASE_URL;
    }
  },
  30000,
);
