import type { AddressPair, Difficulty, ModelPrediction } from "../types";
import { hash, tokenSet } from "../lib/text";
import { PAIRS } from "./pairs";

export interface Model {
  id: string;
  /** Full display name. */
  name: string;
  /** Short name for tabs and "Beat the ___". */
  short: string;
  /** One line on how it works. */
  blurb: string;
  /** true = predictions are hand-written placeholders, not a real run. */
  placeholder: boolean;
  guide: { how: string; goodAt: string[]; badAt: string[] };
  predict: (pair: AddressPair) => ModelPrediction;
}

/* ---------- Real baseline: normalized token overlap, runs in the browser ---------- */

const THRESHOLD = 0.75;

function tokenOverlap(pair: AddressPair): ModelPrediction {
  const a = tokenSet(pair.a);
  const b = tokenSet(pair.b);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  // Overlap coefficient: share of the shorter address found in the longer one,
  // so a record that just omits the ZIP or city isn't punished.
  const overlap = inter / (Math.min(a.size, b.size) || 1);
  const match = overlap >= THRESHOLD;
  // Confidence grows with distance from the threshold.
  const dist = match ? (overlap - THRESHOLD) / (1 - THRESHOLD) : (THRESHOLD - overlap) / THRESHOLD;
  const onlyA = [...a].filter((t) => !b.has(t)).slice(0, 3);
  const onlyB = [...b].filter((t) => !a.has(t)).slice(0, 3);
  const diffs =
    onlyA.length && onlyB.length
      ? `"${onlyA.join(" ")}" vs "${onlyB.join(" ")}"`
      : onlyA.length || onlyB.length
        ? `extra: "${[...onlyA, ...onlyB].join(" ")}"`
        : "no differing words";
  return {
    match,
    confidence: 0.5 + 0.5 * Math.min(1, dist),
    score: overlap,
    threshold: THRESHOLD,
    reason: `${Math.round(overlap * 100)}% of words shared (needs 75%). ${diffs}.`,
  };
}

/* ---------- Placeholder models: hand-picked misses until real runs exist ---------- */

type Explain = (trap: string, saidMatch: boolean, wrong: boolean) => string;

/**
 * Builds a fake model that gets everything right except the listed pair ids.
 * `threshold` is where its score flips from "different" to "same".
 */
function placeholder(seed: string, misses: string[], explain: Explain, threshold = 0.5) {
  const miss = new Set(misses);
  return (pair: AddressPair): ModelPrediction => {
    const r = hash(seed + pair.id);
    const wrong = miss.has(pair.id);
    const match = wrong ? !pair.isMatch : pair.isMatch;
    const confidence = wrong ? 0.55 + 0.3 * r : 0.72 + 0.27 * r;
    // Place the score on the right side of the threshold, further away when more confident.
    const push = (confidence - 0.5) * 2; // 0..1
    const score = match ? threshold + (1 - threshold) * push : threshold - threshold * push;
    return {
      match,
      confidence,
      score,
      threshold,
      reason: explain((pair.trap ?? "difference").toLowerCase(), match, wrong),
    };
  };
}

export const MODELS: Model[] = [
  {
    id: "token-overlap",
    name: "Token overlap",
    short: "Token overlap",
    blurb: "Expands abbreviations, then checks how much of the shorter address appears in the longer one.",
    placeholder: false,
    guide: {
      how: "Lower-cases both addresses, strips accents and punctuation, and expands abbreviations (St → street, Fifth → 5th, Apt → unit). Then it asks what share of the shorter address's words also appear in the longer one. 75% or more means same. No training, no knowledge, a few lines of code. It runs live in your browser.",
      goodAt: [
        "Formatting noise: abbreviations, punctuation, capitalization",
        "One record leaving out the ZIP, city, or country",
        "Small typos in long addresses (one bad word out of eight still clears 75%)",
      ],
      badAt: [
        "Differences of one word that matter: N vs S, Apt 4B vs 4D, Road vs Drive",
        "Anything translated, reordered into another language, or in another script",
        "Aliases: vanity addresses, renamed streets, corner buildings",
      ],
    },
    predict: tokenOverlap,
  },
  {
    id: "logreg",
    name: "Logistic regression",
    short: "Logistic regression",
    blurb: "A dozen hand-built similarity features, weighted by a model trained on labeled pairs.",
    placeholder: true,
    guide: {
      how: "Turns each pair into a dozen hand-built features (house numbers equal, street-name edit distance, same city, same ZIP, unit present on both sides) and learns a weight for each from labeled pairs. The output is a probability; above 0.5 means same. It's fast and explainable, and it only knows what its features can see.",
      goodAt: [
        "Weighting the parts that matter: house number and ZIP count more than filler words",
        "Different cities or states that share a street name",
        "Unit and ZIP+4 noise, once those are features",
      ],
      badAt: [
        "Anything no feature captures: grid addresses, ½ and \"bis\" numbers, transposed digits",
        "Aliases and renames, which look like total mismatches",
        "Non-Latin scripts, where every string feature reads zero",
      ],
    },
    predict: placeholder(
      "lr",
      ["directional-ns", "slc-grid", "fraction", "transposed", "vanity-wtc", "sherlock", "toc-hot-springs",
        "seoul-cityhall", "salesforce", "tokyo-station", "bis", "ninth"],
      (t, said, wrong) => {
        if (!wrong) return said ? "Number, street and city features agree." : `A mismatch feature fired (${t}).`;
        return said
          ? `Similarity features all high; nothing flags ${t}.`
          : "Low string similarity outweighed the matching number.";
      }
    ),
  },
  {
    id: "transformer",
    name: "Transformer",
    short: "Transformer",
    blurb: "A small pretrained transformer fine-tuned to read both addresses together.",
    placeholder: true,
    guide: {
      how: "A small pretrained transformer fine-tuned as a cross-encoder. Both addresses go in as one sequence, attention lines up tokens across the two, and a classifier on top says same or different. It learns formatting rules from data instead of a hand-written list.",
      goodAt: [
        "Translation and reordering: Calle Mayor 10 vs 10 Mayor St",
        "Directionals and unit numbers, which it learns are decisive",
        "Formatting it has never seen spelled out in a rule",
      ],
      badAt: [
        "Facts it would have to know: vanity addresses, renamed towns, corner buildings",
        "Local systems: Salt Lake's grid, Puerto Rico's urbanizaciones, Korea's two address schemes",
        "Anything rare in its training data",
      ],
    },
    predict: placeholder(
      "tf",
      ["vanity-wtc", "slc-grid", "sherlock", "toc-hot-springs", "lake-shore", "urbanizacion", "seoul-cityhall",
        "salesforce", "bis"],
      (t, said, wrong) => {
        if (!wrong) return said ? "Tokens align after attention; same place." : `Attends to a conflicting token (${t}).`;
        return said
          ? `High similarity; never learned to weigh ${t}.`
          : `Surface forms too far apart; no training signal for ${t}.`;
      }
    ),
  },
  {
    id: "llm",
    name: "LLM (zero-shot)",
    short: "LLM",
    blurb: "A general LLM asked \"same address?\" with no training on this task.",
    placeholder: true,
    guide: {
      how: "A general-purpose large language model, prompted with both records and the question \"Do these refer to the same address?\" It's told to answer SAME only when it's at least 80% sure. No task-specific training. It brings world knowledge but no particular care for a single character.",
      goodAt: [
        "World knowledge: vanity addresses, renamed towns and streets, famous buildings",
        "Any language or script",
        "Explaining itself, sometimes convincingly when it's wrong",
      ],
      badAt: [
        "Being too forgiving: treats a different unit, transposed digits, or a ½ as a typo",
        "Cost and speed: thousands of times slower per pair than the others",
        "Consistency: the same pair can get a different answer on a rerun",
      ],
    },
    predict: placeholder(
      "llm",
      ["unit-diff", "transposed", "fraction", "bis", "urbanizacion", "esb-zip"],
      (t, said, wrong) => {
        if (!wrong) return said ? `"Same place. The ${t} explains the difference."` : `"Different. The ${t} changes the location."`;
        return said
          ? `"Probably the same; the ${t} looks like a formatting variation."`
          : `"These look like different places."`;
      },
      0.8 // prompted to answer SAME only when at least 80% sure
    ),
  },
];

export const MODEL_BY_ID: Record<string, Model> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

/** Precomputed so the UI can look predictions up by model and pair. */
export const PREDICTIONS: Record<string, Record<string, ModelPrediction>> = Object.fromEntries(
  MODELS.map((m) => [m.id, Object.fromEntries(PAIRS.map((p) => [p.id, m.predict(p)]))])
);

export function isRight(modelId: string, pair: AddressPair): boolean {
  return PREDICTIONS[modelId][pair.id].match === pair.isMatch;
}

/** Share of pairs a model gets right, optionally only at one difficulty. */
export function accuracy(modelId: string, difficulty?: Difficulty): number {
  const ps = difficulty ? PAIRS.filter((p) => p.difficulty === difficulty) : PAIRS;
  return ps.filter((p) => isRight(modelId, p)).length / (ps.length || 1);
}
