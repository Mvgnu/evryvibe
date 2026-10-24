import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const scope = "evryvibe:operator";
export const chatGptCallback =
  "https://chatgpt.com/connector_platform_oauth_redirect";
const secret = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const grantSchema = z.object({
  clientId: z.string(),
  resource: z.string(),
  issuer: z.string(),
  expires: z.number(),
  family: z.string(),
});
const stateSchema = z.object({
  version: z.literal(1),
  clients: z.record(
    z.string(),
    z.object({ redirect: z.string(), expires: z.number() }),
  ),
  codes: z.record(
    z.string(),
    grantSchema.extend({ redirect: z.string(), challenge: z.string() }),
  ),
  access: z.record(z.string(), grantSchema),
  refresh: z.record(z.string(), grantSchema.extend({ used: z.boolean() })),
});
type State = z.infer<typeof stateSchema>;
export class OAuthError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export class OperatorOAuth {
  private state: State;
  private committed = "";
  readonly resource: string;
  constructor(
    readonly origin: string,
    private file: string,
    private password: string,
    private now = () => Date.now(),
  ) {
    if (new URL(origin).origin !== origin || !origin.startsWith("https://"))
      throw new Error("MCP origin must be a canonical HTTPS origin");
    if (password.length < 16)
      throw new Error("Operator password must contain at least 16 characters");
    this.resource = `${origin}/mcp`;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (existsSync(file) && statSync(file).size > 8 * 1024 * 1024)
      throw new Error("OAuth state file exceeds size limit");
    this.state = existsSync(file)
      ? stateSchema.parse(JSON.parse(readFileSync(file, "utf8")))
      : { version: 1, clients: {}, codes: {}, access: {}, refresh: {} };
    this.committed = JSON.stringify(this.state);
    this.save();
  }
  private save() {
    try {
      this.persist();
      this.committed = JSON.stringify(this.state);
    } catch (error) {
      this.state = stateSchema.parse(JSON.parse(this.committed));
      throw error;
    }
  }
  private persist() {
    for (const records of [
      this.state.clients,
      this.state.codes,
      this.state.access,
      this.state.refresh,
    ]) {
      for (const [key, value] of Object.entries(records))
        if (value.expires <= this.now()) delete records[key];
      if (Object.keys(records).length > 2048)
        throw new OAuthError("temporarily_unavailable", 503);
    }
    const temp = `${this.file}.${secret()}.tmp`;
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(this.state));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temp, this.file);
    } catch (error) {
      unlinkSync(temp);
      throw error;
    }
  }
  register(input: unknown) {
    const data = z
      .object({
        redirect_uris: z.array(z.literal(chatGptCallback)).length(1),
        token_endpoint_auth_method: z.literal("none").default("none"),
        grant_types: z
          .array(z.enum(["authorization_code", "refresh_token"]))
          .optional(),
        response_types: z.array(z.literal("code")).optional(),
      })
      .parse(input);
    const id = secret();
    this.state.clients[id] = {
      redirect: chatGptCallback,
      expires: this.now() + 600_000,
    };
    this.save();
    return {
      client_id: id,
      client_id_issued_at: Math.floor(this.now() / 1000),
      redirect_uris: data.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }
  validateAuthorization(params: URLSearchParams) {
    for (const key of params.keys())
      if (params.getAll(key).length !== 1)
        throw new OAuthError("invalid_request");
    const data = z
      .object({
        client_id: z.string().max(100),
        redirect_uri: z.literal(chatGptCallback),
        response_type: z.literal("code"),
        code_challenge_method: z.literal("S256"),
        code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        state: z.string().min(1).max(2048),
        resource: z.literal(this.resource),
        scope: z.literal(scope).default(scope),
      })
      .parse(Object.fromEntries(params));
    const client = this.state.clients[data.client_id];
    if (
      !client ||
      client.expires <= this.now() ||
      client.redirect !== data.redirect_uri
    )
      throw new OAuthError("invalid_client");
    return data;
  }
  authorize(params: URLSearchParams, password: string) {
    const data = this.validateAuthorization(params);
    if (
      !timingSafeEqual(
        Buffer.from(digest(password)),
        Buffer.from(digest(this.password)),
      )
    )
      throw new OAuthError("access_denied", 403);
    const client = this.state.clients[data.client_id];
    if (!client) throw new OAuthError("invalid_client");
    client.expires = this.now() + 365 * 86400_000;
    const code = secret();
    this.state.codes[digest(code)] = {
      clientId: data.client_id,
      resource: this.resource,
      issuer: this.origin,
      expires: this.now() + 120_000,
      family: secret(),
      redirect: data.redirect_uri,
      challenge: data.code_challenge,
    };
    this.save();
    const url = new URL(data.redirect_uri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", data.state);
    url.searchParams.set("iss", this.origin);
    return url.href;
  }
  token(params: URLSearchParams) {
    const clientId = params.get("client_id");
    if (
      !clientId ||
      !this.state.clients[clientId] ||
      this.state.clients[clientId].expires <= this.now()
    )
      throw new OAuthError("invalid_client", 401);
    if (params.get("resource") !== this.resource)
      throw new OAuthError("invalid_target");
    const type = params.get("grant_type");
    let grant: z.infer<typeof grantSchema>;
    if (type === "authorization_code") {
      const key = digest(params.get("code") ?? "");
      const code = this.state.codes[key];
      const verifier = params.get("code_verifier") ?? "";
      if (
        !code ||
        code.expires <= this.now() ||
        code.clientId !== clientId ||
        code.redirect !== params.get("redirect_uri") ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        code.challenge !== digest(verifier)
      )
        throw new OAuthError("invalid_grant");
      grant = code;
      delete this.state.codes[key];
    } else if (type === "refresh_token") {
      const token =
        this.state.refresh[digest(params.get("refresh_token") ?? "")];
      if (!token || token.expires <= this.now() || token.clientId !== clientId)
        throw new OAuthError("invalid_grant");
      if (token.used) {
        for (const records of [this.state.access, this.state.refresh])
          for (const [key, value] of Object.entries(records))
            if (value.family === token.family) delete records[key];
        this.save();
        throw new OAuthError("invalid_grant");
      }
      if (params.has("scope") && params.get("scope") !== scope)
        throw new OAuthError("invalid_scope");
      grant = token;
      token.used = true;
    } else throw new OAuthError("unsupported_grant_type");
    if (grant.issuer !== this.origin || grant.resource !== this.resource)
      throw new OAuthError("invalid_grant");
    const access = secret(),
      refresh = secret();
    const base = {
      clientId,
      resource: this.resource,
      issuer: this.origin,
      family: grant.family,
    };
    this.state.access[digest(access)] = {
      ...base,
      expires: this.now() + 3600_000,
    };
    this.state.refresh[digest(refresh)] = {
      ...base,
      expires:
        type === "refresh_token" ? grant.expires : this.now() + 30 * 86400_000,
      used: false,
    };
    this.save();
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope,
    };
  }
  verify(token: string) {
    const grant = this.state.access[digest(token)];
    return (
      !!grant &&
      grant.expires > this.now() &&
      grant.resource === this.resource &&
      grant.issuer === this.origin
    );
  }
  revoke(token: string) {
    const grant =
      this.state.access[digest(token)] ?? this.state.refresh[digest(token)];
    if (grant) {
      for (const records of [this.state.access, this.state.refresh])
        for (const [key, value] of Object.entries(records))
          if (value.family === grant.family) delete records[key];
      this.save();
    }
  }
}
