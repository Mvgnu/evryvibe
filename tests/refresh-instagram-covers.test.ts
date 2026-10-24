import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test.each([{ args: [] }, { args: ["--force"] }])(
  "retired cover command makes no network or database requests with args %j",
  async ({ args }) => {
    const script = `
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    let requests=0;
    const denied=()=>{requests++;throw new Error('Outbound request prohibited');};
    globalThis.fetch=denied;http.request=denied;https.request=denied;net.Socket.prototype.connect=denied;
    process.argv.push(...${JSON.stringify(args)});
    await import(${JSON.stringify(pathToFileURL(resolve("scripts/refresh-instagram-covers.ts")).href)});
    console.log(JSON.stringify({requests}));
  `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        timeout: 10000,
        env: {
          ...process.env,
          DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused_test",
          EVRYVIBE_COLLECTOR_MCP_SSH_KEY: "/nonexistent",
        },
      },
    );
    const lines = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ status: "disabled" });
    expect(lines[1]).toEqual({ requests: 0 });
  },
);
