// Generated techno poster artwork. Pure and hook-free so it renders the same
// from server components and from the client Artwork. Everything here is
// decorative duplication of real page text; callers keep it aria-hidden.
import type { CSSProperties, ReactNode } from "react";
import type { Locale } from "@/core/i18n";
import type { SoundFamily } from "@/core/sound";
import type { PosterFacts } from "@/components/poster-facts";

type Vars = CSSProperties & Record<`--${string}`, string>;

const round = (value: number) => Math.round(value * 100) / 100;
const t = (locale: Locale, de: string, en: string) =>
  locale === "en" ? en : de;

// Deterministic PRNG (mulberry32) seeded from the slug.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

// Font size in container-inline units that keeps condensed caps inside the
// poster: the longest word must fit one line, the text must fit `lines`.
function fit(
  text: string,
  {
    max,
    min,
    lines,
    width = 88,
  }: {
    max: number;
    min: number;
    lines: number;
    width?: number;
  },
): string {
  const glyph = 0.5;
  const longest = Math.max(
    1,
    ...text.split(/\s+/).map((word) => [...word].length),
  );
  const length = Math.max(1, [...text].length);
  const byWord = width / (glyph * longest);
  const byLines = (width * lines) / (glyph * length * 1.12);
  return String(round(Math.max(min, Math.min(max, byWord, byLines))));
}

/* ---------------------------------------------------------------- motifs */

type MotifProps = {
  family: SoundFamily;
  seed: number;
  // "bottom" keeps the lower part of the motif when it is cropped into a band.
  anchor?: "center" | "bottom";
};

function Motif({ family, seed, anchor = "center" }: MotifProps) {
  const next = random(seed);
  const variant = seed % 3;
  const mirror = ((seed >>> 3) & 1) === 1;
  const body = motifs[family](next, variant);
  return (
    <svg
      className="poster-motif"
      viewBox="0 0 100 100"
      preserveAspectRatio={
        anchor === "bottom" ? "xMidYMax slice" : "xMidYMid slice"
      }
      focusable="false"
      aria-hidden="true"
    >
      <g transform={mirror ? "matrix(-1 0 0 1 100 0)" : undefined}>{body}</g>
    </svg>
  );
}

type Next = () => number;

const motifs: Record<SoundFamily, (next: Next, variant: number) => ReactNode> =
  {
    techno(next, variant) {
      if (variant === 1) {
        // Strobe: uneven vertical bars on the right edge.
        const bars: ReactNode[] = [];
        let x = 52;
        let index = 0;
        while (x < 104) {
          const width = round(0.6 + next() * 4.2);
          const lit = index % 3 === 0 || next() > 0.7;
          bars.push(
            <rect
              key={index}
              className={lit ? "fa" : "fm"}
              x={round(x)}
              y={0}
              width={width}
              height={100}
            />,
          );
          x += width + round(1 + next() * 4.5);
          index += 1;
        }
        return bars;
      }
      if (variant === 2) {
        // Four on the floor: four kicks, one held open.
        const open = Math.floor(next() * 4);
        return (
          <>
            <line className="sm hair" x1={0} y1={78} x2={100} y2={78} />
            {[0, 1, 2, 3].map((step) => (
              <circle
                key={step}
                className={step === open ? "sa thick" : "fa"}
                cx={round(19 + step * 21)}
                cy={78}
                r={8.4}
              />
            ))}
          </>
        );
      }
      // Step sequencer: 16 steps, four lanes.
      const lanes = [
        (step: number) => step % 4 === 0,
        (step: number) => step === 4 || step === 12,
        (step: number) => step % 4 === 2,
        () => next() > 0.68,
      ];
      const head = Math.floor(next() * 16);
      const cells: ReactNode[] = [];
      lanes.forEach((lane, row) => {
        for (let step = 0; step < 16; step += 1) {
          const on = lane(step);
          cells.push(
            <rect
              key={`${row}-${step}`}
              className={
                on ? (row === 0 ? "fa" : row === 1 ? "fi" : "fm") : "sm hair"
              }
              x={round(6 + step * 5.5)}
              y={round(64 + row * 6.4)}
              width={4.4}
              height={5}
            />,
          );
        }
      });
      return (
        <>
          {cells}
          <rect
            className="fa"
            x={round(6 + head * 5.5 + 1.9)}
            y={58}
            width={0.6}
            height={34}
          />
        </>
      );
    },
    hard(next, variant) {
      const stripes = (y: number, height: number) => {
        const shapes: ReactNode[] = [
          <rect
            key="band"
            className="fa"
            x={-10}
            y={y}
            width={120}
            height={height}
          />,
        ];
        for (let x = -30; x < 130; x += 7) {
          shapes.push(
            <polygon
              key={x}
              className="fg"
              points={`${x},${y} ${x + 3.4},${y} ${x + 3.4 - height},${y + height} ${x - height},${y + height}`}
            />,
          );
        }
        return shapes;
      };
      if (variant === 1) {
        // Brick-wall compression: bars pressed against the bottom edge.
        const bars: ReactNode[] = [];
        let y = 100;
        let height = 7;
        let index = 0;
        while (y > 50) {
          y -= height;
          bars.push(
            <rect
              key={index}
              className="fa"
              x={0}
              y={round(y)}
              width={100}
              height={round(height)}
            />,
          );
          y -= round(0.8 + next() * 1.2);
          height = Math.max(0.6, height * 0.7);
          index += 1;
        }
        return bars;
      }
      if (variant === 2) {
        return <g transform="rotate(-90 50 50)">{stripes(78, 22)}</g>;
      }
      return (
        <g transform={`rotate(${round(-8 - next() * 8)} 50 70)`}>
          {stripes(64, 16)}
        </g>
      );
    },
    acid(next, variant) {
      const squiggle = (
        base: number,
        amplitude: number,
        period: number,
        phase: number,
      ) => {
        const points: string[] = [];
        for (let x = -6; x <= 106; x += 0.5) {
          const saw = ((((x + phase) % period) + period) % period) / period;
          const ring = Math.exp(-saw * 5) * Math.sin(saw * Math.PI * 2 * 4.5);
          const y = base + amplitude * (saw - 0.5) - amplitude * 0.55 * ring;
          points.push(`${round(x)},${round(y)}`);
        }
        return `M${points.join("L")}`;
      };
      const phase = round(next() * 30);
      if (variant === 1) {
        return [0, 1, 2].map((row) => (
          <path
            key={row}
            className={row === 1 ? "sa thick" : "sa"}
            d={squiggle(56 + row * 13, 9, 24 + row * 4, phase + row * 7)}
          />
        ));
      }
      if (variant === 2) {
        return (
          <g transform="rotate(90 50 50)">
            <path className="sa fat" d={squiggle(18, 16, 30, phase)} />
          </g>
        );
      }
      return <path className="sa fat" d={squiggle(74, 18, 34, phase)} />;
    },
    dub(next, variant) {
      if (variant === 1) {
        // Delay line: one block repeated, each echo quieter.
        const offset = round(next() * 8);
        return Array.from({ length: 8 }, (_, index) => (
          <rect
            key={index}
            className="fa"
            opacity={round(1 - index * 0.12)}
            x={round(-8 + offset + index * 11)}
            y={round(52 + index * 5)}
            width={34}
            height={6}
          />
        ));
      }
      const cx = round(62 + next() * 16);
      const cy = round(64 + next() * 10);
      const drift = variant === 2 ? 3.2 : 0;
      return (
        <>
          {Array.from({ length: 11 }, (_, index) => (
            <circle
              key={index}
              className="sa"
              opacity={round(1 - index * 0.085)}
              cx={round(cx - index * drift)}
              cy={cy}
              r={round(5 + index * 5.2)}
            />
          ))}
          <circle className="fa" cx={cx} cy={cy} r={3} />
        </>
      );
    },
    house(next, variant) {
      if (variant === 1) {
        // Halftone: dots swell toward one corner.
        const dots: ReactNode[] = [];
        const cornerX = next() > 0.5 ? 100 : 0;
        for (let row = 0; row < 12; row += 1) {
          for (let column = 0; column < 12; column += 1) {
            const x = 4 + column * 8.4;
            const y = 4 + row * 8.4;
            const distance = Math.hypot(x - cornerX, y - 100) / 141;
            const r = round(Math.max(0, 3.9 * (1 - distance * 1.35)));
            if (r > 0.25)
              dots.push(
                <circle
                  key={`${row}-${column}`}
                  className="fa"
                  cx={round(x)}
                  cy={round(y)}
                  r={r}
                />,
              );
          }
        }
        return dots;
      }
      // Record: grooves, label, spindle.
      const cx = variant === 2 ? 50 : round(66 + next() * 10);
      const cy = variant === 2 ? 96 : round(66 + next() * 8);
      const grooves: ReactNode[] = [];
      for (let r = 15; r <= 46; r += 1.7) {
        grooves.push(
          <circle
            key={r}
            className="sa hair"
            opacity={0.55}
            cx={cx}
            cy={cy}
            r={round(r)}
          />,
        );
      }
      return (
        <>
          <circle className="fd" cx={cx} cy={cy} r={47} />
          {grooves}
          <circle className="fa" cx={cx} cy={cy} r={12} />
          <circle className="fg" cx={cx} cy={cy} r={1.4} />
        </>
      );
    },
    electro(next, variant) {
      const grid: ReactNode[] = [];
      for (let x = 10; x < 100; x += 10)
        grid.push(
          <line
            key={`x${x}`}
            className="sm hair"
            x1={x}
            y1={40}
            x2={x}
            y2={100}
          />,
        );
      for (let y = 40; y <= 100; y += 10)
        grid.push(
          <line
            key={`y${y}`}
            className="sm hair"
            x1={0}
            y1={y}
            x2={100}
            y2={y}
          />,
        );
      const square = (
        base: number,
        amplitude: number,
        period: number,
        duty: number,
      ) => {
        let d = `M-2,${base + amplitude}`;
        const shift = round(next() * period);
        for (let x = -period + shift; x < 104; x += period) {
          const high = round(x + period * duty);
          d += `H${round(x)}V${base - amplitude}H${high}V${base + amplitude}`;
        }
        return `${d}H104`;
      };
      if (variant === 1) {
        return (
          <>
            {grid}
            {[0, 1, 2].map((row) => (
              <path
                key={row}
                className={row === 0 ? "sa thick" : "sa"}
                d={square(56 + row * 15, 4.5, 14 + row * 6, 0.3 + row * 0.2)}
              />
            ))}
          </>
        );
      }
      return (
        <>
          {grid}
          <path
            className="sa thick"
            d={square(72, 12, 22 + Math.floor(next() * 3) * 6, 0.5)}
          />
          {variant === 2 && <path className="sb" d={square(72, 6, 11, 0.5)} />}
        </>
      );
    },
    breaks(next, variant) {
      const bars: ReactNode[] = [];
      const rows = 7;
      for (let row = 0; row < rows; row += 1) {
        let x = -next() * 20;
        let index = 0;
        while (x < 100) {
          const width = round(4 + next() * 18);
          const tone = next();
          if (tone > 0.18)
            bars.push(
              <rect
                key={`${row}-${index}`}
                className={tone > 0.72 ? "fb" : "fa"}
                x={round(x)}
                y={round(52 + row * 6.8)}
                width={width}
                height={5}
              />,
            );
          x += width + round(0.8 + next() * 3);
          index += 1;
        }
      }
      if (variant === 1)
        return <g transform="rotate(-90 50 50) translate(0 -8)">{bars}</g>;
      if (variant === 2) return <g transform="skewX(-14)">{bars}</g>;
      return bars;
    },
    trance(next, variant) {
      const vx = round(35 + next() * 30);
      const vy = 60;
      if (variant === 1) {
        // Tunnel: frames closing in on the vanishing point.
        return Array.from({ length: 10 }, (_, index) => {
          const scale = Math.pow(0.72, index);
          return (
            <rect
              key={index}
              className="sa"
              opacity={round(0.35 + scale * 0.65)}
              x={round(vx - (vx + 4) * scale)}
              y={round(vy - (vy - 30) * scale)}
              width={round(108 * scale)}
              height={round(78 * scale)}
            />
          );
        });
      }
      const rays: ReactNode[] = [];
      const count = 26;
      for (let index = 0; index <= count; index += 1) {
        const x = -40 + (180 / count) * index;
        rays.push(
          <line
            key={index}
            className="sa hair"
            x1={vx}
            y1={vy}
            x2={round(x)}
            y2={104}
          />,
        );
      }
      for (let step = 1; step < 8; step += 1) {
        const y = round(vy + Math.pow(step / 7, 2.2) * 44);
        rays.push(
          <line
            key={`h${step}`}
            className="sa hair"
            x1={0}
            y1={y}
            x2={100}
            y2={y}
          />,
        );
      }
      return (
        <>
          {rays}
          <line className="si" x1={0} y1={vy} x2={100} y2={vy} />
          {variant === 2 && <circle className="fa" cx={vx} cy={vy} r={2.2} />}
        </>
      );
    },
    ambient(next, variant) {
      if (variant === 1) {
        const x = round(70 + next() * 16);
        return (
          <>
            <line className="sm hair" x1={x} y1={0} x2={x} y2={100} />
            <circle
              className="fa"
              cx={x}
              cy={round(62 + next() * 20)}
              r={1.6}
            />
          </>
        );
      }
      const lines = [61.8, 76.4, 85.4, 90.9].map((y, index) => {
        const start = round(next() * 30 + index * 6);
        return (
          <line
            key={y}
            className="sm hair"
            x1={start}
            y1={y}
            x2={round(start + 30 + next() * 50)}
            y2={y}
          />
        );
      });
      return (
        <>
          {lines}
          <circle
            className={variant === 2 ? "fa" : "sa"}
            cx={round(64 + next() * 20)}
            cy={round(52 + next() * 8)}
            r={variant === 2 ? 2.2 : 5}
          />
        </>
      );
    },
  };

/* -------------------------------------------------------------- pieces */

function Registration() {
  return (
    <>
      <span className="poster-reg reg-tl" />
      <span className="poster-reg reg-tr" />
      <span className="poster-reg reg-bl" />
      <span className="poster-reg reg-br" />
    </>
  );
}

function Stamp({ locale }: { locale: Locale }) {
  const word = t(locale, "Abgesagt", "Cancelled");
  return (
    <div className="poster-stamp">
      <span>{word}</span>
    </div>
  );
}

/* --------------------------------------------------------------- event */

export function EventPoster({
  facts,
  hero = false,
}: {
  facts: PosterFacts;
  hero?: boolean;
}) {
  const { title, lineup, when, locale } = facts;
  const count = lineup.length;
  const shape =
    count === 0 ? "none" : count === 1 ? "solo" : count <= 4 ? "few" : "many";
  const run = lineup.join(" · ");
  const longestName = lineup.reduce(
    (longest, name) => (name.length > longest.length ? name : longest),
    "",
  );
  const vars: Vars = {
    "--title-card": fit(title, {
      max: count ? 12 : 15,
      min: 4.6,
      lines: count ? 2.4 : 3.4,
    }),
    "--title-hero": fit(title, {
      max: count >= 5 ? 10 : count ? 12 : 16,
      min: 4.6,
      lines: count >= 5 ? 2.6 : 3,
    }),
    "--name-hero":
      shape === "solo"
        ? fit(longestName, { max: 19, min: 6, lines: 1.8 })
        : shape === "few"
          ? fit(longestName, { max: 9.5, min: 5, lines: 1 })
          : fit(run, { max: 6.4, min: 3.6, lines: 4.2 }),
  };
  const shown = lineup.slice(0, 3);
  const more = count - shown.length;
  const place = [facts.venue, facts.city].filter(Boolean).join(" · ");

  return (
    <div
      className={`poster poster-event fam-${facts.family}${hero ? " poster-hero" : ""}${facts.cancelled ? " is-cancelled" : ""}`}
      style={vars}
    >
      <Motif family={facts.family} seed={facts.seed} />
      <Registration />
      {facts.cancelled && <Stamp locale={locale} />}
      <div className="poster-body">
        <div className="poster-head">
          <span className="poster-mark">EVRYVIBE</span>
          {facts.genres[0] && (
            <span className="poster-sound">{facts.genres[0]}</span>
          )}
          {when && (
            <span className="poster-date">
              {when.dateLabel}
              <span className="poster-date-time"> · {when.timeLabel}</span>
            </span>
          )}
        </div>
        {when && (
          <div className="poster-tile">
            <span className="poster-day">{when.day}</span>
            <span className="poster-dow">
              <span>{when.weekday}</span>
              <span>{when.month}</span>
              <span className="poster-tile-time">{when.timeLabel}</span>
            </span>
          </div>
        )}
        <div className="poster-title">{title}</div>
        {count > 0 && (
          <>
            <div className="poster-lineup-card">
              {shown.map((name, index) => (
                <span key={`${name}-${index}`}>{name}</span>
              ))}
              {more > 0 && <span className="poster-more">+{more}</span>}
            </div>
            <div className={`poster-lineup-hero lineup-${shape}`}>
              {shape === "many" ? (
                <p>{run}</p>
              ) : (
                lineup.map((name, index) => (
                  <span key={`${name}-${index}`}>{name}</span>
                ))
              )}
            </div>
          </>
        )}
        <div className="poster-foot">
          {place && <span className="poster-place">{place}</span>}
          {facts.genres.length > 1 && (
            <span className="poster-genres">{facts.genres.join(" / ")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- tile */

// A square of the sound motif beside venue and DJ names: the poster
// language as an identity mark, without repeating the name in big type.
export function SoundTile({
  family,
  seed,
}: {
  family: SoundFamily;
  seed: number;
}) {
  return (
    <div className={`poster sound-tile fam-${family}`} aria-hidden="true">
      <Motif family={family} seed={seed} />
    </div>
  );
}
