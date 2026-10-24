import { z } from "zod";
import { instagramPostSchema, instagramProfileSchema } from "../core/model";

const userSchema = z.object({ username: z.string() });
const identitySchema = z.object({
  code: z.string().optional(),
  shortcode: z.string().optional(),
  user: userSchema.nullish(),
  owner: userSchema.nullish(),
  coauthor_producers: z.array(userSchema).nullish(),
});
const captionSchema = z.object({ text: z.string() });
const edgeCaptionSchema = z.object({
  edges: z.array(z.object({ node: z.object({ text: z.string() }) })),
});

const shortcode = (url: string) =>
  new URL(instagramPostSchema.parse(url)).pathname.split("/")[2];
const handle = (url: string) =>
  new URL(instagramProfileSchema.parse(url)).pathname
    .replaceAll("/", "")
    .toLowerCase();

// Read only media records tied to this permalink and posting account. JSON
// comments, profile biography and recommendations cannot become captions.
export function captionFromDocuments(
  documents: unknown[],
  postUrl: string,
  accountUrl: string,
): string | null {
  const code = shortcode(postUrl);
  const account = handle(accountUrl);
  const captions = new Set<string>();
  const visited = new Set<object>();
  const stack = [...documents];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    const identity = identitySchema.safeParse(node);
    if (identity.success) {
      const ids = [identity.data.code, identity.data.shortcode].filter(
        (value): value is string => value !== undefined,
      );
      const authors = [
        identity.data.user,
        identity.data.owner,
        ...(identity.data.coauthor_producers ?? []),
      ];
      if (
        ids.length &&
        ids.every((value) => value === code) &&
        authors.some((author) => author?.username.toLowerCase() === account)
      ) {
        if ("caption" in node) {
          if (node.caption === null) captions.add("");
          else {
            const caption = captionSchema.safeParse(node.caption);
            if (caption.success) captions.add(caption.data.text);
          }
        }
        if ("edge_media_to_caption" in node) {
          const edge = edgeCaptionSchema.safeParse(node.edge_media_to_caption);
          if (edge.success) {
            if (edge.data.edges.length === 0) captions.add("");
            for (const item of edge.data.edges) captions.add(item.node.text);
          }
        }
      }
    }
    for (const child of Object.values(node))
      if (child && typeof child === "object") stack.push(child);
  }
  if (captions.size > 1) throw new Error("Ambiguous source post caption data");
  return captions.values().next().value ?? null;
}

export function captionFromMetadata(
  description: string | null,
  metaUrl: string | null,
  postUrl: string,
  accountUrl: string,
): string | null {
  let target: URL;
  try {
    target = new URL(metaUrl ?? "");
  } catch {
    return null;
  }
  const account = handle(accountUrl);
  const path =
    /^\/(?:(?<account>[A-Za-z0-9._]+)\/)?(?<kind>p|reel)\/(?<code>[A-Za-z0-9_-]+)\/?$/.exec(
      target.pathname,
    );
  if (
    !path?.groups ||
    (path.groups.account && path.groups.account.toLowerCase() !== account)
  )
    return null;
  target.pathname = `/${path.groups.kind}/${path.groups.code}/`;
  const source = instagramPostSchema.safeParse(target.href);
  if (!source.success || shortcode(source.data) !== shortcode(postUrl))
    return null;
  if (!description) return null;
  const start = description.indexOf(': "');
  if (start < 0) return null;
  const preamble = description.slice(0, start).toLowerCase();
  if (
    !preamble.startsWith(`${account} on `) &&
    !preamble.includes(` - ${account} on `)
  )
    return null;
  return description.slice(start + 2).match(/^"([\s\S]*)"\.?\s*$/)?.[1] ?? null;
}
