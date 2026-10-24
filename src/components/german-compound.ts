import type { Locale } from "@/core/i18n";

/**
 * A genre or sound name joined with a noun: German couples the whole compound
 * with hyphens ("Hard-Techno-DJs", "Drum-&-Bass-Partys", "UK-Garage-DJs"),
 * single words stay "Techno-DJs". English keeps the space ("Hard Techno DJs").
 */
export function compound(name: string, suffix: string, locale: Locale) {
  return locale === "en"
    ? `${name} ${suffix}`
    : `${name.trim().split(/\s+/).join("-")}-${suffix}`;
}
