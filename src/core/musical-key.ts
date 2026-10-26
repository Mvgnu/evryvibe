import { z } from "zod";

// Note names and basic neighbours follow the official Camelot chart:
// https://mixedinkey.com/camelot-wheel/
// German B is B-flat; international B is German H.
export const CAMELOT_KEYS = [
  { key: "1A", nameDe: "Gis-Moll / As-Moll", nameEn: "G♯ minor / A♭ minor" },
  { key: "1B", nameDe: "H-Dur", nameEn: "B major" },
  { key: "2A", nameDe: "Dis-Moll / Es-Moll", nameEn: "D♯ minor / E♭ minor" },
  { key: "2B", nameDe: "Fis-Dur / Ges-Dur", nameEn: "F♯ major / G♭ major" },
  { key: "3A", nameDe: "Ais-Moll / B-Moll", nameEn: "A♯ minor / B♭ minor" },
  { key: "3B", nameDe: "Des-Dur / Cis-Dur", nameEn: "D♭ major / C♯ major" },
  { key: "4A", nameDe: "F-Moll", nameEn: "F minor" },
  { key: "4B", nameDe: "As-Dur", nameEn: "A♭ major" },
  { key: "5A", nameDe: "C-Moll", nameEn: "C minor" },
  { key: "5B", nameDe: "Es-Dur", nameEn: "E♭ major" },
  { key: "6A", nameDe: "G-Moll", nameEn: "G minor" },
  { key: "6B", nameDe: "B-Dur", nameEn: "B♭ major" },
  { key: "7A", nameDe: "D-Moll", nameEn: "D minor" },
  { key: "7B", nameDe: "F-Dur", nameEn: "F major" },
  { key: "8A", nameDe: "A-Moll", nameEn: "A minor" },
  { key: "8B", nameDe: "C-Dur", nameEn: "C major" },
  { key: "9A", nameDe: "E-Moll", nameEn: "E minor" },
  { key: "9B", nameDe: "G-Dur", nameEn: "G major" },
  { key: "10A", nameDe: "H-Moll", nameEn: "B minor" },
  { key: "10B", nameDe: "D-Dur", nameEn: "D major" },
  { key: "11A", nameDe: "Fis-Moll", nameEn: "F♯ minor" },
  { key: "11B", nameDe: "A-Dur", nameEn: "A major" },
  { key: "12A", nameDe: "Cis-Moll / Des-Moll", nameEn: "C♯ minor / D♭ minor" },
  { key: "12B", nameDe: "E-Dur", nameEn: "E major" },
] as const;

export const camelotKeySchema = z.enum(CAMELOT_KEYS.map(({ key }) => key));
export type CamelotKey = z.infer<typeof camelotKeySchema>;

const minorByPitch: Readonly<Record<number, CamelotKey>> = {
  0: "5A",
  1: "12A",
  2: "7A",
  3: "2A",
  4: "9A",
  5: "4A",
  6: "11A",
  7: "6A",
  8: "1A",
  9: "8A",
  10: "3A",
  11: "10A",
};
const majorByPitch: Readonly<Record<number, CamelotKey>> = {
  0: "8B",
  1: "3B",
  2: "10B",
  3: "5B",
  4: "12B",
  5: "7B",
  6: "2B",
  7: "9B",
  8: "4B",
  9: "11B",
  10: "6B",
  11: "1B",
};
const naturalPitches: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
  h: 11,
};
const germanPitches: Readonly<Record<string, number>> = {
  cis: 1,
  des: 1,
  dis: 3,
  es: 3,
  eis: 5,
  fes: 4,
  fis: 6,
  ges: 6,
  gis: 8,
  as: 8,
  ais: 10,
  hes: 10,
  ces: 11,
  his: 0,
};

function parseNamedKey(value: string): CamelotKey | null {
  const longMode = /^(.+?)[\s-]*(major|minor|maj|min|dur|moll)$/i.exec(value);
  const shortMode = longMode ? null : /^([A-GH](?:[#♯b♭])?)([mM])$/.exec(value);
  const note = longMode?.[1] ?? shortMode?.[1];
  const rawMode = longMode?.[2] ?? shortMode?.[2];
  if (!note || !rawMode) return null;
  const mode = rawMode.toLowerCase();
  const minor = shortMode
    ? rawMode === "m"
    : mode === "minor" || mode === "min" || mode === "moll";
  const german = mode === "dur" || mode === "moll";
  const spelling = note
    .trim()
    .toLowerCase()
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/[\s-]+sharp$/, "#")
    .replace(/[\s-]+flat$/, "b");
  let pitch = germanPitches[spelling];
  if (pitch === undefined) {
    const match = /^([a-gh])([#b]?)$/.exec(spelling);
    const letter = match?.[1];
    if (!letter) return null;
    const natural = naturalPitches[letter];
    if (natural === undefined) return null;
    const accidental = match?.[2];
    // B-Dur/B-Moll are explicitly German. A bare B has no mode and is
    // rejected; B major/B minor and Bm use international notation.
    pitch = german && spelling === "b" ? 10 : natural;
    if (accidental === "#") pitch += 1;
    if (accidental === "b") pitch -= 1;
    pitch = (pitch + 12) % 12;
  }
  return (minor ? minorByPitch[pitch] : majorByPitch[pitch]) ?? null;
}

/** Accept explicit modes or Camelot notation; never infer a mode from a bare note. */
export function parseMusicalKey(value: unknown): CamelotKey | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const text = value.trim();
  const camelot = camelotKeySchema.safeParse(text.toUpperCase());
  if (camelot.success) return camelot.data;
  const names = text.split("/").map((name) => parseNamedKey(name.trim()));
  const first = names[0];
  return first && names.every((key) => key === first) ? first : null;
}

/** Same key, adjacent positions (wrapping 12↔1), and relative major/minor. */
export function compatibleKeys(key: CamelotKey): CamelotKey[] {
  const number = Number.parseInt(key, 10);
  const mode = key.endsWith("A") ? "A" : "B";
  const candidates = [
    key,
    `${number === 1 ? 12 : number - 1}${mode}`,
    `${number === 12 ? 1 : number + 1}${mode}`,
    `${number}${mode === "A" ? "B" : "A"}`,
  ];
  return candidates
    .map(parseMusicalKey)
    .filter((candidate) => candidate !== null);
}
