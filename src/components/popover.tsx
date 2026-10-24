"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A <details> disclosure that also closes on Escape and on a click outside.
// Without JavaScript it is an ordinary disclosure.
export function Popover({
  className,
  summary,
  summaryClassName,
  children,
}: {
  className?: string;
  summary: ReactNode;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(event: Event) {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (event.target instanceof Node && !details.contains(event.target))
        details.open = false;
    }
    document.addEventListener("keydown", close);
    document.addEventListener("click", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("click", close);
    };
  }, []);
  return (
    <details ref={ref} className={className}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
