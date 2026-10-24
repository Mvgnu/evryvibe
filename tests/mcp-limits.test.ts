import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectDatabase } from "../src/db/client";
import { createMcpServer } from "../src/mcp/tools";

test("production MCP rejects excessive argument elements before tool validation", async () => {
  // No connection is opened: list_genres is static and rejected calls never reach a repository.
  const connection = connectDatabase(
    "postgres://unused:unused@127.0.0.1:1/unused",
  );
  const server = createMcpServer(connection.db);
  const client = new Client({ name: "limits-test", version: "1" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    expect(
      (await client.callTool({ name: "list_genres", arguments: {} })).isError,
    ).not.toBe(true);
    const rejected = await client.callTool({
      name: "list_genres",
      arguments: { padding: Array.from({ length: 10_001 }, () => 0) },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toMatch(/element|limit/i);
    expect(
      (await client.callTool({ name: "list_genres", arguments: {} })).isError,
    ).not.toBe(true);
  } finally {
    await client.close();
    await server.close();
    await connection.close();
  }
});
