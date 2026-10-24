import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { connectDatabase } from "../src/db/client";
import { djs } from "../src/db/schema";
import { createMcpServer } from "../src/mcp/tools";
import { fakeSoundcloud } from "./support/backend";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("reconciliation tools over MCP", () => {
  const connection = connectDatabase(url ?? "postgres://unused");
  const soundcloud = fakeSoundcloud({
    "https://soundcloud.com/vivi": { title: "VIVI", bio: "IG vivi_music" },
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.includes("test"))
      throw new Error(
        "Tests require an explicitly named disposable test database",
      );
    await migrate(connection.db, { migrationsFolder: "./drizzle" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(connection.db, { soundcloud }).connect(serverSide);
    await client.connect(clientSide);
  });
  beforeEach(async () => {
    await connection.db.execute(
      sql`TRUNCATE event_sources, event_djs, events, djs, venues, post_packages, reconciliation_tasks CASCADE`,
    );
    soundcloud.down = false;
  });
  afterAll(async () => {
    await client.close();
    await connection.close();
  });
  async function call(name: string, args: Record<string, unknown>) {
    const response = await client.callTool({ name, arguments: args });
    const [block] = z
      .array(z.object({ type: z.string(), text: z.string() }))
      .parse(response.content);
    const body: unknown = JSON.parse(block?.text ?? "null");
    return { isError: response.isError === true, body };
  }

  it("registers the new tools with usable input schemas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "update_venue",
        "seed_reconciliation",
        "flag_for_reconciliation",
        "list_reconciliation_tasks",
        "claim_reconciliation_tasks",
        "complete_reconciliation_task",
        "defer_reconciliation_task",
        "requeue_reconciliation_task",
      ]),
    );
    const claim = tools.find(
      (tool) => tool.name === "claim_reconciliation_tasks",
    );
    expect(JSON.stringify(claim?.inputSchema)).toContain("leaseSeconds");
  });

  it("runs seed, claim, complete and replay through the protocol", async () => {
    const [dj] = await connection.db
      .insert(djs)
      .values({
        slug: "vivi",
        name: "VIVI",
        description: "VIVI ist als DJ im elektronischen Clubbereich aktiv.",
        genres: [],
      })
      .returning();
    if (!dj) throw new Error("dj");
    const seeded = await call("seed_reconciliation", { entityType: "dj" });
    expect(seeded.body).toMatchObject({ created: 1 });
    const claimed = await call("claim_reconciliation_tasks", { limit: 5 });
    const parsed = z
      .object({
        tasks: z.array(
          z.object({ taskId: z.string(), claimToken: z.string() }),
        ),
      })
      .parse(claimed.body);
    const [task] = parsed.tasks;
    if (!task) throw new Error("task");
    const request = {
      ...task,
      changes: {
        description: "",
        soundcloudUrl: "https://soundcloud.com/vivi",
      },
      outcome: {
        description: "cleared",
        soundcloud: "set",
        basis: "bio links the Instagram",
      },
    };
    const first = await call("complete_reconciliation_task", request);
    expect(first.isError).toBe(false);
    expect(first.body).toMatchObject({
      state: "done",
      soundcloud: { title: "VIVI" },
    });
    expect(
      (await call("complete_reconciliation_task", request)).body,
    ).toMatchObject({ replayed: true });
    expect((await call("list_reconciliation_tasks", {})).body).toMatchObject({
      counts: { byState: { done: 1 } },
    });
    const missing = await call("complete_reconciliation_task", {
      ...request,
      taskId: crypto.randomUUID(),
    });
    expect(missing).toMatchObject({
      isError: true,
      body: { code: "not_found" },
    });
  });

  it("an unreachable SoundCloud never blocks a write", async () => {
    const [dj] = await connection.db
      .insert(djs)
      .values({ slug: "vivi", name: "VIVI", description: "", genres: [] })
      .returning();
    if (!dj) throw new Error("dj");
    soundcloud.down = true;
    const result = await call("update_dj", {
      djId: dj.id,
      changes: { soundcloudUrl: "https://soundcloud.com/vivi" },
    });
    expect(result).toMatchObject({
      isError: false,
      body: {
        soundcloudUrl: "https://soundcloud.com/vivi",
        soundcloud: { url: "https://soundcloud.com/vivi", title: "" },
      },
    });
    expect(
      (await call("flag_for_reconciliation", { djId: dj.id, reason: "x" }))
        .body,
    ).toMatchObject({ checks: ["flagged"] });
  });
});
