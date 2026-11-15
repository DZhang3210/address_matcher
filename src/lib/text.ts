import type { AddressRecord } from "../types";

const ABBREV: Record<string, string> = {
  st: "street", str: "strasse", "straße": "strasse", ave: "avenue", av: "avenue", blvd: "boulevard",
  rd: "road", dr: "drive", pl: "place", lp: "loop", ln: "lane", ct: "court", hwy: "highway",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
  apt: "unit", "#": "unit", ste: "unit", suite: "unit", saint: "street", // "St" is ambiguous; collapse both
  one: "1", fifth: "5th", sixth: "6th", ninth: "9th", cdmx: "ciudad de mexico", uk: "united kingdom",
};

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** Lower-case, strip accents and punctuation, expand abbreviations. */
export function normTokens(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/#/g, " # ")
    .replace(/[.,]/g, " ")
    .replace(/([a-z])-([a-z])/g, "$1 $2"); // split hyphenated words, keep "37-12"
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    out.push(...(ABBREV[raw] ?? raw).split(" "));
  }
  return out;
}

export function tokenSet(r: AddressRecord): Set<string> {
  return new Set(normTokens(r.lines.join(" ")));
}

/** True if a raw word (after normalizing) has any part the other record lacks. */
export function wordDiffers(word: string, other: Set<string>): boolean {
  const parts = normTokens(word);
  return parts.length > 0 && parts.some((p) => !other.has(p));
}

/** Short "what differs" line for pairs with no hand-written explanation. */
export function diffSummary(a: AddressRecord, b: AddressRecord): string {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  const onlyA = [...ta].filter((t) => !tb.has(t)).slice(0, 4);
  const onlyB = [...tb].filter((t) => !ta.has(t)).slice(0, 4);
  if (!onlyA.length && !onlyB.length) return "After normalizing, every word matches.";
  if (onlyA.length && onlyB.length) return `Differs on "${onlyA.join(" ")}" vs "${onlyB.join(" ")}".`;
  return `Only one side has "${[...onlyA, ...onlyB].join(" ")}".`;
}

/** Deterministic 0..1 from a string, for stable placeholder numbers. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
