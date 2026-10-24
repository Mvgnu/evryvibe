import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { isDailyRest } from "../src/collector/pacing";

// A run owns one process group. If it stalls or reaches the daily rest window,
// terminate that entire group so Chromium cannot outlive its collector.
const mode = process.argv[2];
if (mode !== "collect" && mode !== "covers")
  throw new Error("Usage: supervise-instagram.ts <collect|covers> [args]");

const script =
  mode === "collect"
    ? "scripts/collect.ts"
    : "scripts/refresh-instagram-covers.ts";
const args = process.argv.slice(3);
const child = spawn(
  process.execPath,
  ["--import", "tsx", resolve(script), ...args],
  { detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env },
);
let lastProgress = Date.now();
let stopping: "rest" | "stalled" | "signal" | null = null;
let killTimer: ReturnType<typeof setTimeout> | null = null;

const progressLine =
  /^\[collector\] .+: (?:source capture |stories capture |story \d+\/|post \d+\/|profile grid selected)|^\[cover refresh\] source \d+\/\d+ (?:started|complete)/;
for (const [stream, output] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
] as const) {
  let lineBuffer = "";
  stream?.on("data", (chunk: Buffer) => {
    output.write(chunk);
    lineBuffer += chunk.toString("utf8");
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop()?.slice(-4096) ?? "";
    if (lines.some((line) => progressLine.test(line)))
      lastProgress = Date.now();
  });
}

function stop(reason: "rest" | "stalled" | "signal") {
  if (stopping) return;
  stopping = reason;
  if (reason === "stalled")
    console.error(
      "[worker] No collector progress for 20 minutes; stopping its process group",
    );
  if (reason === "rest")
    console.error(
      "[worker] Daily Instagram rest started; stopping its process group",
    );
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // The process group has already exited.
    }
  }
  killTimer = setTimeout(() => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process group has already exited.
      }
    }
  }, 30_000);
}

const watchdog = setInterval(() => {
  if (isDailyRest(new Date())) stop("rest");
  else if (Date.now() - lastProgress > 20 * 60_000) stop("stalled");
}, 15_000);
process.on("SIGTERM", () => stop("signal"));
process.on("SIGINT", () => stop("signal"));
child.on("error", (error) => {
  console.error(`[worker] Could not start ${mode}: ${error.message}`);
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearInterval(watchdog);
  if (killTimer) clearTimeout(killTimer);
  process.exitCode = stopping === "rest" ? 0 : stopping ? 1 : (code ?? 1);
});
