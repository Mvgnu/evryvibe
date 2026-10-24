/** Decorative interface icons: visible labels and button aria-labels carry meaning. */
export function Icon({
  name,
  className = "",
}: {
  name:
    | "arrow-up-right"
    | "arrow-down-left"
    | "arrow-left"
    | "arrow-down"
    | "sun"
    | "moon"
    | "asterisk"
    | "close"
    | "refresh"
    | "settings"
    | "search"
    | "calendar"
    | "chevron-down"
    | "play"
    | "wave";
  className?: string;
}) {
  const paths = {
    "arrow-up-right": "M5 19 19 5M5 5h14v14",
    "arrow-down-left": "M19 5 5 19M5 5v14h14",
    "arrow-left": "M20 12H4m7-7-7 7 7 7",
    "arrow-down": "M12 4v16m-7-7 7 7 7-7",
    sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
    moon: "M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a8.5 8.5 0 1 0 9.7 9.7Z",
    asterisk: "M12 2v20M2 12h20M5 5l14 14M5 19 19 5",
    refresh: "M20 7v5h-5m4.5-1A8 8 0 1 0 20 15",
    close: "m6 6 12 12M6 18 18 6",
    settings: "M4 7h6m4 0h6M4 17h6m4 0h6",
    search: "m20 20-4.6-4.6M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4m8-4v4",
    "chevron-down": "m6 9 6 6 6-6",
    play: "M7 4.5v15L19 12Z",
    wave: "M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4",
  };
  return (
    <svg
      className={`ui-icon ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={name === "asterisk" ? 2.5 : name === "wave" ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
      {name === "sun" && <circle cx="12" cy="12" r="4" />}
      {name === "settings" && (
        <>
          <circle cx="12" cy="7" r="2" />
          <circle cx="12" cy="17" r="2" />
        </>
      )}
    </svg>
  );
}
