import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsSession } from "../src/analytics/runtime";
import { analyticsEventSchema } from "../src/analytics/event";
import { GET, POST } from "../src/app/api/minilytics/route";

const time = "2026-10-05T12:00:00.000Z";
const id = "cfe6d2cf-7fbb-42a9-875d-a201dd04c22e";
const event = {
  eventType: "pageview",
  sessionId: id,
  runtimeSession: "memory-v1",
  path: "/cities/berlin",
  occurredAt: time,
  attribution: {
    landingPath: "/",
    landingReferrer: "https://example.com/private?email=secret",
  },
};
function request(
  payload: unknown = event,
  headers: Record<string, string> = {},
) {
  return new Request("https://evryvibe.com/api/minilytics", {
    method: "POST",
    headers: {
      origin: "https://evryvibe.com",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-real-ip": "203.0.113.4",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("document-only analytics session", () => {
  it("deduplicates query updates and flushes time to the previous page on navigation", () => {
    const session = createAnalyticsSession(
      id,
      "https://example.com/person?name=secret",
    );
    const first = session.visit(
      new URL("https://evryvibe.com/?q=private"),
      0,
      time,
      true,
    );
    expect(first).toEqual([
      {
        ...event,
        path: "/",
        attribution: {
          landingPath: "/",
          landingReferrer: "https://example.com",
        },
      },
    ]);
    expect(
      session.visit(
        new URL("https://evryvibe.com/?q=another"),
        1000,
        time,
        true,
      ),
    ).toEqual([]);
    const next = session.visit(
      new URL("https://evryvibe.com/events/event"),
      2500,
      time,
      true,
    );
    expect(next[0]).toMatchObject({
      eventType: "engagement",
      path: "/",
      properties: { engagementMs: 2500 },
    });
    expect(next[1]).toMatchObject({
      eventType: "pageview",
      path: "/events/event",
      sessionId: id,
    });
  });
  it("counts only visible public pages, including when returning from an operator route", () => {
    const session = createAnalyticsSession(id, "");
    session.visit(new URL("https://evryvibe.com/"), 0, time, true);
    expect(session.visibility(false, 1000, time)[0]).toMatchObject({
      properties: { engagementMs: 1000 },
    });
    expect(session.flush(5000, time)).toEqual([]);
    session.visibility(true, 5000, time);
    expect(
      session.visit(
        new URL("https://evryvibe.com/ops/sources"),
        6000,
        time,
        true,
      ),
    ).toHaveLength(1);
    expect(session.interaction("click", time)).toEqual([]);
    expect(session.flush(8000, time)).toEqual([]);
    expect(
      session.visit(new URL("https://evryvibe.com/"), 9000, time, true)[0],
    ).toMatchObject({ eventType: "pageview" });
  });
  it("defers background-tab pageviews until visible and counts activation once", () => {
    const session = createAnalyticsSession(id, "");
    const url = new URL("https://evryvibe.com/events/event");
    expect(session.visit(url, 0, time, false)).toEqual([]);
    expect(session.visibility(false, 5000, time)).toEqual([]);
    expect(session.interaction("click", time)).toEqual([]);
    expect(session.flush(10000, time)).toEqual([]);
    expect(session.visibility(true, 10000, time)).toEqual([
      {
        ...event,
        path: "/events/event",
        attribution: { landingPath: "/events/event", landingReferrer: "" },
      },
    ]);
    // A prerender activation/pageshow commit may repeat the committed URL.
    expect(session.visit(url, 10000, time, true)).toEqual([]);
    expect(session.visibility(true, 10000, time)).toEqual([]);
    expect(session.flush(11000, time)[0]).toMatchObject({
      properties: { engagementMs: 1000 },
    });
  });
  it("records only the latest hidden SPA route when it becomes visible", () => {
    const session = createAnalyticsSession(id, "");
    expect(
      session.visit(new URL("https://evryvibe.com/"), 0, time, false),
    ).toEqual([]);
    expect(
      session.visit(
        new URL("https://evryvibe.com/cities/berlin"),
        1000,
        time,
        false,
      ),
    ).toEqual([]);
    expect(
      session.visit(
        new URL("https://evryvibe.com/events/event"),
        2000,
        time,
        false,
      ),
    ).toEqual([]);
    expect(session.visibility(true, 3000, time)).toEqual([
      {
        ...event,
        path: "/events/event",
        attribution: { landingPath: "/events/event", landingReferrer: "" },
      },
    ]);
    expect(session.visibility(false, 4000, time)[0]).toMatchObject({
      eventType: "engagement",
      path: "/events/event",
    });
    expect(
      session.visit(
        new URL("https://evryvibe.com/cities/berlin"),
        5000,
        time,
        false,
      ),
    ).toEqual([]);
    expect(session.visibility(true, 6000, time)[0]).toMatchObject({
      eventType: "pageview",
      path: "/cities/berlin",
    });
    expect(
      session.visit(
        new URL("https://evryvibe.com/cities/berlin"),
        6000,
        time,
        true,
      ),
    ).toEqual([]);
    expect(session.visibility(true, 6000, time)).toEqual([]);
  });
  it("bounds engagement increments after a stalled foreground timer", () => {
    const session = createAnalyticsSession(id, "");
    session.visit(new URL("https://evryvibe.com/"), 0, time, true);
    expect(
      session
        .flush(600001, time)
        .map((entry) =>
          entry.eventType === "engagement" ? entry.properties.engagementMs : 0,
        ),
    ).toEqual([300000, 300000, 1]);
  });
});

describe("first-party collector proxy", () => {
  const fetcher = vi.fn();
  beforeEach(() => {
    vi.stubEnv("EVRYVIBE_DEMO", "0");
    vi.stubEnv(
      "MINILYTICS_COLLECTOR_URL",
      "https://analytics.magnusohle.de/api/collect",
    );
    vi.stubEnv("MINILYTICS_SITE_ID", "evryvibe-site");
    vi.stubEnv("MINILYTICS_SITE_SECRET", "server-secret");
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
  });
  it("authenticates server network assignment and strips identities, queries and referrer paths", async () => {
    expect(
      (
        await POST(
          request(
            {
              ...event,
              path: "/cities/berlin?q=private",
              visitorId: "legacy",
              arbitrary: "secret",
            },
            {
              "x-minilytics-secret": "spoofed",
              "x-minilytics-client-ip": "192.0.2.77",
            },
          ),
        )
      ).status,
    ).toBe(204);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://analytics.magnusohle.de/api/collect");
    expect(options.headers).toMatchObject({
      "x-minilytics-secret": "server-secret",
      "x-minilytics-client-ip": "203.0.113.4",
      "x-minilytics-user-agent": "Mozilla/5.0",
      "x-minilytics-session-mode": "network",
    });
    expect(JSON.parse(options.body)).toEqual({
      ...event,
      attribution: { landingPath: "/", landingReferrer: "https://example.com" },
    });
  });
  const excludedHeaders: Record<string, string>[] = [
    { dnt: "1" },
    { "sec-gpc": "1" },
    { "user-agent": "Googlebot" },
    { purpose: "prefetch" },
  ];
  it.each(excludedHeaders)("skips excluded requests %s", async (headers) => {
    expect((await POST(request(event, headers))).status).toBe(204);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [event, { origin: "https://attacker.example" }, 403],
    [{ ...event, path: "/ops/sources" }, {}, 400],
    ["invalid JSON", {}, 400],
    [event, { "content-type": "text/plain" }, 415],
    [" ".repeat(16385), {}, 413],
    [event, { "x-real-ip": "spoofed" }, 400],
  ] as const)("rejects invalid requests", async (payload, headers, status) => {
    expect((await POST(request(payload, headers))).status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns a bounded failure without collector details", async () => {
    fetcher.mockRejectedValue(new Error("private internal endpoint"));
    const result = await POST(request());
    expect(result.status).toBe(502);
    expect(await result.text()).toBe("");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it("stays disabled without configuration or in demo", async () => {
    vi.stubEnv("MINILYTICS_SITE_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("MINILYTICS_SITE_SECRET", "secret");
    vi.stubEnv("EVRYVIBE_DEMO", "1");
    expect((await POST(request())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect(GET().status).toBe(405);
  });
  it("scrubs outbound link parameters and refuses unsupported protocols", () => {
    expect(
      analyticsEventSchema.parse({
        ...event,
        eventType: "outbound",
        targetUrl: "https://tickets.example/event?token=secret#person",
      }),
    ).toMatchObject({ targetUrl: "https://tickets.example/event" });
    expect(
      analyticsEventSchema.safeParse({
        ...event,
        eventType: "outbound",
        targetUrl: "mailto:private@example.com",
      }).success,
    ).toBe(false);
  });
});
