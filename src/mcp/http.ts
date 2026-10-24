import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  chatGptCallback,
  digest,
  OAuthError,
  OperatorOAuth,
  scope,
} from "./oauth";

async function body(req: IncomingMessage, limit = 16384) {
  let value = "";
  for await (const chunk of req) {
    value += chunk.toString();
    if (Buffer.byteLength(value) > limit)
      throw new OAuthError("request_too_large", 413);
  }
  return value;
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export function createRemoteServer(
  auth: OperatorOAuth,
  factory: () => McpServer,
) {
  const forms = new Map<
    string,
    { params: string; cookie: string; expires: number }
  >();
  const rates = new Map<string, { count: number; expires: number }>();
  function throttle(group: string, limit: number) {
    let rate = rates.get(group);
    if (!rate || rate.expires <= Date.now()) {
      rate = { count: 0, expires: Date.now() + 60_000 };
      rates.set(group, rate);
    }
    if (++rate.count > limit)
      throw new OAuthError("temporarily_unavailable", 429);
  }
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url ?? "/", auth.origin);
      if (req.headers.host !== new URL(auth.origin).host)
        throw new OAuthError("invalid_host", 403);
      if (
        req.headers.origin &&
        req.headers.origin !== auth.origin &&
        req.headers.origin !== "https://chatgpt.com"
      )
        throw new OAuthError("invalid_origin", 403);
      throttle("all", 600);
      if (
        req.method === "GET" &&
        [
          "/.well-known/oauth-protected-resource",
          "/.well-known/oauth-protected-resource/mcp",
        ].includes(url.pathname)
      ) {
        return json(res, 200, {
          resource: auth.resource,
          authorization_servers: [auth.origin],
          scopes_supported: [scope],
          bearer_methods_supported: ["header"],
        });
      }
      if (
        req.method === "GET" &&
        url.pathname === "/.well-known/oauth-authorization-server"
      )
        return json(res, 200, {
          issuer: auth.origin,
          authorization_endpoint: `${auth.origin}/oauth/authorize`,
          token_endpoint: `${auth.origin}/oauth/token`,
          registration_endpoint: `${auth.origin}/oauth/register`,
          revocation_endpoint: `${auth.origin}/oauth/revoke`,
          authorization_response_iss_parameter_supported: true,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: [scope],
        });
      if (req.method === "POST" && url.pathname === "/oauth/register") {
        throttle("register", 10);
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new OAuthError("invalid_request");
        return json(res, 201, auth.register(JSON.parse(await body(req))));
      }
      if (url.pathname === "/oauth/authorize" && req.method === "GET") {
        throttle("authorize", 30);
        auth.validateAuthorization(url.searchParams);
        // Preserve Origin on the form POST without sending OAuth parameters
        // as a referrer to the external callback.
        res.setHeader("Referrer-Policy", "same-origin");
        for (const [key, entry] of forms)
          if (entry.expires <= Date.now()) forms.delete(key);
        if (forms.size >= 100)
          throw new OAuthError("temporarily_unavailable", 429);
        const nonce = randomBytes(32).toString("base64url"),
          cookie = randomBytes(32).toString("base64url");
        forms.set(digest(nonce), {
          params: url.searchParams.toString(),
          cookie: digest(cookie),
          expires: Date.now() + 600_000,
        });
        res.setHeader(
          "Set-Cookie",
          `__Host-evryvibe-oauth=${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
        );
        res.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${chatGptCallback}; frame-ancestors 'none'; base-uri 'none'`,
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        const en = url.searchParams.get("ui_locales") === "en";
        const languageUrl = new URL(url);
        languageUrl.searchParams.set("ui_locales", en ? "de" : "en");
        const title = en ? "Connect EVRYVIBE" : "EVRYVIBE verbinden";
        return res.end(
          `<!doctype html><html lang="${en ? "en" : "de"}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title><style>:root{color-scheme:light dark}body{font:18px system-ui;max-width:480px;margin:8vh auto;padding:24px;background:#faf8ef;color:#171717}a{color:inherit}h1{font-size:clamp(30px,8vw,40px);line-height:1.1}input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;font:inherit;border-radius:4px}input{border:1px solid #777}button{background:#d5fa43;color:#101010;border:0;font-weight:700;cursor:pointer}:focus-visible{outline:3px solid #648000;outline-offset:3px}@media(prefers-color-scheme:dark){body{background:#101010;color:#f9f5e9}}</style><nav><a href="${escape(languageUrl.pathname + languageUrl.search)}" lang="${en ? "de" : "en"}">${en ? "Deutsch" : "English"}</a></nav><h1>${title}</h1><p>${en ? "Allow ChatGPT to manage collection sources and the queue, and create or update venues, DJs and events." : "Erlaube ChatGPT, deine Erfassungsquellen und Warteschlange zu verwalten und Veranstaltungsorte, DJs und Events anzulegen oder zu aktualisieren."}</p><p>${en ? "Only the EVRYVIBE operator can authorize access." : "Nur der EVRYVIBE-Betreiber kann diesen Zugriff erlauben."}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${escape(nonce)}"><label for="password">${en ? "Operator password" : "Betreiber-Passwort"}</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><button>${en ? "Authorize ChatGPT" : "ChatGPT autorisieren"}</button></form></html>`,
        );
      }
      if (url.pathname.startsWith("/oauth/") && req.method === "POST") {
        throttle(
          url.pathname === "/oauth/authorize" ? "login" : "token",
          url.pathname === "/oauth/authorize" ? 10 : 60,
        );
        if (
          !req.headers["content-type"]?.startsWith(
            "application/x-www-form-urlencoded",
          )
        )
          throw new OAuthError("invalid_request");
        const params = new URLSearchParams(await body(req));
        for (const key of params.keys())
          if (params.getAll(key).length !== 1)
            throw new OAuthError("invalid_request");
        if (url.pathname === "/oauth/authorize") {
          if (req.headers.origin !== auth.origin)
            throw new OAuthError("access_denied", 403);
          const key = digest(params.get("nonce") ?? ""),
            form = forms.get(key);
          const cookie =
            req.headers.cookie
              ?.split(";")
              .map((part) => part.trim())
              .find((part) => part.startsWith("__Host-evryvibe-oauth="))
              ?.split("=")[1] ?? "";
          if (
            !form ||
            form.expires <= Date.now() ||
            form.cookie !== digest(cookie)
          )
            throw new OAuthError("access_denied", 403);
          forms.delete(key);
          const redirect = auth.authorize(
            new URLSearchParams(form.params),
            params.get("password") ?? "",
          );
          res.writeHead(302, {
            Location: redirect,
            "Set-Cookie":
              "__Host-evryvibe-oauth=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
          });
          return res.end();
        }
        if (url.pathname === "/oauth/token")
          return json(res, 200, auth.token(params));
        if (url.pathname === "/oauth/revoke") {
          auth.revoke(params.get("token") ?? "");
          return json(res, 200, {});
        }
      }
      if (url.pathname === "/mcp") {
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
          req.headers.authorization ?? "",
        );
        if (!match || !auth.verify(match[1] ?? "")) {
          res.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${auth.origin}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`,
          );
          return json(res, 401, { error: "invalid_token" });
        }
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          return json(res, 405, { error: "method_not_allowed" });
        }
        const parsed: unknown = JSON.parse(await body(req, 1024 * 1024));
        const mcp = factory();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.once("close", () => {
          void mcp.close();
        });
        await mcp.connect(transport);
        await transport.handleRequest(req, res, parsed);
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          error instanceof OAuthError
            ? error.status
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
          {
            error:
              error instanceof OAuthError
                ? error.code
                : error instanceof z.ZodError || error instanceof SyntaxError
                  ? "invalid_request"
                  : "server_error",
          },
        );
      else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}
