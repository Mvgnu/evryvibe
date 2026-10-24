import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterEach, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  chatGptCallback,
  digest,
  OperatorOAuth,
  scope,
} from "../src/mcp/oauth";
import { createRemoteServer } from "../src/mcp/http";
const origin = "https://evryvibe.test";
const password = "test-only-long-operator-password";
const dirs: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "evryvibe-oauth-"));
  dirs.push(dir);
  const file = join(dir, "state.json");
  let now = Date.now();
  const auth = new OperatorOAuth(origin, file, password, () => now);
  const client = auth.register({ redirect_uris: [chatGptCallback] });
  const verifier = "v".repeat(43);
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: chatGptCallback,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: digest(verifier),
    state: "test-state",
    resource: `${origin}/mcp`,
    scope,
  });
  function tokenParams() {
    const redirect = new URL(auth.authorize(params, password));
    expect(redirect.searchParams.get("iss")).toBe(origin);
    expect(redirect.searchParams.get("state")).toBe("test-state");
    return new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: chatGptCallback,
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    });
  }
  return {
    auth,
    file,
    params,
    client,
    tokenParams,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
test("exact redirects, password, resource and PKCE protect authorization; codes cannot replay", () => {
  const { auth, params, tokenParams } = setup();
  expect(() =>
    auth.register({ redirect_uris: [`${chatGptCallback}/evil`] }),
  ).toThrow();
  expect(() => auth.authorize(params, "wrong")).toThrow("access_denied");
  const invalid = new URLSearchParams(params);
  invalid.set("code_challenge_method", "plain");
  expect(() => auth.validateAuthorization(invalid)).toThrow();
  const token = tokenParams();
  const wrong = new URLSearchParams(token);
  wrong.set("code_verifier", "x".repeat(43));
  expect(() => auth.token(wrong)).toThrow("invalid_grant");
  wrong.set("resource", "https://other.test/mcp");
  expect(() => auth.token(wrong)).toThrow("invalid_target");
  expect(auth.verify(auth.token(token).access_token)).toBe(true);
  expect(() => auth.token(token)).toThrow("invalid_grant");
});
test("tokens survive restart, are hashed on disk, expire, rotate, and revoke their family on reuse", () => {
  const { auth, file, client, tokenParams, advance } = setup();
  const first = auth.token(tokenParams());
  expect(readFileSync(file, "utf8")).not.toContain(first.access_token);
  expect(readFileSync(file, "utf8")).not.toContain(first.refresh_token);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  const restarted = new OperatorOAuth(origin, file, password);
  expect(restarted.verify(first.access_token)).toBe(true);
  const refresh = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: first.refresh_token,
    resource: `${origin}/mcp`,
  });
  const second = restarted.token(refresh);
  expect(restarted.verify(second.access_token)).toBe(true);
  expect(() => restarted.token(refresh)).toThrow("invalid_grant");
  expect(restarted.verify(first.access_token)).toBe(false);
  expect(restarted.verify(second.access_token)).toBe(false);
  advance(3600_001);
  expect(auth.verify(first.access_token)).toBe(false);
});
test("authorization codes expire and refresh grants cannot cross clients", () => {
  const { auth, tokenParams, advance } = setup();
  const expired = tokenParams();
  advance(120_001);
  expect(() => auth.token(expired)).toThrow("invalid_grant");
  const first = auth.token(tokenParams());
  const other = auth.register({ redirect_uris: [chatGptCallback] });
  expect(() =>
    auth.token(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: other.client_id,
        refresh_token: first.refresh_token,
        resource: `${origin}/mcp`,
      }),
    ),
  ).toThrow("invalid_grant");
  auth.revoke(first.access_token);
  expect(auth.verify(first.access_token)).toBe(false);
});
test("HTTP challenges every MCP call, prevents CSRF, then supports initialize/list/read using SDK transport", async () => {
  const { auth, params, tokenParams } = setup();
  let reads = 0;
  const server = createRemoteServer(auth, () => {
    const mcp = new McpServer({ name: "test", version: "1" });
    mcp.registerTool("read_queue", { inputSchema: {} }, async () => {
      reads++;
      return { content: [{ type: "text", text: "queue" }] };
    });
    return mcp;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  async function send(
    path: string,
    method = "GET",
    data = "",
    headers: Record<string, string> = {},
  ) {
    return new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      text: string;
    }>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: typeof address === "object" && address ? address.port : 0,
          path,
          method,
          headers: { Host: "evryvibe.test", ...headers },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(data);
    });
  }
  try {
    const blocked = await send(
      "/mcp",
      "POST",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_queue" },
      }),
    );
    expect(blocked.status).toBe(401);
    expect(blocked.headers["www-authenticate"]).toContain("resource_metadata");
    expect(reads).toBe(0);
    expect(
      (await send("/mcp", "POST", "{}", { Origin: "https://evil.test" }))
        .status,
    ).toBe(403);
    const metadata = await send("/.well-known/oauth-authorization-server");
    expect(JSON.parse(metadata.text).code_challenge_methods_supported).toEqual([
      "S256",
    ]);
    const form = await send(`/oauth/authorize?${params}`);
    expect(form.status).toBe(200);
    const nonce = /name="nonce" value="([^"]+)"/.exec(form.text)?.[1] ?? "";
    const data = new URLSearchParams({ nonce, password }).toString();
    const formHeaders = {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    expect(
      (await send("/oauth/authorize", "POST", data, formHeaders)).status,
    ).toBe(403);
    const cookie = form.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    expect(
      (
        await send("/oauth/authorize", "POST", data, {
          ...formHeaders,
          Cookie: cookie,
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await send("/oauth/authorize", "POST", data, {
          ...formHeaders,
          Cookie: cookie,
        })
      ).status,
    ).toBe(403);
    const token = auth.token(tokenParams()).access_token;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    expect(
      (
        await send(
          "/mcp",
          "POST",
          JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
          headers,
        )
      ).status,
    ).toBe(413);
    const init = await send(
      "/mcp",
      "POST",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
      headers,
    );
    expect(init.status, init.text).toBe(200);
    const list = await send(
      "/mcp",
      "POST",
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      headers,
    );
    expect(JSON.parse(list.text).result.tools[0].name).toBe("read_queue");
    const read = await send(
      "/mcp",
      "POST",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "read_queue", arguments: {} },
      }),
      headers,
    );
    expect(
      z
        .object({
          result: z.object({
            content: z.array(z.object({ text: z.string() })),
          }),
        })
        .parse(JSON.parse(read.text)).result.content[0]?.text,
    ).toBe("queue");
    expect(reads).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("public registration capacity cannot poison existing authorization or token persistence", () => {
  const { file, params, client } = setup();
  const clients = Object.fromEntries(
    Array.from({ length: 2047 }, (_, i) => [
      `fixture-${i}`,
      { redirect: chatGptCallback, expires: Date.now() + 86400_000 },
    ]),
  );
  clients[client.client_id] = {
    redirect: chatGptCallback,
    expires: Date.now() + 86400_000,
  };
  writeFileSync(
    file,
    JSON.stringify({ version: 1, clients, codes: {}, access: {}, refresh: {} }),
  );
  const auth = new OperatorOAuth(origin, file, password);
  for (let i = 0; i < 3; i++)
    expect(() => auth.register({ redirect_uris: [chatGptCallback] })).toThrow(
      "temporarily_unavailable",
    );
  const redirect = new URL(auth.authorize(params, password));
  const token = auth.token(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code") ?? "",
      client_id: client.client_id,
      redirect_uri: chatGptCallback,
      code_verifier: "v".repeat(43),
      resource: `${origin}/mcp`,
    }),
  );
  expect(auth.verify(token.access_token)).toBe(true);
  expect(
    Object.keys(JSON.parse(readFileSync(file, "utf8")).clients),
  ).toHaveLength(2048);
});
test("unused public registration expires after ten minutes", () => {
  const { auth, advance, params } = setup();
  advance(600_001);
  expect(() => auth.authorize(params, password)).toThrow("invalid_client");
});
