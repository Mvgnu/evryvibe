import {
  MAX_ENGAGEMENT_MS,
  publicPath,
  referrerOrigin,
  type AnalyticsEvent,
} from "./event";

/** One running document, no cookies, localStorage or sessionStorage. */
export function createAnalyticsSession(id: string, referrer: string) {
  let currentPath: string | null = null;
  let lastPath: string | null = null;
  let landingPath: string | null = null;
  let activeSince: number | null = null;
  let pageviewSent = false;
  const landingReferrer = referrerOrigin(referrer);
  function common(occurredAt: string) {
    if (currentPath === null || landingPath === null) return null;
    return {
      sessionId: id,
      runtimeSession: "memory-v1" as const,
      path: currentPath,
      occurredAt,
      attribution: { landingPath, landingReferrer },
    };
  }
  function activate(now: number, occurredAt: string): AnalyticsEvent[] {
    if (currentPath === null || pageviewSent) return [];
    landingPath ??= currentPath;
    pageviewSent = true;
    activeSince = now;
    const fields = common(occurredAt);
    return fields === null ? [] : [{ ...fields, eventType: "pageview" }];
  }
  function flush(now: number, occurredAt: string): AnalyticsEvent[] {
    const fields = common(occurredAt);
    if (activeSince === null || fields === null) return [];
    let elapsed = Math.floor(Math.max(0, now - activeSince));
    activeSince = now;
    const events: AnalyticsEvent[] = [];
    while (elapsed > 0) {
      const engagementMs = Math.min(elapsed, MAX_ENGAGEMENT_MS);
      events.push({
        ...fields,
        eventType: "engagement",
        properties: { engagementMs },
      });
      elapsed -= engagementMs;
    }
    return events;
  }
  return {
    visit(
      url: URL,
      now: number,
      occurredAt: string,
      visible: boolean,
    ): AnalyticsEvent[] {
      if (lastPath === url.pathname)
        return visible ? activate(now, occurredAt) : [];
      const events = flush(now, occurredAt);
      lastPath = url.pathname;
      currentPath = publicPath(url.pathname);
      pageviewSent = false;
      activeSince = null;
      if (visible) events.push(...activate(now, occurredAt));
      return events;
    },
    visibility(
      visible: boolean,
      now: number,
      occurredAt: string,
    ): AnalyticsEvent[] {
      const events = flush(now, occurredAt);
      if (visible) events.push(...activate(now, occurredAt));
      activeSince =
        visible && currentPath !== null && pageviewSent ? now : null;
      return events;
    },
    interaction(
      eventType: "click" | "outbound" | "form_submit",
      occurredAt: string,
      targetUrl?: string,
      targetLabel?: string,
    ): AnalyticsEvent[] {
      const fields = common(occurredAt);
      return fields === null || !pageviewSent || activeSince === null
        ? []
        : [{ ...fields, eventType, targetUrl, targetLabel }];
    },
    flush,
  };
}
