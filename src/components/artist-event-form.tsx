"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  LineupPicker,
  VenuePicker,
  type ArtistOption,
  type VenueOption,
} from "@/components/artist-pickers";

const candidatesSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      sourceUrl: z.url(),
    }),
  ),
});
type Candidate = z.infer<typeof candidatesSchema>["results"][number];

// Resolve a wall-clock value in the selected venue timezone. DST gaps and
// repeated times are rejected instead of silently choosing the wrong instant.
function localInstant(local: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(local);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const base = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  const values: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = base - offset * 60_000;
    const parts = Object.fromEntries(
      format.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    if (
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` ===
      local
    )
      values.push(instant);
  }
  return values.length === 1 && values[0] !== undefined
    ? new Date(values[0]).toISOString()
    : null;
}
export function ArtistEventForm({
  venues,
  artists,
  preview = false,
}: {
  venues: VenueOption[];
  artists: ArtistOption[];
  preview?: boolean;
}) {
  const router = useRouter();
  const [venueId, setVenueId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const lookupGeneration = useRef(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [location, setLocation] = useState<Candidate | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = venues.find((venue) => venue.id === venueId);
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const zone = selected?.timezone ?? timezone;
  async function lookup() {
    const generation = ++lookupGeneration.current;
    setBusy(true);
    setNotice("");
    setLocation(null);
    setCandidates([]);
    try {
      if (preview) {
        setCandidates([
          {
            id: "node/demo",
            name: `Fiktives Beispiel: ${query}, ${city}`,
            latitude: 52.52,
            longitude: 13.4,
            sourceUrl: "https://www.openstreetmap.org/",
          },
        ]);
        return;
      }
      const response = await fetch("/api/artist-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${query}, ${city}` }),
      });
      const parsed = candidatesSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success)
        throw new Error(
          "Standortsuche nicht verfügbar. Bitte versuche es später erneut.",
        );
      if (generation !== lookupGeneration.current) return;
      setCandidates(parsed.data.results);
      if (!parsed.data.results.length)
        setNotice(
          "Kein Standort gefunden. Prüfe die Adresse und suche erneut.",
        );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Standortsuche fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const data = new FormData(event.currentTarget);
    const start = data.get("startsAt");
    const end = data.get("endsAt");
    const startsAt =
      typeof start === "string" ? localInstant(start, zone) : null;
    const endsAt =
      typeof end === "string" && end ? localInstant(end, zone) : null;
    if (!startsAt || (end && !endsAt)) {
      setNotice(
        "Bitte prüfe Datum, Uhrzeit und Zeitzone. Eine nicht existierende oder doppelte Uhrzeit bei Zeitumstellung kann nicht verwendet werden.",
      );
      return;
    }
    if (venueId === null) {
      setNotice("Bitte wähle eine Venue aus oder füge eine neue hinzu.");
      return;
    }
    if (venueId === "new" && !location) {
      setNotice(
        "Bitte suche die Adresse und bestätige den passenden Standort.",
      );
      return;
    }
    data.set("startsAt", startsAt);
    if (venueId === "new") {
      const country = data.get("country");
      if (typeof country === "string")
        data.set("country", country.toUpperCase());
    }
    if (endsAt) data.set("endsAt", endsAt);
    else data.delete("endsAt");
    if (venueId === "new" && location) {
      data.set("latitude", String(location.latitude));
      data.set("longitude", String(location.longitude));
      data.set("locationSourceUrl", location.sourceUrl);
    }
    if (preview) {
      setNotice("Vorschau: Das Event wird nicht veröffentlicht.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/artist-events", {
        method: "POST",
        body: data,
      });
      const payload: unknown = await response.json();
      const result = z.object({ slug: z.string() }).safeParse(payload);
      if (response.status === 409)
        throw new Error(
          "Diese Venue oder ein Event zur selben Zeit ist bereits vorhanden. Bitte wähle die bestehende Venue und prüfe das Programm.",
        );
      if (response.status === 413)
        throw new Error(
          "Der Flyer ist zu groß. Bitte wähle eine Datei unter 5 MB.",
        );
      const errorCode = z.object({ error: z.string() }).safeParse(payload);
      if (errorCode.success && errorCode.data.error === "invalid_cover")
        throw new Error(
          "Bitte wähle ein gültiges JPEG, PNG oder WebP unter 5 MB und bestätige, dass du den Flyer veröffentlichen darfst.",
        );
      if (!response.ok || !result.success)
        throw new Error(
          "Event konnte nicht veröffentlicht werden. Bitte prüfe deine Angaben und versuche es erneut.",
        );
      router.push(`/events/${encodeURIComponent(result.data.slug)}`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Event konnte nicht veröffentlicht werden.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="event">
      <p className="artist-kicker">DEINE NÄCHSTE NACHT</p>
      <h2>Event hinzufügen</h2>
      <form className="artist-form" onSubmit={submit}>
        <label>
          Eventtitel
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Beschreibung
          <textarea name="description" maxLength={10000} />
        </label>
        <div className="artist-form-row">
          <label>
            Beginn
            <input name="startsAt" type="datetime-local" required />
          </label>
          <label>
            Ende
            <input name="endsAt" type="datetime-local" />
          </label>
        </div>
        <VenuePicker
          venues={venues}
          value={venueId}
          onChange={(value) => {
            setVenueId(value);
            setLocation(null);
          }}
        />
        {venueId === "new" && (
          <>
            <label>
              Name der Venue
              <input name="venueName" required />
            </label>
            <label>
              Adresse
              <input
                name="address"
                required
                onChange={(e) => {
                  lookupGeneration.current++;
                  setQuery(e.target.value);
                  setLocation(null);
                  setCandidates([]);
                }}
              />
            </label>
            <label>
              Stadt
              <input
                name="city"
                required
                onChange={(e) => {
                  lookupGeneration.current++;
                  setCity(e.target.value);
                  setLocation(null);
                  setCandidates([]);
                }}
              />
            </label>
            <label>
              Land (z. B. DE)
              <input
                name="country"
                defaultValue="DE"
                pattern="[A-Za-z]{2}"
                required
              />
            </label>
            <label>
              Zeitzone
              <input
                name="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                required
              />
            </label>
            <p>
              Suche nur nach öffentlichen Venue-Adressen, nicht nach privaten
              oder vertraulichen Daten. Die Adresse wird an OpenStreetMap
              Nominatim gesendet. ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenStreetMap-Mitwirkende
              </a>
              .
            </p>
            <button
              type="button"
              className="chip-button"
              onClick={lookup}
              disabled={
                busy || query.trim().length < 3 || city.trim().length < 2
              }
            >
              Adresse suchen
            </button>
            {candidates.map((candidate) => (
              <button
                type="button"
                className="chip-button"
                key={candidate.id}
                onClick={() => setLocation(candidate)}
                aria-pressed={location?.id === candidate.id}
              >
                {candidate.name}
              </button>
            ))}
            {location && (
              <p className="artist-status">
                Standort bestätigt: {location.name}
              </p>
            )}
          </>
        )}
        {venueId && <p>Zeitzone: {zone}</p>}
        <LineupPicker artists={artists} />
        <label>
          Ticketlink
          <input name="ticketUrl" type="url" placeholder="https://" />
        </label>
        <label>
          Flyer hochladen
          <input
            name="cover"
            type="file"
            accept="image/jpeg,image/png,image/webp"
          />
        </label>
        <label>
          <span>
            <input name="rightsConfirmed" type="checkbox" value="true" /> Ich
            darf diesen Flyer veröffentlichen.
          </span>
        </label>
        {notice && (
          <p className="artist-status" role="status">
            {notice}
          </p>
        )}
        <button className="artist-submit" type="submit" disabled={busy}>
          {busy ? "Bitte warten …" : "Event veröffentlichen"}
        </button>
      </form>
    </section>
  );
}
