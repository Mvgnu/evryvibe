"use client";
import { useEffect } from "react";

/**
 * After "Weitere DJs anzeigen" the link carries `#dj-<slug>` of the first new
 * row, but a soft navigation neither scrolls nor moves focus, so the next Tab
 * would skip every new row. This focuses that row's name link whenever the
 * number of shown rows changes (and on a full load with the hash). Without
 * JavaScript the browser's own hash scrolling lands on the row.
 */
export function FocusRow({ shown }: { shown: number }) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id.startsWith("dj-")) return;
    const link = document
      .getElementById(id)
      ?.querySelector<HTMLAnchorElement>(".dj-row-name a");
    link?.focus();
  }, [shown]);
  return null;
}
