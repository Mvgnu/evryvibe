import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";

const envelope = z.object({ code: z.string(), message: z.string() });
export class OperatorToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function callOperatorTool(
  name:
    | "list_venue_sources"
    | "set_venue_source"
    | "upsert_venue"
    | "set_venue_profile",
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!process.env.DATABASE_URL)
    throw new OperatorToolError(
      "unavailable",
      "The database is not configured. Set DATABASE_URL on the server, then retry.",
    );
  const client = new Client({ name: "evryvibe-operator", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      resolve(process.cwd(), "node_modules/tsx/dist/loader.mjs"),
      resolve(process.cwd(), "src/mcp/server.ts"),
    ],
    cwd: process.cwd(),
    env: { DATABASE_URL: process.env.DATABASE_URL },
    stderr: "ignore",
  });
  try {
    await client.connect(transport, { timeout: 15000 });
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 20000,
    });
    const parsed = z
      .object({
        isError: z.boolean().optional(),
        content: z.array(
          z.object({ type: z.string(), text: z.string().optional() }),
        ),
      })
      .parse(result);
    const text = parsed.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Missing tool response");
    const value: unknown = JSON.parse(text);
    if (parsed.isError) {
      const failure = envelope.parse(value);
      throw new OperatorToolError(failure.code, failure.message);
    }
    return value;
  } catch (error) {
    if (error instanceof OperatorToolError) throw error;
    throw new OperatorToolError(
      "unavailable",
      "The source service could not complete this request. Refresh the source list and retry. Check server configuration if it persists.",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}
