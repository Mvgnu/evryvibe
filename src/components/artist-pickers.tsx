"use client";
import { useId, useRef, useState, type KeyboardEvent } from "react";

export type VenueOption = {
  id: string;
  name: string;
  city: string;
  timezone: string;
};
export type ArtistOption = {
  id: string;
  name: string;
  slug: string;
  instagramUrl: string | null;
};
type Entry =
  { kind: "known"; artist: ArtistOption } | { kind: "unlinked"; name: string };

export function VenuePicker({
  venues,
  value,
  onChange,
}: {
  venues: VenueOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const selected = venues.find((v) => v.id === value);
  const matches = query.trim()
    ? venues
        .filter((v) =>
          `${v.name} ${v.city}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, 8)
    : [];
  return (
    <div className="artist-picker">
      <label htmlFor={`${listId}-input`}>Venue suchen</label>
      {selected ? (
        <div className="artist-choice">
          <strong>
            {selected.name} · {selected.city}
          </strong>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(true);
            }}
          >
            Ändern
          </button>
        </div>
      ) : value === "new" ? (
        <div className="artist-choice">
          <strong>Neue Venue</strong>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(true);
            }}
          >
            Ändern
          </button>
        </div>
      ) : (
        <>
          <input
            id={`${listId}-input`}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && matches.length) {
                event.preventDefault();
                setOpen(true);
                setActive((index) => Math.min(index + 1, matches.length - 1));
              }
              if (event.key === "ArrowUp" && matches.length) {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const match = matches[active];
                if (match) {
                  onChange(match.id);
                  setOpen(false);
                }
              }
              if (event.key === "Escape") {
                setOpen(false);
                setActive(-1);
              }
            }}
            placeholder="Club oder Stadt"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              active >= 0 ? `${listId}-option-${active}` : undefined
            }
          />
          {open && (
            <div id={listId} className="artist-options" role="listbox">
              {matches.map((v, index) => (
                <button
                  type="button"
                  role="option"
                  id={`${listId}-option-${index}`}
                  aria-selected={index === active}
                  key={v.id}
                  onClick={() => {
                    onChange(v.id);
                    setOpen(false);
                  }}
                >
                  <strong>{v.name}</strong>
                  <span>{v.city}</span>
                </button>
              ))}
              {query && !matches.length && (
                <span className="artist-option-note">
                  Keine bestehende Venue gefunden.
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  onChange("new");
                  setOpen(false);
                }}
              >
                + Neue Venue hinzufügen
              </button>
            </div>
          )}
        </>
      )}
      <input type="hidden" name="venueId" value={selected?.id ?? ""} />
    </div>
  );
}
export function LineupPicker({ artists }: { artists: ArtistOption[] }) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? artists
        .filter(
          (a) =>
            `${a.name} ${a.slug}`.toLocaleLowerCase().includes(normalized) &&
            !entries.some((e) => e.kind === "known" && e.artist.id === a.id),
        )
        .slice(0, 8)
    : [];
  const addKnown = (artist: ArtistOption) => {
    setEntries((items) => [...items, { kind: "known", artist }]);
    setActive(-1);
    setQuery("");
    input.current?.setCustomValidity("");
  };
  const addUnlinked = () => {
    const name = query.trim();
    if (
      !name ||
      name.length > 100 ||
      entries.length >= 50 ||
      entries.some(
        (e) =>
          (e.kind === "known" ? e.artist.name : e.name).toLocaleLowerCase() ===
          name.toLocaleLowerCase(),
      )
    )
      return;
    setEntries((items) => [...items, { kind: "unlinked", name }]);
    setActive(-1);
    setQuery("");
    input.current?.setCustomValidity("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && matches.length) {
      e.preventDefault();
      setActive((index) => Math.min(index + 1, matches.length - 1));
    }
    if (e.key === "ArrowUp" && matches.length) {
      e.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    }
    if (e.key === "Escape") setActive(-1);
    if (e.key === "Enter") {
      e.preventDefault();
      const match = matches[active];
      if (match) addKnown(match);
      else addUnlinked();
    }
  };
  return (
    <div className="artist-picker">
      <label htmlFor={`${listId}-input`}>Line-up</label>
      <p>
        Du bist automatisch dabei. Suche weitere Artists oder füge einen Namen
        mit Enter hinzu.
      </p>
      <div className="artist-tokens">
        {entries.map((entry, index) => (
          <span
            className="artist-token"
            key={entry.kind === "known" ? entry.artist.id : entry.name}
          >
            {entry.kind === "known" ? entry.artist.name : entry.name}
            {entry.kind === "unlinked" && <small> · nicht verknüpft</small>}
            <button
              type="button"
              aria-label={`${entry.kind === "known" ? entry.artist.name : entry.name} entfernen`}
              onClick={() =>
                setEntries((items) => items.filter((_, i) => i !== index))
              }
            >
              ×
            </button>
            <input
              type="hidden"
              name={entry.kind === "known" ? "djIds" : "lineupNames"}
              value={entry.kind === "known" ? entry.artist.id : entry.name}
            />
          </span>
        ))}
      </div>
      <input
        id={`${listId}-input`}
        ref={input}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(-1);
          e.currentTarget.setCustomValidity(
            e.target.value.trim()
              ? "Bitte wähle einen Artist aus oder füge den Namen mit Enter hinzu."
              : "",
          );
        }}
        onKeyDown={onKeyDown}
        maxLength={100}
        placeholder="Artist suchen oder Namen eingeben"
        autoComplete="off"
        role="combobox"
        aria-expanded={!!normalized}
        aria-controls={listId}
        aria-activedescendant={
          active >= 0 ? `${listId}-option-${active}` : undefined
        }
      />
      {normalized && (
        <div id={listId} className="artist-options" role="listbox">
          {matches.map((a, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-option-${index}`}
              aria-selected={index === active}
              key={a.id}
              onClick={() => addKnown(a)}
            >
              <strong>{a.name}</strong>
              <span>
                {a.instagramUrl
                  ? `@${new URL(a.instagramUrl).pathname.split("/").filter(Boolean)[0]}`
                  : a.slug}
              </span>
            </button>
          ))}
          <button type="button" onClick={addUnlinked}>
            + „{query.trim()}“ als nicht verknüpften Namen hinzufügen ↵
          </button>
        </div>
      )}
    </div>
  );
}
