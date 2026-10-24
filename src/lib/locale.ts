import { headers } from "next/headers";
import type { Locale } from "@/core/i18n";

// The proxy overwrites this header from the URL, never from user preferences.
export async function requestLocale(): Promise<Locale> {
  return (await headers()).get("x-evryvibe-locale") === "en" ? "en" : "de";
}
