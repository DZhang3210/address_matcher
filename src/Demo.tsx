import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { DEMO_PAIRS } from "./data/pairs";
import { normTokens, tokenSet } from "./lib/text";
import type { AddressPair, AddressRecord } from "./types";

/*
 * Looping "how to play" demo for the Free play intro, in the spirit of
 * Wordle's how-to-play tiles: each address becomes a row of word tiles that
 * flip one by one and color-code what matches. Then a guess is pressed, a
 * stamp lands with the truth, and the board lifts green (right) or shakes red
 * (wrong). Decorative only; no input.
 */

const SCRIPT: { id: string; guess: boolean }[] = [
  { id: "saint-marks", guess: true }, // spelled differently, still the same: right
  { id: "directional-ns", guess: true }, // one letter apart: wrong
  { id: "madrid", guess: true }, // translated and reordered: right
  { id: "slc-grid", guess: true }, // every word matches and it's still different: wrong
  { id: "sherlock", guess: true }, // 221B is really 239: right
];

type Phase = "hidden" | "reveal" | "pick" | "verdict" | "exit";
type Kind = "match" | "equiv" | "miss";

const TILE_STAGGER = 45; // ms between tile flips
const FLIP = 300; // ms per flip

function tiles(rec: AddressRecord, other: AddressRecord): { word: string; kind: Kind }[] {
  const otherNorm = tokenSet(other);
  const otherRaw = new Set(
    other.lines.join(" ").toLowerCase().replace(/[.,]/g, "").split(/\s+/).filter(Boolean)
  );
  return rec.lines
    .join(" ")
    .replace(/,/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const parts = normTokens(word);
      if (parts.length && parts.some((p) => !otherNorm.has(p))) return { word, kind: "miss" as const };
      const raw = word.toLowerCase().replace(/[.,]/g, "");
      return { word, kind: otherRaw.has(raw) ? ("match" as const) : ("equiv" as const) };
    });
}

function captionFor(phase: Phase, pair: AddressPair, guess: boolean, right: boolean): string {
  if (phase === "hidden" || phase === "reveal") return "Compare the two records word by word…";
  if (phase === "pick") return guess ? "Your guess: same place" : "Your guess: different";
  return right
    ? `Correct! ${pair.trap}.`
    : `Nope. ${pair.trap}: they're ${pair.isMatch ? "the same place" : "different places"}.`;
}

export function Demo() {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("hidden");

  const { id, guess } = SCRIPT[step];
  const pair = DEMO_PAIRS.find((p) => p.id === id)!;
  const rowA = useMemo(() => tiles(pair.a, pair.b), [pair]);
  const rowB = useMemo(() => tiles(pair.b, pair.a), [pair]);
  const right = guess === pair.isMatch;

  useEffect(() => {
    const longest = Math.max(rowA.length, rowB.length);
    const duration: Record<Phase, number> = {
      hidden: 40, // one frame blurred, then everything starts at once
      reveal: longest * TILE_STAGGER + FLIP + 250,
      pick: 180,
      verdict: 1900,
      exit: 320,
    };
    const next: Record<Phase, Phase> = {
      hidden: "reveal",
      reveal: "pick",
      pick: "verdict",
      verdict: "exit",
      exit: "hidden",
    };
    const t = setTimeout(() => {
      if (phase === "exit") setStep((s) => (s + 1) % SCRIPT.length);
      setPhase(next[phase]);
    }, duration[phase]);
    return () => clearTimeout(t);
  }, [phase, rowA.length, rowB.length]);

  const flipped = phase === "reveal" || phase === "pick" || phase === "verdict" || phase === "exit";
  const pressed = phase === "pick" || phase === "verdict" || phase === "exit";
  const verdict = phase === "verdict" || phase === "exit";

  const renderCard = (side: "left" | "right", label: string, row: { word: string; kind: Kind }[]) => (
    <div className={`card demo-card ${side}`}>
      <div className="card-source">{label}</div>
      <div className="tile-wrap">
        {row.map((t, i) => (
          <span
            key={i}
            className={`tile ${t.kind}` + (flipped ? " flip" : "")}
            style={{ "--i": i, "--flip": `${FLIP}ms`, "--stagger": `${TILE_STAGGER}ms` } as CSSProperties}
          >
            {t.word}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <section className="demo-wrap" aria-label="How it works">
      <h2 className="diagram-title">How it works</h2>
      <div className={`demo phase-${phase}` + (verdict ? (right ? " ok" : " bad") : "")} aria-hidden>
        <div className="demo-cards">
          {renderCard("left", "Overture", rowA)}
          <div className="divider">
            <span className={"pick yes" + (pressed && guess ? " pressing" : "")}>
              <span className="sym">=</span>
            </span>
            <span className={"pick no" + (pressed && !guess ? " pressing" : "")}>
              <span className="sym">≠</span>
            </span>
          </div>
          {renderCard("right", "Foursquare", rowB)}
          {verdict && (
            <div className={"stamp " + (pair.isMatch ? "same" : "diff")}>{pair.isMatch ? "Same" : "Different"}</div>
          )}
        </div>
        <p className="demo-caption">
          {verdict && <span className="demo-mark">{right ? "✓" : "✗"}</span>}
          {captionFor(phase, pair, guess, right)}
        </p>
      </div>
      <div className="tile-legend">
        <span>
          <span className="tile match static">word</span> same word
        </span>
        <span>
          <span className="tile equiv static">word</span> same meaning, written differently
        </span>
        <span>
          <span className="tile miss static">word</span> differs
        </span>
      </div>
    </section>
  );
}
