"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createAnalyticsSession } from "@/analytics/runtime";
import type { AnalyticsEvent } from "@/analytics/event";

function isPrerendering(): boolean {
  return "prerendering" in document && document.prerendering === true;
}
function privacyAllowed(): boolean {
  return (
    navigator.doNotTrack !== "1" &&
    !(
      "globalPrivacyControl" in navigator &&
      navigator.globalPrivacyControl === true
    )
  );
}
function send(events: readonly AnalyticsEvent[]) {
  if (!privacyAllowed()) return;
  for (const event of events) {
    const body = JSON.stringify(event);
    if (
      navigator.sendBeacon?.(
        "/api/minilytics",
        new Blob([body], { type: "application/json" }),
      )
    )
      continue;
    void fetch("/api/minilytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  }
}

export function MinilyticsAnalytics() {
  const pathname = usePathname();
  const runtime = useRef<ReturnType<typeof createAnalyticsSession> | null>(
    null,
  );
  const committedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!privacyAllowed()) return;
    runtime.current ??= createAnalyticsSession(
      crypto.randomUUID(),
      document.referrer,
    );
    const session = runtime.current;
    let suspended = false;
    const isVisible = () =>
      !suspended && document.visibilityState === "visible";
    const commit = () => {
      if (
        isPrerendering() ||
        !privacyAllowed() ||
        committedUrl.current === null
      )
        return;
      send(
        session.visit(
          new URL(committedUrl.current),
          performance.now(),
          new Date().toISOString(),
          isVisible(),
        ),
      );
    };
    const visibility = () => {
      send(
        session.visibility(
          isVisible() && !isPrerendering() && privacyAllowed(),
          performance.now(),
          new Date().toISOString(),
        ),
      );
    };
    const pagehide = () => {
      suspended = true;
      visibility();
    };
    const pageshow = () => {
      suspended = false;
      commit();
      visibility();
    };
    const click = (event: MouseEvent) => {
      if (suspended || isPrerendering()) return;
      const element =
        event.target instanceof Element
          ? event.target.closest("a, button, [data-minilytics]")
          : null;
      if (element === null) return;
      if (
        element instanceof HTMLButtonElement &&
        element.type === "submit" &&
        element.form
      )
        return;
      let targetUrl: string | undefined;
      let outbound = false;
      if (element instanceof HTMLAnchorElement) {
        const url = new URL(element.href);
        if (["https:", "http:"].includes(url.protocol)) {
          targetUrl = `${url.origin}${url.pathname}`;
          outbound = url.origin !== window.location.origin;
        }
      }
      send(
        session.interaction(
          outbound ? "outbound" : "click",
          new Date().toISOString(),
          targetUrl,
          element.getAttribute("data-minilytics")?.slice(0, 100) || undefined,
        ),
      );
    };
    const submit = (event: SubmitEvent) => {
      if (
        suspended ||
        isPrerendering() ||
        !(event.target instanceof HTMLFormElement)
      )
        return;
      const url = new URL(event.target.action);
      send(
        session.interaction(
          "form_submit",
          new Date().toISOString(),
          `${url.origin}${url.pathname}`,
        ),
      );
    };
    const timer = setInterval(() => {
      if (isPrerendering() || suspended) return;
      visibility();
    }, 15_000);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("prerenderingchange", commit);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    commit();
    if (!isPrerendering()) visibility();
    return () => {
      clearInterval(timer);
      send(
        session.visibility(false, performance.now(), new Date().toISOString()),
      );
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("prerenderingchange", commit);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    };
  }, []);
  useEffect(() => {
    committedUrl.current = window.location.href;
    if (!isPrerendering() && privacyAllowed()) {
      send(
        runtime.current?.visit(
          new URL(committedUrl.current),
          performance.now(),
          new Date().toISOString(),
          document.visibilityState === "visible",
        ) ?? [],
      );
    }
  }, [pathname]);
  return null;
}
