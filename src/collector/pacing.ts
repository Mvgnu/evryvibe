export const collectionDefaults = {
  sourceDelayMs: 10_000,
  postDelayMs: 5_000,
  cooldownMs: 24 * 60 * 60_000,
};
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class InstagramAccessError extends Error {}

export function checkInstagramResponse(status: number) {
  if (status === 429 || status === 401 || status === 403)
    throw new InstagramAccessError(
      `Instagram access restricted (HTTP ${status}); collection paused for 24 hours`,
    );
}

const berlinClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function berlinDateAndMinute(at: Date) {
  const parts = Object.fromEntries(
    berlinClock.formatToParts(at).map(({ type, value }) => [type, value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** A stable 6–10 hour Berlin daytime break, centered on 12:30 local time. */
export function dailyRestWindow(at: Date): {
  date: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
} {
  const { date } = berlinDateAndMinute(at);
  let hash = 2166136261;
  for (const character of date) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // Even-minute duration keeps both boundaries on a whole minute.
  const durationMinutes = 360 + 2 * ((hash >>> 0) % 121);
  const startMinutes = 12 * 60 + 30 - durationMinutes / 2;
  return {
    date,
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
    durationMinutes,
  };
}

export function isDailyRest(at: Date): boolean {
  const { minute } = berlinDateAndMinute(at);
  const window = dailyRestWindow(at);
  return minute >= window.startMinutes && minute < window.endMinutes;
}

export class DailyRestError extends Error {
  constructor() {
    super("Daily Berlin daytime rest window started; collection paused");
  }
}

export function assertOutsideDailyRest(at: Date): void {
  if (isDailyRest(at)) throw new DailyRestError();
}
