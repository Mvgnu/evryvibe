import { instagramMediaId } from "../core/media";
import type { Locator } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recognizeImage } from "./media";

export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("Video duration is unavailable");
  const end = Math.max(0, duration - Math.min(0.15, duration / 10));
  return [
    ...new Set(
      [0, 1, 2, duration / 2, end].map((time) =>
        Number(Math.min(end, time).toFixed(6)),
      ),
    ),
  ].sort((a, b) => a - b);
}

/** Reject retained carousel slides and recommendations outside the source scope. */
export async function activeVideoLocators(scope: Locator): Promise<Locator[]> {
  const active: Locator[] = [];
  for (const video of await scope.locator("video").all()) {
    if (
      await video.evaluate((element) => {
        if (!(element instanceof HTMLVideoElement) || element.closest("header"))
          return false;
        const box = element.getBoundingClientRect();
        let left = Math.max(box.left, 0),
          right = Math.min(box.right, window.innerWidth),
          top = box.top,
          bottom = box.bottom;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent),
            clip = parent.getBoundingClientRect();
          if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        return right - left >= 200 && bottom - top >= 200;
      })
    )
      active.push(video);
  }
  return active;
}

/** Only rendered screenshots leave the browser; video/audio is never saved. */
export async function sampleVideoFrames(
  video: Locator,
  options: {
    sourceUrl: string;
    label: string;
    slide?: number;
    assertSource: () => Promise<void>;
    onFrame?: (
      framePath: string,
      second: number,
      ocrText: string,
    ) => Promise<void>;
  },
): Promise<string[]> {
  await options.assertSource();
  const metadata = await video.evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement))
      throw new Error("Expected scoped video");
    const deadline = Date.now() + 10000;
    element.muted = true;
    while (
      (!Number.isFinite(element.duration) || element.readyState < 2) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    element.pause();
    return {
      duration: element.duration,
      src: element.currentSrc || element.src,
    };
  });
  if (!metadata.src) throw new Error("Video source is unavailable");
  const times = videoSampleTimes(metadata.duration);
  const temporary = await mkdtemp(join(tmpdir(), "evryvibe-video-"));
  const pieces: string[] = [];
  try {
    for (const [index, time] of times.entries()) {
      await options.assertSource();
      await video.evaluate(
        async (element, { time, source }) => {
          if (!(element instanceof HTMLVideoElement))
            throw new Error("Expected scoped video");
          if ((element.currentSrc || element.src) !== source)
            throw new Error("Video source changed while sampling");
          const box = element.getBoundingClientRect();
          let left = Math.max(box.left, 0),
            right = Math.min(box.right, innerWidth),
            top = box.top,
            bottom = box.bottom;
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent),
              clip = parent.getBoundingClientRect();
            if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
            if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
              top = Math.max(top, clip.top);
              bottom = Math.min(bottom, clip.bottom);
            }
          }
          if (right - left < 200 || bottom - top < 200)
            throw new Error("Video left the active source slide");
          // A media request can temporarily leave the player at its previous
          // frame. Re-issue one bounded seek before treating the clip as broken.
          for (const waitMs of [10000, 5000]) {
            element.pause();
            element.currentTime = time;
            const deadline = Date.now() + waitMs;
            while (
              (element.seeking ||
                element.readyState < 2 ||
                Math.abs(element.currentTime - time) > 0.05) &&
              !element.error &&
              Date.now() < deadline
            )
              await new Promise((resolve) => setTimeout(resolve, 50));
            if (
              !element.seeking &&
              element.readyState >= 2 &&
              Math.abs(element.currentTime - time) <= 0.05
            )
              break;
            if (element.error) break;
          }
          if (
            element.seeking ||
            element.readyState < 2 ||
            Math.abs(element.currentTime - time) > 0.05
          )
            throw new Error(
              `Video frame seek failed at ${time.toFixed(2)}s (current ${element.currentTime.toFixed(2)}s, readyState ${element.readyState}, seeking ${element.seeking}, mediaError ${element.error?.code ?? "none"})`,
            );
          // Allow the compositor to display the seeked frame before screenshot.
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Video frame presentation timed out")),
              2000,
            );
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(timeout);
                resolve();
              }),
            );
          });
          if ((element.currentSrc || element.src) !== source)
            throw new Error("Video source changed while sampling");
        },
        { time, source: metadata.src },
      );
      await options.assertSource();
      const frame = join(temporary, `frame-${index}.png`);
      await video.screenshot({ path: frame, timeout: 10000 });
      await video.evaluate(
        (element, { time, source }) => {
          if (
            !(element instanceof HTMLVideoElement) ||
            (element.currentSrc || element.src) !== source ||
            Math.abs(element.currentTime - time) > 0.05
          )
            throw new Error(
              "Video changed before the sampled frame was captured",
            );
        },
        { time, source: metadata.src },
      );
      await options.assertSource();
      const text = await recognizeImage(frame);
      await options.assertSource();
      if (options.onFrame) await options.onFrame(frame, time, text);
      await options.assertSource();
      pieces.push(
        `[${options.label}: Video sampled frame at ${time.toFixed(2)}s of ${metadata.duration.toFixed(2)}s; media ID ${instagramMediaId(options.sourceUrl, options.slide ?? 1, time)}; source ${options.sourceUrl}; representative frames only, not complete video transcription]\n${text}`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return pieces;
}
