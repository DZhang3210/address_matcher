import type { AddressPair, Difficulty } from "../types";
import { hash } from "../lib/text";

/*
 * "Players" votes. There's no backend yet, so each pair starts from a made-up
 * baseline (harder pairs fool more people) and your own answers from this
 * browser are added on top. Swap readVotes/addVote for a real API later.
 */

const VOTES_KEY = "same-place:votes";
const BASE_RIGHT: Record<Difficulty, number> = { easy: 0.86, medium: 0.66, hard: 0.48, absurd: 0.34 };

type Tally = Record<string, { same: number; diff: number }>;

function readVotes(): Tally {
  try {
    return JSON.parse(localStorage.getItem(VOTES_KEY) ?? "{}") as Tally;
  } catch {
    return {};
  }
}

export function addVote(pairId: string, saidSame: boolean) {
  try {
    const t = readVotes();
    const v = (t[pairId] ??= { same: 0, diff: 0 });
    if (saidSame) v.same++;
    else v.diff++;
    localStorage.setItem(VOTES_KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable: fine */
  }
}

export interface Crowd {
  same: number;
  diff: number;
  total: number;
  /** Did the majority get it right? */
  majorityRight: boolean;
  /** Share of players who answered correctly. */
  rightShare: number;
}

export function crowdFor(pair: AddressPair): Crowd {
  const n = 60 + Math.floor(hash("n" + pair.id) * 340);
  const p = Math.min(0.97, Math.max(0.12, BASE_RIGHT[pair.difficulty] + (hash("p" + pair.id) - 0.5) * 0.24));
  const right = Math.round(n * p);
  let same = pair.isMatch ? right : n - right;
  let diff = n - same;
  const mine = readVotes()[pair.id];
  if (mine) {
    same += mine.same;
    diff += mine.diff;
  }
  const total = same + diff;
  const rightCount = pair.isMatch ? same : diff;
  return { same, diff, total, majorityRight: rightCount > total / 2, rightShare: rightCount / total };
}
