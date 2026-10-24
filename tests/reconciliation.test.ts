import { describe, expect, it } from "vitest";
import {
  assessDescription,
  descriptionWarnings,
  publicBio,
  publicBioFor,
  sentences,
} from "../src/core/reconciliation";
import {
  completionProblems,
  profileChecks,
} from "../src/core/reconciliation-tasks";

// Real shapes found in the production catalogue (names are public artist names).
const eventNotes = [
  "Skizzo steht bei Electric Grooves im Tanzhaus West im Line-up.",
  "Beryll ist als DJ/Act bei Tresor New Faces hosted by Push Network im Tresor Berlin angekündigt.",
  "Worthmann schließt EUPHORIA im WDM mit dem letzten Slot von 6 bis 8 Uhr.",
  "Eileen ist bei Lifesaver Saturday am 10. Oktober 2026 im Robert Johnson in Offenbach als DJ angekündigt.",
  "Luka V ist für die 135+-Nacht mit 1CB und Dankus Kollektiv am 15. Oktober 2026 im Bahnwärter Thiel in München gebucht.",
  "DNY spielt bei RAW FREQUENCIES x ELECTRONIC LIEBE im B2B mit Klangkapitalist.",
  "Aleks ist ein niederländischer DJ, der beim WDM-Termin den zweiten Floor ergänzt.",
  "OutWithJane eröffnet bei Sonic Dimensions #1 den Garden der Distillery.",
  "CosmiKat ist Teil der Klubnacht auf der MS Treue.",
  "MAR DEAN ist DJ aus Zürich und Headliner der ELEKTRISCH-Nacht in der Rakete.",
  "Chef de Party ist Teil des Hertz-Kollektivs und steht gemeinsam mit Luzia im Silbergold.",
  "Jeremy Reinhard spielt am 11. November 2026 im Odonien ein B2B mit Adriano Rosso.",
  "Jazzy plays at the Friday night party on 12 December 2026.",
  "VIKOSH is booked as a DJ in Stuttgart club programming around the W6KE UP afterhour.",
  "Carl Raban is billed as a DJ/act at Tresor New Faces hosted by In Balance at Tresor Berlin.",
  "adrenaLinn is part of the BoomBassTek lineup for XVI at Sektor Evolution.",
  "Human Space Machine is part of the Radiance lineup at RSO.BERLIN.",
  "KimonoLulu appears in the extra programme at Kater’s birthday event “Gurken im Olymp”.",
  "Leeni plays AYA Connecting at Odonien.",
  "Mareena opens the floor on March 3rd with a long set.",
  "Die Nacht bewegt sich durch Techno, Bounce, Hard Trance, Hard House und Speedhouse.",
  "Der Abend startet früh und bleibt bis zum Morgen offen.",
  "Cey ist als DJ in der elektronischen Clubszene aktiv und Teil des Line-ups von Permission x Hardgrooven im Tresor.West.",
  "Anna is booked for the opening night at Tresor.",
];
const filler = [
  "VIVI ist als DJ im elektronischen Clubbereich aktiv.",
  "James Cherry ist als DJ in der elektronischen Clubszene aktiv.",
  "Mike Stevens ist als DJ im Techno-Umfeld aktiv.",
  "AYK ist als DJ in der elektronischen Clubszene aktiv und arbeitet mit einem klar dancefloor-orientierten Ansatz.",
  "PRADA2000 ist ein Berliner DJ und Produzent aus der elektronischen Clubszene.",
  "Milo ist im Stuttgarter Clubumfeld als DJ aktiv.",
  "Max is a DJ active in the electronic club scene.",
  "German is active as a DJ in electronic club culture.",
  "Nastia is an internationally active DJ and producer in electronic club culture.",
  "Pheyd is active as an electronic act across club and festival lineups.",
  "5euroGoldi is active as a DJ in electronic club culture with a fast, rave-oriented sound.",
  "Andata performs as a DJ on electronic club and rave lineups.",
];
// Real bios that mention residencies, labels, cities, collectives and venues.
const bios = [
  "Eliano ist ein Stuttgarter DJ und Produzent mit einem melodischen elektronischen Sound. Seine Sets bewegen sich zwischen House, Afro House, Melodic Techno und tieferen Techno-Spielarten.",
  "DJ Stimula ist Resident im Leipziger elipamanoke und spielt seit 2022 Clubsets. Ihre Auswahl verbindet hohes Tempo mit emotionalen und druckvollen Momenten.",
  "Seelsorger ist ein Kölner DJ aus dem Hard-Techno-Umfeld.",
  "Bjørnson ist Resident auf Fridas Pier und steht für groovigen, pulsierenden Techno. Seine Sets verbinden klaren Drive mit rhythmischer Tiefe.",
  "Bei Fridas Pier ist er als Resident regelmäßig zu Gast.",
  "Tommy Four Seven ist ein britischer Techno-DJ und Produzent. Mit Alben wie „Primate“ und „Veer“ sowie seinem bis 2025 betriebenen Label 47 entwickelte er einen eigenständigen, druckvollen Techno-Ansatz.",
  "Lucie Leh ist eine DJ aus Halle an der Saale und im Umfeld von Tarmac, Sleeve+++ und Slot Fighter aktiv.",
  "Festnacht ist in der Hamburger Clubszene verankert und betreibt gemeinsam mit L.F.T. Neoprimitive. Seine Sets bewegen sich unter anderem zwischen Detroit-geprägtem Techno und Electro.",
  "Kaya Schwarz is a resident at Goethebunker, connecting hypnotic, groove-led techno with polyrhythmic tension.",
  "Lucas Darío is a Hamburg DJ and member of the Incognito Collective. He plays in the local underground scene, including events at Gängeviertel.",
  "Omon Breaker is a Berlin-based artist. His sound stays rooted in techno with raw textures.",
  "Hotfriedricecracker ist ein DJ-Act aus dem Hamburger Clubumfeld und regelmäßig in elektronischen Line-ups der Stadt vertreten.",
  // Venues talk about programming in general; that is not an event note.
  "Berghain ist ein Fixpunkt der internationalen Clubkultur. Die langen Klubnächte, das strikte Fotoverbot und die präzise kuratierten Line-ups prägen einen Ort, an dem Musik und Raum wichtiger sind als Inszenierung.",
  "Sektor Evolution verbindet Clubnächte mit einem Kalender, der weit über einzelne Headliner hinaus funktioniert.",
  "Dr. Motte gründete die Love Parade und legt seit den 1990er Jahren weltweit auf.",
];

describe("assessDescription", () => {
  it.each(eventNotes)("flags the event note: %s", (text) => {
    expect(assessDescription(text)).toContain("description_event_bound");
    expect(publicBio(text)).toBe("");
  });
  it.each(filler)("flags the filler: %s", (text) => {
    expect(assessDescription(text)).toEqual(["description_filler"]);
    expect(publicBio(text)).toBe("");
  });
  it.each(bios)("keeps the real bio: %s", (text) => {
    expect(assessDescription(text)).toEqual([]);
    expect(publicBio(text)).toBe(text);
  });
  it("keeps the bio sentences and drops only the booking sentence", () => {
    const text =
      "Tigerhead ist eine in Deutschland lebende DJ und Produzentin mit einem rohen, vielseitigen Techno-Ansatz. Bei GROOVE RUINE spielt sie einen dreistündigen Vinyl-Slot im Boiler.";
    expect(assessDescription(text)).toEqual(["description_event_bound"]);
    expect(publicBio(text)).toBe(
      "Tigerhead ist eine in Deutschland lebende DJ und Produzentin mit einem rohen, vielseitigen Techno-Ansatz.",
    );
    expect(
      publicBio(
        "Fantasm ist als DJ im Hardtechno-Umfeld aktiv. Am 14. November 2026 ist er für HASARDEUR INDOOR angekündigt.",
      ),
    ).toBe("");
  });
  it("keeps only the leading run of bio sentences so no dangling fragment survives", () => {
    const unceen =
      "Anna Ullrich ist ein DJ-Act aus dem elektronischen Clubkontext und Teil des Unceen-Line-ups im Hamburger Südpol. Die Nacht bewegt sich durch Techno, Bounce, Hard Trance, Hard House und Speedhouse.";
    expect(publicBio(unceen)).toBe("");
    expect(assessDescription(unceen)).toEqual(["description_event_bound"]);
    const dangling =
      "Ein DJ aus Bremen mit Fokus auf Techno. Am 14. November 2026 ist er angekündigt. Auftritte im Club und auf der MS Treue verbinden den Act mit der Szene.";
    expect(publicBio(dangling)).toBe("Ein DJ aus Bremen mit Fokus auf Techno.");
  });
  it("treats an empty description as clean", () => {
    expect(assessDescription("")).toEqual([]);
    expect(descriptionWarnings("")).toEqual([]);
  });
  it("assesses the English translation as well", () => {
    expect(
      descriptionWarnings("Ein Bio-Satz über Techno und Labels.", {
        en: { description: "Skizzo is on the line-up at Electric Grooves." },
      }),
    ).toHaveLength(1);
  });
});

describe("publicBioFor", () => {
  const entity = (description: string, en?: string) => ({
    description,
    ...(en === undefined ? {} : { translations: { en: { description: en } } }),
  });
  const bio = "Eliano ist ein Stuttgarter DJ mit melodischem Sound.";
  it("hides both languages together", () => {
    const hidden = entity(
      "Skizzo steht bei Electric Grooves im Line-up.",
      "Skizzo is a Berlin DJ with a deep techno sound.",
    );
    expect(publicBioFor(hidden, "de")).toBe("");
    expect(publicBioFor(hidden, "en")).toBe("");
    const filler = entity(
      "VIVI ist als DJ im elektronischen Clubbereich aktiv.",
      "VIVI is a Munich DJ.",
    );
    expect(publicBioFor(filler, "en")).toBe("");
  });
  it("shows English when it survives and falls back to the German bio when it does not", () => {
    expect(publicBioFor(entity(bio, "Eliano is a Stuttgart DJ."), "en")).toBe(
      "Eliano is a Stuttgart DJ.",
    );
    expect(
      publicBioFor(entity(bio, "VIKOSH is booked as a DJ at W6KE UP."), "en"),
    ).toBe(bio);
    expect(publicBioFor(entity(bio), "en")).toBe(bio);
    expect(publicBioFor(entity(bio, "Eliano is a Stuttgart DJ."), "de")).toBe(
      bio,
    );
  });
});

describe("sentences", () => {
  it("does not split inside names that contain dots", () => {
    for (const name of ["L.A.S.", "M.I.A.", "Ri0D.", "lu.wicked", "Lea.OH"]) {
      const text = `${name} Sie ist DJ aus Berlin. Ihr Sound ist roh.`;
      expect(sentences(text).length).toBeLessThanOrEqual(3);
      expect(sentences(`${name} ist eine DJ aus Köln.`)).toHaveLength(1);
    }
    expect(sentences("M.I.A. Ist DJ aus Wien. Sie liebt Techno.")).toEqual([
      "M.I.A. Ist DJ aus Wien.",
      "Sie liebt Techno.",
    ]);
  });
  it("keeps dates and abbreviations inside one sentence", () => {
    expect(
      sentences("Sie spielt am 2. Oktober in Berlin. Danach geht es weiter."),
    ).toHaveLength(2);
    expect(
      sentences("Dr. Motte legt auf. Er gründete die Love Parade."),
    ).toEqual(["Dr. Motte legt auf.", "Er gründete die Love Parade."]);
  });
});

describe("profileChecks and completionProblems", () => {
  const profile = {
    description: "VIVI ist als DJ im elektronischen Clubbereich aktiv.",
    translations: {},
    websiteUrl: "https://soundcloud.com/vivi",
    soundcloudUrl: null,
  };
  it("derives checks from stored data and past outcomes", () => {
    expect(
      profileChecks(profile, {
        soundcloudVerified: false,
        soundcloudNotFound: false,
      }),
    ).toEqual([
      "description_filler",
      "soundcloud_in_website",
      "soundcloud_missing",
    ]);
    expect(
      profileChecks(profile, {
        soundcloudVerified: false,
        soundcloudNotFound: true,
      }),
    ).not.toContain("soundcloud_missing");
    expect(
      profileChecks(
        { ...profile, soundcloudUrl: "https://soundcloud.com/vivi" },
        { soundcloudVerified: false, soundcloudNotFound: false },
      ),
    ).toContain("soundcloud_unverified");
  });
  it("keeps the English text in step with the German one", () => {
    const stored = {
      ...profile,
      translations: { en: { description: "VIVI is a DJ." } },
    };
    const base = {
      checks: ["description_filler"],
      stored,
      outcome: {
        description: "cleared" as const,
        soundcloud: "unchanged" as const,
        basis: "x",
      },
    };
    expect(
      completionProblems({ ...base, changes: { description: "" } }).join(" "),
    ).toMatch(/clear both/);
    expect(
      completionProblems({
        ...base,
        changes: { description: "", translations: null },
      }).filter((p) => /English|translations/.test(p)),
    ).toEqual([]);
    expect(
      completionProblems({
        ...base,
        outcome: { ...base.outcome, description: "rewritten" },
        changes: {
          description: "VIVI ist eine Münchner DJ.",
          translations: {
            en: { description: "VIVI is booked as a DJ at W6KE UP." },
          },
        },
      }).join(" "),
    ).toMatch(/translations\.en\.description reads like/);
  });
  it("refuses to close a task with the problem still in place", () => {
    const base = {
      checks: ["description_filler", "soundcloud_missing"],
      stored: profile,
      changes: {},
      outcome: {
        description: "kept" as const,
        soundcloud: "unchanged" as const,
        basis: "x",
      },
    };
    expect(completionProblems(base).join(" ")).toMatch(/issues/);
    expect(completionProblems(base).join(" ")).toMatch(/soundcloud_missing/);
    expect(
      completionProblems({
        ...base,
        checks: ["soundcloud_in_website"],
        changes: { description: "" },
        outcome: {
          description: "cleared",
          soundcloud: "not_found",
          basis: "none found",
        },
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/websiteUrl/)]));
    expect(
      completionProblems({
        ...base,
        checks: ["description_filler", "soundcloud_missing"],
        stored: { ...profile, websiteUrl: null },
        changes: { description: "" },
        outcome: {
          description: "cleared",
          soundcloud: "not_found",
          basis: "none found",
        },
      }),
    ).toEqual([]);
  });
});
