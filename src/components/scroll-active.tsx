"use client";

import { useEffect } from "react";

// Brings the chosen chip of every sideways chip row into view after each
// filter change, so a phone never hides the active choice off-screen.
// Purely an enhancement: without JavaScript the rows simply start at 0.
export function ScrollActiveChips({ state }: { state: string }) {
  useEffect(() => {
    for (const row of document.querySelectorAll<HTMLElement>(".chip-scroll")) {
      const active = row.querySelector<HTMLElement>("[aria-current]");
      if (!active) continue;
      const item = active.closest("li") ?? active;
      const left = item.offsetLeft - row.offsetLeft;
      const right = left + item.offsetWidth;
      if (left < row.scrollLeft || right > row.scrollLeft + row.clientWidth)
        row.scrollLeft = Math.max(0, left - 8);
    }
  }, [state]);
  return null;
}
