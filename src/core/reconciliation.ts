// Agent-written artist descriptions drift into two failure modes: generic
// filler ("ist als DJ im Clubumfeld aktiv") and event notes written as a bio
// ("steht bei X im Line-up", "spielt von 2 bis 4 Uhr"). Neither belongs on a
// profile. Public pages show only the sentences that describe the artist; the
// reconciliation queue uses the same assessment to send the record back to an
// agent for a real rewrite or an honest empty description.

import type { Locale } from "./i18n";

export type DescriptionIssue = "description_filler" | "description_event_bound";

const months =
  "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|May|June|July|October|December";

const weekdays =
  "Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";

// A sentence that talks about one booking rather than the artist.
const eventBound: readonly RegExp[] = [
  // A concrete place on a bill ("im Line-up", "DJ-Line-up von"), not a venue
  // describing its programming ("präzise kuratierte Line-ups").
  /\b(im|in dem|auf dem|zum|zur|ins|auf)\s+(?:\S+\s+){0,3}line-?ups?\b/i,
  /-line-?ups?\b/i,
  /\b[Ll]ine-?ups?\s+(von|bei|beim)\s+[A-Z0-9]/,
  /\b(on|in|for) the (?:\S+\s+){0,2}line-?ups?\b/i,
  /\b(spielt|spielen|steht|stehen|legt|legen|tritt|treten)\b[^.]*?\b(am|bei|beim|im|auf der|auf dem|an den)\b[^.]*?\b(auf|im|in der|an den|am Pult|B2B|Line)\b/i,
  /\b(spielt|spielen|steht|stehen) (am|bei|beim)\b/i,
  // "steht gemeinsam mit X im Silbergold": a shared bill
  /\b(steht|stehen)\b[^.]*\b(gemeinsam|zusammen) mit\b/i,
  /\bb2b\b/i,
  // A time slot, but not a name such as "Slot Fighter".
  /\b(?:slot|SLOT)\b|\bSlot\b(?!\s+[A-Z])/,
  /\b\d{1,2}(:\d{2})?\s?(bis|–|-)\s?\d{1,2}(:\d{2})?\s?uhr\b/i,
  /\b\d{1,2}(:\d{2})?\s?uhr\b/i,
  /\bangekündigt\b/i,
  new RegExp(`\\b\\d{1,2}\\.\\s?(${months})\\b`, "i"),
  new RegExp(`\\b(${months}) 20\\d\\d\\b`, "i"),
  /\b\d{1,2}\.\d{1,2}\.(\d{2,4})?/,
  new RegExp(
    `\\b(am|an diesem|diesen|dieses|kommenden|nächsten|letzten|this|next|on)\\s+(${weekdays})\\b`,
    "i",
  ),
  /\bheute (abend|nacht)\b|\btonight\b/i,
  /\b(plays|playing|performs|performing|appears|appearing) (at|on)\b/i,
  /\b(will|is set to) (play|perform|headline|open|close)\b/i,
  /\b(opens|closes|headlines) (the|this|a)\b/i,
  /\b(is|are) (booked|billed|listed|announced|confirmed)\b/i,
  /\bon the (bill|programme|program)\b/i,
  // "is part of the Unceen lineup at ...", "appears in the extra programme at"
  /\bpart of the\b[^.]*\b(line-?ups?|programme|program|bill)\b/i,
  /\bappears\b[^.]*\b(line-?ups?|programme|program|bill)\b/i,
  /\b(plays|played|performs|performed|is playing|is performing)\s+(?:(?:an?|the)\s+\S+\s+){0,1}(?:set\s+)?(at|on|during)\b/i,
  /^the (night|evening|party|event|programme|program)\b/i,
  // "At ELIFACES #4 he plays ...": an opening that names one event
  /^(At|For)\s+(?!.*\b(resident|regularly|both|including|events)\b)(the\s+)?[A-Z0-9#“"][^.]*\b(plays|appears|performs|takes|opens|closes|joins)\b/,
  /^(?!.*\b(regularly|resident|often|frequently|including|events)\b).*\b(plays|performs)\b[^.]*\bat\s+[A-Z0-9#“"]/,
  new RegExp(
    `\\b(${months})\\s+\\d{1,2}(st|nd|rd|th)?\\b|\\b\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(${months})\\b`,
  ),
  /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i,
  // German night descriptions that only make sense next to one event.
  /^(Die|Der|Das)\s+(Nacht|Abend|Party|Veranstaltung|Klubnacht|Clubnacht|Termin)\b/,
  /\bteil (des|der)\b[^.]*\b(floors?|programms?|abends?|klub-?nacht|club-?nacht|nacht|veranstaltung)\b/i,
  /\bgebucht\b/i,
  // "Bei Level Of Intimacy übernimmt er das Opening": an opening that names
  // one event, then does something at it. Residencies stay bios.
  /^(Bei|Beim|Für)\s+(?!.*\b(Resident|regelmäßig|Stammgast)\b)(der |dem |den )?[A-ZÄÖÜ0-9#„"][^.]*\b(spielt|spielen|tritt|übernimmt|trifft|bewegt|ergänzt|eröffnet|schließt|kehrt|legt|stößt|bestreitet|performt|präsentiert)\b/,
  // "eröffnet/schließt den Floor / das Programm dieser Klubnacht"
  /\b(eröffnet|schließt|ergänzt|übernimmt|bespielt)\b[^.]*\b(floor|klubnacht|clubnacht|nacht|abend|programm|termin|garden|closing|opening|outro)\b/i,
  /\bheadliner\s+(der|des|bei|beim|am|im|von)\b|\b(special guest|support act)\b/i,
  /\b(hostet|kuratiert)\b[^.]*\b(die|den|diese|dieser|dieses)\s+(?:\S+\s+){0,3}(nacht|abend|floor)\b/i,
  /\b(dieser|diese|diesem|dieses|letzten|nächsten|kommenden)\s+(?:\S+\s+){0,3}(klubnacht|clubnacht|nacht|termin|abend|floor)\b/i,
  /\btermin\b/i,
];

// One-sentence formulas that say nothing beyond "is a DJ".
const generic =
  "(?:elektronisch\\w*\\s+)?(?:club\\s?szene|clubumfeld|clubbereich|clubkultur|musikszene|club- und festivalszene|techno-szene|house-szene)";
const filler: readonly RegExp[] = [
  // "ist als DJ im Clubumfeld aktiv", unless it names a concrete affiliation.
  /^(?!.*\b(?:(?:umfeld|szene|bereich)\s+(?:von|des|der|um)|resident\w*|gründer\w*|label|kollektiv|reihe)\b).*\b(ist|sind)\b[^.]*\b(aktiv|tätig|unterwegs)\s*\.?$/i,
  /\b(ist|sind)\s+(ein|eine)?\s*(dj|djane|act|dj-act|dj\/act|live-act|dj-duo|duo|produzent|produzentin)\b[^.]*\b(aus dem|aus der|im|in der)\s+[^.]*?(umfeld|clubumfeld|clubbereich|bereich|szene|clubszene|kontexten?)\s*\.?$/i,
  // "ist als DJ in der elektronischen Clubszene aktiv und arbeitet mit einem
  // dancefloor-orientierten Sound": the scene formula plus a generic tail.
  new RegExp(
    `\\bist\\s+(?:als\\s+)?(?:ein\\s+|eine\\s+)?(?:dj|djane|act|dj/act|live-act|produzent|produzentin)\\b[^.]*\\b(?:in|im|aus)\\s+(?:der|dem)?\\s*${generic}\\s+(?:aktiv\\s+)?und\\s+(?:arbeitet|verfolgt|bewegt|spielt)\\b[^.]*\\b(?:dancefloor|ansatz|sound)\\w*\\s*\\.?$`,
    "i",
  ),
  // "ist ein Berliner DJ und Produzent aus der elektronischen Clubszene."
  new RegExp(
    `\\bist\\s+(?:ein|eine)\\s+(?:\\S+\\s+){0,2}(?:dj|djane|produzent|produzentin|act|live-act|duo)(?:\\s+und\\s+(?:dj|produzent|produzentin))?\\s+(?:aus|in)\\s+(?:der|dem)\\s+${generic}\\s*\\.?$`,
    "i",
  ),
  /\b(is|are)\s+(an?\s+)?(dj|act|live act|producer|duo)\b[^.]*\b(active|based)\s+in\s+the\s+[^.]*\b(scene|circuit|world)\s*\.?$/i,
  /\b(is|are)\s+active\s+as\s+(an?\s+)?(dj|act|live act|producer|duo)\b[^.]*\b(scene|circuit|world)\s*\.?$/i,
  /\bperforms\s+as\s+an?\s+(dj|act)\b[^.]*\blineups?\s*\.?$/i,
  // "is active as a DJ in electronic club culture [with a fast sound]."
  /^(?!.*\b(?:resident|founder|label|collective|crew|series|orbit|around)\b).*\b(is|are)\b[^.]*\bactive\b[^.]*\b(?:club\s+(?:culture|music|scene|scenes|world)|scene|circuit|lineups?|act)(?:\s+with\s+an?\s+[^.]*?\b(?:sound|approach|style)s?)?\s*\.?$/i,
  /\b(is|are)\s+(an?\s+)?(electronic\s+)?(dj|act|producer|duo)\s+from\s+the\s+(electronic\s+)?(club\s+scene|club\s+world)\s*\.?$/i,
  /\baktive?[rs]?\s+(dj|djane|act|live-act)\b[^.]*\b(szene|umfeld|bereich)\s*\.?$/i,
];

const abbreviations = /\b(Dr|St|Mr|Mrs|Ms|Nr|ca|bzw|inkl|feat|vs|Vol)\.$/;

export function sentences(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const piece of text.trim().split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"«])/)) {
    current = current ? `${current} ${piece}` : piece;
    // Keep "am 2. Oktober" and "Dr. Motte" together. Names such as "Ri0D.",
    // "M.I.A." or "L.A.S." end in a dot without ending the sentence: a lone
    // word or an initialism is a name, not a sentence.
    if (
      /\d\.$/.test(current) ||
      abbreviations.test(current) ||
      !/\s/.test(current) ||
      /(?:^|[\s(])(?:\p{L}\.){2,}$/u.test(current)
    )
      continue;
    parts.push(current);
    current = "";
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const isEventBound = (sentence: string) =>
  eventBound.some((pattern) => pattern.test(sentence));
const isFiller = (sentence: string) =>
  sentence.length <= 160 && filler.some((pattern) => pattern.test(sentence));

/**
 * Sentences that describe the artist, up to the first one that talks about a
 * booking. Later sentences usually lean on that booking ("Die Nacht bewegt
 * sich ..."), so they are dropped with it.
 */
function leadingBio(description: string): string[] {
  const all = sentences(description);
  const end = all.findIndex(isEventBound);
  return end < 0 ? all : all.slice(0, end);
}

/** The part of a description that is safe to show as an artist or venue bio. */
export function publicBio(description: string): string {
  const kept = leadingBio(description);
  if (kept.length === 1 && isFiller(kept[0] ?? "")) return "";
  return kept.join(" ");
}

/**
 * The bio to show in a locale. Both languages are hidden together when the
 * German text is hidden, so they never disagree; English falls back to the
 * German bio when its own text does not survive.
 */
export function publicBioFor(
  entity: {
    description: string;
    translations?: { en?: { description?: string } };
  },
  locale: Locale,
): string {
  const german = publicBio(entity.description);
  if (!german || locale === "de") return german;
  return publicBio(entity.translations?.en?.description ?? "") || german;
}

export function assessDescription(description: string): DescriptionIssue[] {
  const all = sentences(description);
  if (!all.length) return [];
  const kept = leadingBio(description);
  const issues: DescriptionIssue[] = [];
  if (kept.length < all.length) issues.push("description_event_bound");
  if (kept.length === 1 && isFiller(kept[0] ?? ""))
    issues.push("description_filler");
  return issues;
}

const issueMessages: Record<DescriptionIssue, string> = {
  description_event_bound:
    "Description mentions a single booking (line-up, time slot, date or B2B). Describe the artist or venue instead.",
  description_filler:
    "Description is generic filler. Write a real bio or leave it empty.",
};

/** Non-blocking notes for a description an agent just wrote. */
export function descriptionWarnings(
  description: string,
  translations?: { en?: { description?: string | undefined } | undefined },
): string[] {
  const warnings = assessDescription(description).map(
    (issue) => issueMessages[issue],
  );
  const english = translations?.en?.description;
  if (english)
    for (const issue of assessDescription(english))
      warnings.push(`English translation: ${issueMessages[issue]}`);
  return warnings;
}
