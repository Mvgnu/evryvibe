import { instagramCdnImageUrlSchema } from "../core/model";

function attr(tag: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x26;", "&")
    .replaceAll("&quot;", '"');
}

export function imagesFromEmbed(
  html: string,
): { url: string; slide: number }[] {
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of images) {
    const css = attr(tag, "class") ?? "";
    const raw = attr(tag, "src");
    // Native embed HTML also contains unrelated hover-card photos. Only its
    // explicitly tagged media frame can be associated with the source post.
    if (!css.split(/\s+/).includes("EmbeddedMediaImage") || !raw) continue;
    const url = decodeHtml(raw);
    if (!instagramCdnImageUrlSchema.safeParse(url).success) continue;
    return [{ url, slide: 1 }];
  }
  return [];
}

export function coverFromEmbed(html: string): string | null {
  return imagesFromEmbed(html)[0]?.url ?? null;
}
