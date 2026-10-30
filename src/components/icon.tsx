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
    | "wave"
    | "heart"
    | "skip"
    | "pause"
    | "expand"
    | "locate"
    | "thumb-down"
    | "globe";
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
    heart:
      "M12 20.5S3.5 15.3 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6c0 6.1-8.5 11.3-8.5 11.3Z",
    skip: "M5 5v14l10-7Zm14 0v14",
    pause: "M7 5h3.5v14H7zm6.5 0H17v14h-3.5z",
    expand: "M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5",
    locate: "M12 2v3m0 14v3M2 12h3m14 0h3",
    globe:
      "M3 12h18M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3Z",
    "thumb-down":
      "M7 13V4H4v9h3Zm0 0 4.5 7a2 2 0 0 0 2.4-2.6L13 14h5.4a2 2 0 0 0 2-2.4l-1.3-6A2 2 0 0 0 17.2 4H7",
  };
  return (
    <svg
      className={`ui-icon ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill={
        name === "play" || name === "skip" || name === "pause"
          ? "currentColor"
          : "none"
      }
      stroke="currentColor"
      strokeWidth={name === "asterisk" ? 2.5 : name === "wave" ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
      {name === "sun" && <circle cx="12" cy="12" r="4" />}
      {(name === "locate" || name === "globe") && (
        <circle cx="12" cy="12" r={name === "globe" ? 9 : 6} />
      )}
      {name === "settings" && (
        <>
          <circle cx="12" cy="7" r="2" />
          <circle cx="12" cy="17" r="2" />
        </>
      )}
    </svg>
  );
}
