import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { expect, test } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRemoteServer } from "../src/mcp/http";
import {
  chatGptCallback,
  digest,
  OperatorOAuth,
  scope,
} from "../src/mcp/oauth";

// This suite uses a real browser when installed; no live DNS or ChatGPT traffic.
test.skipIf(!existsSync(chromium.executablePath()))(
  "Chromium follows the real consent POST to the exact ChatGPT callback while blocking an untrusted redirect",
  async () => {
    const origin = "https://evryvibe.test";
    const password = "browser-fixture-operator-password";
    const dir = mkdtempSync(join(tmpdir(), "evryvibe-oauth-browser-"));
    const auth = new OperatorOAuth(origin, join(dir, "oauth.json"), password);
    const client = auth.register({ redirect_uris: [chatGptCallback] });
    const verifier = "v".repeat(43);
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: chatGptCallback,
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: digest(verifier),
      state: "browser-fixture-state",
      resource: `${origin}/mcp`,
      scope,
    });
    const server = createRemoteServer(
      auth,
      () => new McpServer({ name: "fixture", version: "1" }),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No HTTP listener");
    const port = address.port;
    let browser: Browser | undefined;
    const consentStatuses: number[] = [];
    let callbackVisits = 0;
    let unexpectedVisits = 0;
    let consentPosts = 0;
    let replaceRedirect = false;
    const requestSchema = z.object({
      url: z.string(),
      method: z.string(),
      headers: z.record(z.string(), z.string()),
      postData: z.string().optional(),
    });
    async function proxy(incoming: z.infer<typeof requestSchema>) {
      const url = new URL(incoming.url);
      const headers = incoming.headers;
      const response = await new Promise<{
        status: number;
        headers: Record<string, string>;
        body: Buffer;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path: url.pathname + url.search,
            method: incoming.method,
            headers: { ...headers, host: "evryvibe.test" },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => {
              const responseHeaders: Record<string, string> = {};
              for (const [key, value] of Object.entries(res.headers))
                if (
                  value !== undefined &&
                  !["connection", "transfer-encoding"].includes(key)
                )
                  responseHeaders[key] = Array.isArray(value)
                    ? value.join("\n")
                    : value;
              resolve({
                status: res.statusCode ?? 500,
                headers: responseHeaders,
                body: Buffer.concat(chunks),
              });
            });
          },
        );
        req.on("error", reject);
        req.end(incoming.postData);
      });
      if (incoming.method === "POST" && url.pathname === "/oauth/authorize") {
        consentPosts++;
        consentStatuses.push(response.status);
        // Simulate a compromised redirect response while preserving the real page CSP.
        if (replaceRedirect)
          response.headers.location = "https://untrusted.test/callback";
      }
      return response;
    }
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      // CDP intercepts every hop; Playwright route handlers only see the initial
      // request in a redirect chain and must not be used to mock this callback.
      cdp.on("Fetch.requestPaused", async (event: unknown) => {
        const paused = z
          .object({ requestId: z.string(), request: requestSchema })
          .parse(event);
        const url = new URL(paused.request.url);
        if (url.origin === origin) {
          const response = await proxy(paused.request);
          await cdp.send("Fetch.fulfillRequest", {
            requestId: paused.requestId,
            responseCode: response.status,
            responseHeaders: Object.entries(response.headers).map(
              ([name, value]) => ({ name, value }),
            ),
            body: response.body.toString("base64"),
          });
        } else if (`${url.origin}${url.pathname}` === chatGptCallback) {
          callbackVisits++;
          await cdp.send("Fetch.fulfillRequest", {
            requestId: paused.requestId,
            responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "text/html" }],
            body: Buffer.from("<h1>Callback reached</h1>").toString("base64"),
          });
        } else {
          unexpectedVisits++;
          await cdp.send("Fetch.failRequest", {
            requestId: paused.requestId,
            errorReason: "BlockedByClient",
          });
        }
      });
      await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      page.setDefaultTimeout(4000);
      const authorizeUrl = `${origin}/oauth/authorize?${params}`;
      await page.goto(authorizeUrl);
      await page.getByLabel("Betreiber-Passwort").fill(password);
      await Promise.all([
        page.waitForURL(
          (url) => `${url.origin}${url.pathname}` === chatGptCallback,
        ),
        page.getByRole("button", { name: "ChatGPT autorisieren" }).click(),
      ]);
      expect(callbackVisits).toBe(1);
      expect(consentPosts).toBe(1);
      expect(consentStatuses).toEqual([302]);
      const callback = new URL(page.url());
      expect(callback.searchParams.get("iss")).toBe(origin);
      expect(callback.searchParams.get("state")).toBe("browser-fixture-state");
      // Redeem the code produced by the actual cookie/nonce/password form submission.
      const grant = auth.token(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: callback.searchParams.get("code") ?? "",
          code_verifier: verifier,
          redirect_uri: chatGptCallback,
          resource: `${origin}/mcp`,
        }),
      );
      expect(auth.verify(grant.access_token)).toBe(true);

      const invalidParams = new URLSearchParams(params);
      invalidParams.set("redirect_uri", "https://untrusted.test/callback");
      const rejected = await page.goto(
        `${origin}/oauth/authorize?${invalidParams}`,
      );
      expect(rejected?.status()).toBe(400);
      expect(await page.locator("form").count()).toBe(0);

      await page.goto(authorizeUrl);
      await page.getByLabel("Betreiber-Passwort").fill(password);
      replaceRedirect = true;
      const blocked = page.waitForEvent("console", {
        predicate: (message) =>
          message.text().includes("form-action") &&
          message.text().includes("blocked"),
      });
      await page
        .getByRole("button", { name: "ChatGPT autorisieren" })
        .click({ noWaitAfter: true });
      await blocked;
      expect(consentPosts).toBe(2);
      expect(consentStatuses).toEqual([302, 302]);
      expect(callbackVisits).toBe(1);
      expect(unexpectedVisits).toBe(0);
      expect(page.url()).not.toContain("untrusted.test");
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
