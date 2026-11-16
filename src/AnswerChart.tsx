import type { CSSProperties, ReactNode } from "react";
import { MODELS, PREDICTIONS, type Model } from "./data/models";
import type { AddressPair } from "./types";

/*
 * How everyone else answered, as one dense chart. Each model row is a bar:
 *   - the bar is that model's P(same), 0 → 1, and the number at the end is the same P(same)
 *   - the tick is its threshold: past the tick it says =, short of it ≠
 * Bar, dot and the ✓ / ✗ are green when the model got the pair right, red when wrong,
 * so green and red never mean anything but right and wrong. Only the LLM gets a line of text.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Row {
  id: string;
  name: string;
  opponent?: boolean;
  score: number;
  threshold: number;
  saidSame: boolean;
  right: boolean;
  /** Text at the end of the row. */
  value: ReactNode;
  tip: ReactNode;
  quote?: string;
}

function logit(p: number) {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
}

function modelRow(m: Model, pair: AddressPair, opponentId?: string): Row {
  const p = PREDICTIONS[m.id][pair.id];
  // Shown inline: P(same), the same number the bar shows.
  const num = pct(p.score);
  let tip: ReactNode;
  if (m.id === "token-overlap") {
    tip = p.reason;
  } else if (m.id === "llm") {
    tip = (
      <>
        P(same) = <b>{p.score.toFixed(2)}</b> · answers SAME only above <b>{p.threshold.toFixed(2)}</b>
      </>
    );
  } else {
    const z = logit(p.score);
    tip = (
      <>
        logit z = <b>{z >= 0 ? "+" : ""}{z.toFixed(2)}</b> → P(same) = <b>{p.score.toFixed(2)}</b> · threshold{" "}
        {p.threshold.toFixed(2)}
      </>
    );
  }
  return {
    id: m.id,
    name: m.name,
    opponent: m.id === opponentId,
    score: p.score,
    threshold: p.threshold,
    saidSame: p.match,
    right: p.match === pair.isMatch,
    value: (
      <>
        <span className="ans">{p.match ? "=" : "≠"}</span> <span className="ac-num">{num}</span>
      </>
    ),
    tip,
    quote: m.id === "llm" ? p.reason : undefined,
  };
}

export function AnswerChart({ pair, opponent }: { pair: AddressPair; opponent?: Model }) {
  const models = opponent ? [opponent, ...MODELS.filter((m) => m.id !== opponent.id)] : MODELS;

  const rows: Row[] = models.map((m) => modelRow(m, pair, opponent?.id));

  return (
    <div className="answer-chart" aria-label="How others answered">
      {rows.map((r) => {
        const style = { "--s": `${r.score * 100}%`, "--t": `${r.threshold * 100}%` } as CSSProperties;
        return (
          <div key={r.id} className={"ac-row " + (r.right ? "ok" : "bad") + (r.opponent ? " opp" : "")} tabIndex={0}>
            <span className="ac-mark" aria-label={r.right ? "right" : "wrong"}>
              {r.right ? "✓" : "✗"}
            </span>
            <span className="ac-name" title={r.opponent ? `${r.name} (your opponent)` : r.name}>
              {r.name}
            </span>
            <span className="ac-track" style={style}>
              <span className="ac-bar" />
              <span className="ac-thr" />
              <span className="ac-dot" />
            </span>
            <span className="ac-val">{r.value}</span>
            {r.quote && <span className="ac-quote">{r.quote}</span>}
            <span className="ac-tip" role="tooltip">
              {r.tip}
            </span>
          </div>
        );
      })}
      <div className="ac-legend" aria-hidden>
        <span>
          <i className="lg-bar" /> P(same): green = model right, red = wrong
        </span>
        <span>
          <i className="lg-thr" /> its threshold: past it means =, short of it ≠
        </span>
      </div>
    </div>
  );
}
