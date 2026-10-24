import { afterEach, expect, it, vi } from "vitest";
import postgres from "postgres";
import { databaseReady } from "../src/db/readiness";

const { query, end } = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock("postgres", () => ({
  default: vi.fn(() => Object.assign(query, { end })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("does not report readiness without a real database or in demo mode", async () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(await databaseReady()).toBe(false);
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("EVRYVIBE_DEMO", "1");
  expect(await databaseReady()).toBe(false);
  expect(postgres).not.toHaveBeenCalled();
});

it.each([true, false])(
  "closes the probe after database success=%s",
  async (success) => {
    vi.stubEnv("DATABASE_URL", "postgres://unused");
    vi.stubEnv("EVRYVIBE_DEMO", "0");
    if (success) query.mockResolvedValue([]);
    else query.mockRejectedValue(new Error("missing schema or denied access"));
    expect(await databaseReady()).toBe(success);
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
  },
);

it("bounds a stalled database probe and destroys its connection", async () => {
  vi.useFakeTimers();
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("EVRYVIBE_DEMO", "0");
  query.mockReturnValue(new Promise(() => {}));
  const pending = databaseReady();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBe(false);
  expect(end).toHaveBeenCalledWith({ timeout: 0 });
  expect(vi.getTimerCount()).toBe(0);
});
