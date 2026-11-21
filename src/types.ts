export type Difficulty = "easy" | "medium" | "hard";

/** One side of a comparison. Shaped so real Overture / Foursquare rows can map onto it later. */
export interface AddressRecord {
  /** Display lines, top to bottom, exactly as the source has them. */
  lines: string[];
  /** Optional place name, if the source record has one. */
  name?: string;
}

/** A model's guess for a pair. */
export interface ModelPrediction {
  match: boolean;
  confidence: number; // 0..1
  /** The model's raw "how same is it" score, 0..1. It says same iff score >= threshold. */
  score: number;
  threshold: number;
  /** One line on why it answered that way. */
  reason?: string;
}

export interface AddressPair {
  id: string;
  a: AddressRecord; // e.g. Overture
  b: AddressRecord; // e.g. Foursquare
  isMatch: boolean;
  difficulty: Difficulty;
  /** Short label for what makes this pair tricky. Optional: real data won't have one. */
  trap?: string;
  /** Shown after the player answers. Optional: without it the game shows the computed word diff. */
  explanation?: string;
}
