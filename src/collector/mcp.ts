import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
export interface CollectorMcp {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export async function connectCollectorMcp(): Promise<CollectorMcp> {
  const sshKey = process.env.EVRYVIBE_COLLECTOR_MCP_SSH_KEY;
  if (sshKey && !isAbsolute(sshKey))
    throw new Error("EVRYVIBE_COLLECTOR_MCP_SSH_KEY must be an absolute path");
  if (!sshKey && !process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL or EVRYVIBE_COLLECTOR_MCP_SSH_KEY");
  const client = new Client({ name: "evryvibe-collector", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport(
      sshKey
        ? {
            command: "/usr/bin/ssh",
            args: [
              "-T",
              "-i",
              sshKey,
              "-o",
              "BatchMode=yes",
              "-o",
              "IdentitiesOnly=yes",
              "-o",
              "StrictHostKeyChecking=yes",
              "-o",
              "ConnectTimeout=15",
              "-o",
              "ServerAliveInterval=30",
              "-o",
              "ServerAliveCountMax=2",
              "evryvibe@87.58.154.89",
            ],
            stderr: "inherit",
          }
        : {
            command: process.execPath,
            args: ["--import", "tsx", resolve("src/mcp/server.ts")],
            env: {
              PATH: process.env.PATH ?? "",
              DATABASE_URL: process.env.DATABASE_URL ?? "",
            },
            stderr: "inherit",
          },
    ),
  );
  return {
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const blocks = z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .parse(result.content);
      const text = blocks.find((block) => block.type === "text")?.text;
      if (result.isError)
        throw new Error(
          `MCP ${name} rejected the request${text ? `: ${text}` : ""}`,
        );
      if (!text) throw new Error(`MCP ${name} returned no result`);
      const parsed: unknown = JSON.parse(text);
      return parsed;
    },
    close: () => client.close(),
  };
}
