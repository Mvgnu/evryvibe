// Optional fixture regeneration only: requires ffmpeg, not used by tests/runtime.
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "evryvibe-video-fixture-"));
const output = fileURLToPath(new URL(".", import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 640, height: 360 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<main style="position:fixed;inset:0;background:white;color:black;display:flex;align-items:center;justify-content:center;text-align:center;font:bold 40px Arial;line-height:1.5">FRIDAY 25 SEPTEMBER<br>DJ ALPHA<br>DOORS 23:00</main>',
  );
  const flyer = join(temporary, "flyer.png");
  await page.screenshot({ path: flyer });
  await execute("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    flyer,
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=640x360:r=10:d=5",
    "-filter_complex",
    "[1:v]drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='lt(t,0.45)',drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='between(t,0.45,0.9)'[base];[base][0:v]overlay=enable='between(t,0.9,2.4)':shortest=1[out]",
    "-map",
    "[out]",
    "-t",
    "5",
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "32",
    "-b:v",
    "0",
    "-pix_fmt",
    "yuv420p",
    join(output, "intro-flyer.webm"),
  ]);
  await execute("ffmpeg", [
    "-y",
    "-i",
    join(output, "intro-flyer.webm"),
    "-t",
    "0.4",
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "40",
    "-b:v",
    "0",
    join(output, "short.webm"),
  ]);
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
