import type { AddressPair, Difficulty, ModelPrediction } from "../types";
import { tokenSet } from "../lib/text";
import { EXPORTED_MODELS, EXPORTED_PROBS, LLM_REASONING, PAIRS } from "./game";

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

/* ---------- Trained models: P(same) precomputed in the Python project (./game.ts) ---------- */

const SHORT: Record<string, string> = { xgb: "XGBoost", siamese: "Siamese", esim: "ESIM", bi: "Bi-encoder", cross: "Cross-encoder", llm: "LLM" };

/** A model whose answers come from the exported probabilities. */
function exported(id: string): (pair: AddressPair) => ModelPrediction {
  const threshold = EXPORTED_MODELS.find((m) => m.id === id)!.threshold;
  return (pair) => {
    const score = EXPORTED_PROBS[id][pair.id];
    const match = score >= threshold;
    let reason: string | undefined;
    if (id === "llm") {
      // The stored sentence follows the model's YES/NO; put its own answer back in front.
      const r = (LLM_REASONING[pair.id] ?? "").trim();
      reason = r ? `"${match ? "Yes" : "No"}, ${r.charAt(0).toLowerCase()}${r.slice(1)}"` : undefined;
    }
    return { match, confidence: match ? score : 1 - score, score, threshold, reason };
  };
}

const GUIDES: Record<string, Pick<Model, "blurb" | "guide">> = {
  xgb: {
    blurb: "Gradient-boosted trees over 23 hand-built similarity features.",
    guide: {
      how: "Never reads the addresses directly. Each pair becomes 23 similarity scores (Jaro-Winkler, Levenshtein and others on the house number, the street and the ZIP, plus house-number and missing-number flags). 100 small decision trees are added up, each one fixing the previous trees' errors, and a sigmoid turns the sum into P(same).",
      goodAt: [
        "House-number mismatches: a different number is a strong feature",
        "Look-alike streets, when the number and ZIP agree but the street score dips",
        "Fast and deterministic: one run, no seeds",
      ],
      badAt: [
        "Rewrites no feature captures: a plaza name instead of a street, extra suite or directions text",
        "Anything where both strings are similar overall but one word decides it",
      ],
    },
  },
  siamese: {
    blurb: "A character-level BiLSTM reads each address on its own; the two vectors are compared.",
    guide: {
      how: "Reads each address one character at a time: every character gets a small learned vector, a BiLSTM reads the sequence in both directions, and the mean over all characters becomes one vector per address. The same encoder handles both addresses, and a small head compares the two vectors. Trained from scratch on Connecticut pairs; mean of 3 seeds.",
      goodAt: [
        "Typos and abbreviations: it reads characters, so no word is ever unknown",
        "Different house numbers",
      ],
      badAt: [
        "Look-alike streets: like the bi-encoder, two similar strings become two similar vectors",
        "Small model, no pretraining: it knows only what the training pairs showed it",
      ],
    },
  },
  esim: {
    blurb: "A word-level cross-attention model (ESIM) on fastText vectors, reproduced from the address-matching literature.",
    guide: {
      how: "FastText vectors for each word (built from character n-grams, so every word gets one), a BiLSTM over each address, then soft attention that lines every word of A up with its best match in B. The aligned pairs are compared, pooled and fed to a small classifier. Trained from scratch on Connecticut pairs; the probability shown is the mean of 3 training seeds.",
      goodAt: [
        "Lining up the same words in a different order or format",
        "Typos and rare words: fastText builds their vectors from pieces of the word",
      ],
      badAt: [
        "Look-alike street names: it rejects fewer of them than the cross-encoder",
        "Different house numbers: it lets through slightly more than the other trained models",
      ],
    },
  },
  bi: {
    blurb: "Pretrained DistilBERT reads each address on its own; the two vectors are compared.",
    guide: {
      how: "A siamese set-up: the same DistilBERT encoder turns each address into one vector (mean of its token vectors), and a small head compares the two vectors. The addresses never see each other inside the encoder. Fine-tuned on Connecticut pairs; mean of 3 seeds.",
      goodAt: [
        "Finding true matches written very differently (the highest found rate of all models)",
        "Abbreviations and formatting, from pretraining",
      ],
      badAt: [
        "Look-alike streets: two similar addresses become two similar vectors, so it says same",
        "Fine, single-character differences get averaged away",
      ],
    },
  },
  cross: {
    blurb: "Pretrained DistilBERT reads both addresses together, attending across them.",
    guide: {
      how: "Both addresses go into DistilBERT as one sequence ([CLS] A [SEP] B [SEP]), so attention compares their words directly in every layer. Mean and max pooling over all tokens feed a small classifier. Fine-tuned on Connecticut pairs; mean of 3 seeds.",
      goodAt: [
        "Rejecting look-alike streets: it sees both spellings side by side",
        "Pairs where one side has no house number",
      ],
      badAt: [
        "Strict: it misses more of the real but messy matches than the bi-encoder",
        "Slow: every pair needs its own forward pass",
      ],
    },
  },
  llm: {
    blurb: "A general LLM asked \"same location?\" with no training on this task.",
    guide: {
      how: "A general-purpose OpenAI model, prompted with both addresses and asked to answer YES or NO, then give one sentence of reasoning. P(same) comes from the probabilities it put on the YES and NO tokens. No task-specific training. The reasoning is written after the answer, so it's a justification, not how it decided.",
      goodAt: [
        "World knowledge: plazas, landmarks, descriptions instead of street addresses",
        "Explaining itself, sometimes convincingly when it's wrong",
      ],
      badAt: [
        "Can read a one-letter street difference as a typo",
        "Cost and speed: an API call per pair",
      ],
    },
  },
};

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
    id: "xgb",
    name: EXPORTED_MODELS.find((x) => x.id === "xgb")!.name,
    short: SHORT["xgb"],
    placeholder: false,
    ...GUIDES["xgb"],
    predict: exported("xgb"),
  },
  {
    id: "siamese",
    name: EXPORTED_MODELS.find((x) => x.id === "siamese")!.name,
    short: SHORT["siamese"],
    placeholder: false,
    ...GUIDES["siamese"],
    predict: exported("siamese"),
  },
  {
    id: "esim",
    name: EXPORTED_MODELS.find((x) => x.id === "esim")!.name,
    short: SHORT["esim"],
    placeholder: false,
    ...GUIDES["esim"],
    predict: exported("esim"),
  },
  {
    id: "bi",
    name: EXPORTED_MODELS.find((x) => x.id === "bi")!.name,
    short: SHORT["bi"],
    placeholder: false,
    ...GUIDES["bi"],
    predict: exported("bi"),
  },
  {
    id: "cross",
    name: EXPORTED_MODELS.find((x) => x.id === "cross")!.name,
    short: SHORT["cross"],
    placeholder: false,
    ...GUIDES["cross"],
    predict: exported("cross"),
  },
  {
    id: "llm",
    name: EXPORTED_MODELS.find((x) => x.id === "llm")!.name,
    short: SHORT["llm"],
    placeholder: false,
    ...GUIDES["llm"],
    predict: exported("llm"),
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
