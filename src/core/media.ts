import { z } from "zod";

/** Source identity, never an expiring Instagram CDN URL. */
export const mediaIdSchema = z
  .string()
  .regex(
    /^ig:(?:story:\d+|[A-Za-z0-9_-]+):slide:(?:[1-9]|1[0-9]|20):(?:image|frame:(?:0|[1-9]\d*)(?:\.\d{1,6})?)$/,
    "Expected an Instagram media ID from a source package",
  );

export function instagramMediaId(
  sourceUrl: string,
  slide: number,
  second?: number,
): string {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/");
  const identity = parts[1] === "stories" ? `story:${parts[3]}` : parts[2];
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.instagram.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !/^\/(?:p\/[A-Za-z0-9_-]+|reel\/[A-Za-z0-9_-]+|stories\/[A-Za-z0-9_.]+\/\d+)\/$/.test(
      url.pathname,
    )
  )
    throw new Error("Media ID requires an Instagram source permalink");
  if (second !== undefined && (!Number.isFinite(second) || second < 0))
    throw new Error("Frame seconds must be finite and nonnegative");
  return mediaIdSchema.parse(
    `ig:${identity}:slide:${slide}:${second === undefined ? "image" : `frame:${Number(second.toFixed(6))}`}`,
  );
}

/** Label legacy OCR when its slide/frame provenance was captured explicitly. */
export function labelOcrMediaIds(sourceUrl: string, text: string): string {
  return text.replace(/^\[([^\]\n]+)\]/gm, (label: string, content: string) => {
    if (content.includes("media ID ")) return label;
    const imageSlide = /carousel slide (\d+)/.exec(content);
    const videoSlide =
      /Post slide (\d+): Video sampled frame at ([\d.]+)s/.exec(content);
    const storyFrame = /Story \d+: Video sampled frame at ([\d.]+)s/.exec(
      content,
    );
    const storyImage = /^Story \d+: (?:video poster|still image)$/.test(
      content,
    );
    const slide = imageSlide?.[1] ?? videoSlide?.[1];
    if (slide && (Number(slide) < 1 || Number(slide) > 20)) return label;
    const second = videoSlide?.[2] ?? storyFrame?.[1];
    if (second && !Number.isFinite(Number(second))) return label;
    let id: string;
    if (imageSlide) id = instagramMediaId(sourceUrl, Number(imageSlide[1]));
    else if (videoSlide)
      id = instagramMediaId(
        sourceUrl,
        Number(videoSlide[1]),
        Number(videoSlide[2]),
      );
    else if (storyFrame)
      id = instagramMediaId(sourceUrl, 1, Number(storyFrame[1]));
    else if (storyImage) id = instagramMediaId(sourceUrl, 1);
    else return label;
    return `[${content}; media ID ${id}]`;
  });
}

/** True for a public post/reel permalink, the only source a cover may come from. */
export function isPublicPostUrl(url: string | null): boolean {
  return (
    url !== null &&
    /^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url)
  );
}
