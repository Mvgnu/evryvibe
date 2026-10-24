// Dynamic server pages render once per request and take one clock snapshot
// for every date decision on the page (upcoming, today, weekend), so all of
// them agree. Client components receive dates as props, never read the clock.
export function requestTime(): number {
  return Date.now();
}
