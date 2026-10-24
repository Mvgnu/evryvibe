import Link from "next/link";
import type { ReactNode } from "react";

// A filter or navigation chip. Chips are plain links, so choosing one applies
// immediately and works without JavaScript; scroll position is kept.
export function Chip({
  href,
  label,
  count,
  active = false,
  current = "true",
  swatch,
  ariaLabel,
}: {
  href: string;
  label: string;
  count?: number;
  active?: boolean;
  // "page" for navigation to another page, "true" for a chosen filter.
  current?: "true" | "page";
  // Sound family whose poster accent marks the chip.
  swatch?: string;
  ariaLabel?: string;
}) {
  return (
    <li>
      <Link
        className="chip"
        href={href}
        scroll={false}
        aria-current={active ? current : undefined}
        aria-label={ariaLabel}
      >
        {swatch && <span className={`chip-swatch fam-${swatch}`} />}
        {label}
        {count !== undefined && (
          <>
            {" "}
            <span className="chip-count">{count}</span>
          </>
        )}
      </Link>
    </li>
  );
}

// One labelled row of chips that scrolls sideways instead of wrapping.
export function ChipRow({
  id,
  label,
  children,
  before,
  as = "group",
}: {
  id: string;
  label: string;
  children: ReactNode;
  before?: ReactNode;
  // "nav" when the chips lead to other pages (city months, other cities).
  as?: "group" | "nav";
}) {
  const body = (
    <>
      <span className="filter-label" id={id}>
        {label}
      </span>
      {before}
      <ul className="chip-scroll">{children}</ul>
    </>
  );
  return as === "nav" ? (
    <nav
      className={`filter-row${before ? " has-before" : ""}`}
      aria-labelledby={id}
    >
      {body}
    </nav>
  ) : (
    <div
      className={`filter-row${before ? " has-before" : ""}`}
      role="group"
      aria-labelledby={id}
    >
      {body}
    </div>
  );
}
