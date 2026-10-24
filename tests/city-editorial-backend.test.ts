import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cityEditorialInputSchema,
  cityEditorialSchema,
} from "../src/core/city-editorial";
import {
  cityEditorialRepository,
  getCityContent,
  listCityContent,
} from "../src/db/city-editorial";
import { connectDatabase } from "../src/db/client";
import { cityEditorial, venues } from "../src/db/schema";
import { createMcpServer } from "../src/mcp/tools";

const copy = {
  heading: "Fictional test heading",
  intro: "Fictional test introduction.",
  seoTitle: "Fictional test SEO title",
  metaDescription: "Fictional test description.",
};
const input = {
  citySlug: "koeln",
  de: copy,
  en: { ...copy, heading: "English fixture heading" },
};

describe("city editorial boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes slugs and trims text while requiring complete bilingual copy", () => {
    const parsed = cityEditorialInputSchema.parse({
      ...input,
      citySlug: " KOELN ",
      de: { ...copy, heading: " Heading " },
    });
    expect(parsed.citySlug).toBe("koeln");
    expect(parsed.de.heading).toBe("Heading");
    expect(
      cityEditorialInputSchema.safeParse({ citySlug: "koeln", de: copy })
        .success,
    ).toBe(false);
    expect(
      cityEditorialInputSchema.safeParse({
        ...input,
        en: { heading: "Partial" },
      }).success,
    ).toBe(false);
    expect(
      cityEditorialInputSchema.safeParse({
        ...input,
        updatedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it("rejects HTML, controls, blank copy, invalid slugs and excessive lengths", () => {
    for (const heading of [
      "<script>alert(1)</script>",
      "hello\u0000",
      "   ",
      "x".repeat(161),
    ])
      expect(
        cityEditorialInputSchema.safeParse({
          ...input,
          de: { ...copy, heading },
        }).success,
      ).toBe(false);
    for (const [field, length] of [
      ["intro", 2001],
      ["seoTitle", 161],
      ["metaDescription", 321],
    ] as const)
      expect(
        cityEditorialInputSchema.safeParse({
          ...input,
          en: { ...copy, [field]: "x".repeat(length) },
        }).success,
      ).toBe(false);
    for (const citySlug of ["../koeln", "koeln/", "köln", "x".repeat(81)])
      expect(
        cityEditorialInputSchema.safeParse({ ...input, citySlug }).success,
      ).toBe(false);
  });

  it("returns no editorial fixtures in demo or empty mode", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("EVRYVIBE_DEMO", "0");
    expect(await getCityContent("koeln")).toBeNull();
    expect(await listCityContent()).toEqual([]);
    vi.stubEnv("DATABASE_URL", "postgres://invalid/never-connect");
    vi.stubEnv("EVRYVIBE_DEMO", "1");
    expect(await getCityContent("koeln")).toBeNull();
    expect(await listCityContent()).toEqual([]);
  });
});

const url = process.env.CITY_EDITORIAL_TEST_DATABASE_URL;
describe.skipIf(!url)("city editorial PostgreSQL and MCP", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const repo = cityEditorialRepository(connection.db);
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("_test"))
      throw new Error("Use a dedicated _test database");
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
  });
  beforeEach(async () => {
    await connection.db.execute(sql`TRUNCATE city_editorial, venues CASCADE`);
    await connection.db.insert(venues).values({
      slug: "editorial-test-room",
      name: "Fixture room",
      city: "Köln",
      country: "Germany",
      address: "Fixture address",
      timezone: "Europe/Berlin",
      description: "",
    });
  });
  afterAll(async () => connection.close());

  it("upserts by venue-derived slug, replaces both locales and timestamps the write", async () => {
    expect(await repo.getCityContent("koeln")).toBeNull();
    const first = await repo.upsertCityContent({
      ...input,
      citySlug: " KOELN ",
    });
    expect(first).toMatchObject(input);
    expect(cityEditorialSchema.safeParse(first).success).toBe(true);
    await connection.db
      .update(cityEditorial)
      .set({ updatedAt: "2000-01-01T00:00:00Z" });
    const next = await repo.upsertCityContent({
      ...input,
      de: { ...copy, heading: "New German fixture" },
      en: { ...copy, intro: "New English fixture" },
    });
    expect(Date.parse(next.updatedAt)).toBeGreaterThan(
      Date.parse("2000-01-01T00:00:00Z"),
    );
    expect(await repo.getCityContent("koeln")).toEqual(next);
    expect(await repo.listCityContent()).toEqual([next]);
    expect(await connection.db.select().from(cityEditorial)).toHaveLength(1);
  });

  it("rejects phantom cities and hides content after the last venue moves", async () => {
    await expect(
      repo.upsertCityContent({ ...input, citySlug: "phantom" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await connection.db.select().from(cityEditorial)).toHaveLength(0);
    await repo.upsertCityContent(input);
    await connection.db
      .update(venues)
      .set({ city: "Berlin" })
      .where(eq(venues.slug, "editorial-test-room"));
    expect(await repo.getCityContent("koeln")).toBeNull();
    expect(await repo.listCityContent()).toEqual([]);
  });

  it("exposes typed read/write tools through the shared MCP factory", async () => {
    const server = createMcpServer(connection.db);
    const client = new Client({
      name: "city-editorial-test",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const inventory = await client.listTools();
      expect(
        inventory.tools.find((tool) => tool.name === "get_city_content")
          ?.annotations?.readOnlyHint,
      ).toBe(true);
      expect(
        inventory.tools.find((tool) => tool.name === "upsert_city_content")
          ?.annotations?.readOnlyHint,
      ).toBe(false);
      const write = await client.callTool({
        name: "upsert_city_content",
        arguments: input,
      });
      expect(write.isError).not.toBe(true);
      const read = await client.callTool({
        name: "get_city_content",
        arguments: { citySlug: "koeln" },
      });
      expect(read.content).toEqual(write.content);
      const invalid = await client.callTool({
        name: "upsert_city_content",
        arguments: { ...input, en: { heading: "Partial" } },
      });
      expect(invalid.isError).toBe(true);
      const unknown = await client.callTool({
        name: "upsert_city_content",
        arguments: { ...input, citySlug: "phantom" },
      });
      expect(unknown.isError).toBe(true);
      expect(unknown.content).toEqual([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining('"code":"not_found"'),
        }),
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
