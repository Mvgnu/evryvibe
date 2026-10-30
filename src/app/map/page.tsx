import { redirect } from "next/navigation";
import { localizePath } from "@/core/i18n";
import { requestLocale } from "@/lib/locale";

// The map is no longer a separate preview: it is the discovery page itself.
// Old /map links open it full screen with the same filters.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [locale, params] = await Promise.all([requestLocale(), searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const entry of Array.isArray(value) ? value : value ? [value] : [])
      query.append(key, entry);
  const search = query.toString();
  redirect(`${localizePath("/", locale)}${search ? `?${search}` : ""}#karte`);
}
