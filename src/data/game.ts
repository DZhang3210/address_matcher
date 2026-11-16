import type { AddressPair, Difficulty } from "../types";
import data from "./game_pairs.json";

/*
 * The real game data: Connecticut test pairs (Overture × Foursquare, case2s dataset) with every
 * trained model's P(same), exported by ml-geocoding/geocoding_ml/address_matcher/build_address_matcher_dataset.ipynb.
 * To refresh: re-run that notebook and copy its game_pairs.json over ./game_pairs.json.
 *
 * Shape: models[] (id, name, threshold) + pairs[] whose `probs` keys are the foreign key into models[].id.
 */

export interface ExportedModel {
  id: string;
  name: string;
  threshold: number;
}

export interface ExportedPair {
  pair_id: string;
  address_a: string;
  address_b: string;
  label: number;
  neg_type: string;
  probs: Record<string, number>;
  llm_reasoning: string;
}

export const EXPORTED_MODELS: ExportedModel[] = data.models;
const EXPORTED_PAIRS: ExportedPair[] = data.pairs;

/** P(same) and the model's own answer, by model id then pair id. */
export const EXPORTED_PROBS: Record<string, Record<string, number>> = Object.fromEntries(
  EXPORTED_MODELS.map((m) => [m.id, Object.fromEntries(EXPORTED_PAIRS.map((p) => [p.pair_id, p.probs[m.id]]))])
);
export const LLM_REASONING: Record<string, string> = Object.fromEntries(
  EXPORTED_PAIRS.map((p) => [p.pair_id, p.llm_reasoning])
);

const TRAP: Record<string, string | undefined> = {
  case2s: "Look-alike street",
  case2: "Different street, same number",
};

/** Difficulty = how many of the exported models get the pair wrong (0 easy · 1–2 medium · 3–4 hard · all absurd). */
function difficulty(p: ExportedPair): Difficulty {
  const wrong = EXPORTED_MODELS.filter((m) => (p.probs[m.id] >= m.threshold) !== (p.label === 1)).length;
  if (wrong === 0) return "easy";
  if (wrong === EXPORTED_MODELS.length) return "absurd";
  return wrong <= 2 ? "medium" : "hard";
}

export const PAIRS: AddressPair[] = EXPORTED_PAIRS.map((p) => ({
  id: p.pair_id,
  a: { lines: [p.address_a] },
  b: { lines: [p.address_b] },
  isMatch: p.label === 1,
  difficulty: difficulty(p),
  trap: TRAP[p.neg_type],
}));
