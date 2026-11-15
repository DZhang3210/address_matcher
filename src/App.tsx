import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { PAIRS } from "./data/pairs";
import { MODELS, MODEL_BY_ID, PREDICTIONS, accuracy, isRight, type Model } from "./data/models";
import { addVote, crowdFor } from "./data/crowd";
import { diffSummary } from "./lib/text";
import { AddressCard } from "./AddressCard";
import { ModelDiagram } from "./Diagrams";
import { Demo } from "./Demo";
import { AnswerChart } from "./AnswerChart";
import type { AddressPair, Difficulty } from "./types";

const ROUND_SIZE = 10;
const POINTS: Record<Difficulty, number> = { easy: 100, medium: 150, hard: 200, absurd: 300 };
const DIFFICULTIES = Object.keys(POINTS) as Difficulty[];
const STREAK_BONUS = 25;
const BEST_KEY = "same-place:best";
const TAB_KEY = "same-place:tab";
const LEAVE_MS = 300; // start screen exit animation, before the game builds in

type Phase = "intro" | "playing" | "done";
interface Answer {
  pair: AddressPair;
  guess: boolean;
  correct: boolean;
  points: number;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: fine */
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/* ================================ App shell ================================ */

const TABS = [
  { id: "play", label: "Free play" },
  ...MODELS.map((m) => ({ id: `vs:${m.id}`, label: `Beat ${m.short}` })),
  { id: "models", label: "The models" },
];

export default function App() {
  const [tab, setTabState] = useState(() => {
    const saved = load(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? saved! : "play";
  });
  // Bumped on every navigation so even re-clicking the current tab (or the logo)
  // leaves a round in progress and returns to that tab's start screen.
  const [visit, setVisit] = useState(0);
  const setTab = (id: string) => {
    setTabState(id);
    setVisit((v) => v + 1);
    save(TAB_KEY, id);
    window.scrollTo({ top: 0 });
  };
  const opponent = tab.startsWith("vs:") ? MODEL_BY_ID[tab.slice(3)] : undefined;

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab("play")} title="Back to the start">
          <span className="pin" aria-hidden>
            ⌖
          </span>
          Same Place?
        </button>
        <nav className="tabs" aria-label="Modes">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={"tab" + (t.id === tab ? " active" : "")}
              onClick={() => setTab(t.id)}
              aria-current={t.id === tab ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "models" ? (
        <Guide onChallenge={(id) => setTab(`vs:${id}`)} />
      ) : (
        <Game key={`${tab}:${visit}`} opponent={opponent} />
      )}
    </div>
  );
}

/* ================================== Game ================================== */

function Game({ opponent }: { opponent?: Model }) {
  const bestKey = `${BEST_KEY}:${opponent ? opponent.id : "free"}`;
  const [phase, setPhase] = useState<Phase>("intro");
  const [deck, setDeck] = useState<AddressPair[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [peek, setPeek] = useState(false);
  const [best, setBest] = useState(() => Number(load(bestKey)) || 0);

  const current = deck[index];
  const revealed = answers.length > index;
  const lastAnswer = revealed ? answers[index] : undefined;
  const score = answers.reduce((s, a) => s + a.points, 0);
  const youRight = answers.filter((a) => a.correct).length;
  const oppRight = opponent ? answers.filter((a) => isRight(opponent.id, a.pair)).length : 0;

  const start = useCallback(() => {
    setDeck(shuffle(PAIRS).slice(0, ROUND_SIZE));
    setIndex(0);
    setAnswers([]);
    setStreak(0);
    setBestStreak(0);
    setPeek(false);
    setPhase("playing");
    window.scrollTo({ top: 0 });
  }, []);

  // Start with a short exit animation on the current screen, then build the game in.
  const [leaving, setLeaving] = useState(false);
  const begin = useCallback(() => {
    if (leaving) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return start();
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      start();
    }, LEAVE_MS);
  }, [leaving, start]);

  const answer = useCallback(
    (guess: boolean) => {
      if (!current || revealed) return;
      const correct = guess === current.isMatch;
      const newStreak = correct ? streak + 1 : 0;
      const points = correct ? POINTS[current.difficulty] + STREAK_BONUS * (newStreak - 1) : 0;
      addVote(current.id, guess);
      setStreak(newStreak);
      setBestStreak((b) => Math.max(b, newStreak));
      setAnswers((as) => [...as, { pair: current, guess, correct, points }]);
    },
    [current, revealed, streak]
  );

  const next = useCallback(() => {
    if (!revealed) return;
    setPeek(false);
    if (index + 1 >= deck.length) {
      if (score > best) {
        setBest(score);
        save(bestKey, String(score));
      }
      setPhase("done");
    } else {
      setIndex((i) => i + 1);
    }
  }, [revealed, index, deck.length, score, best, bestKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // Stop Enter/Space from also "clicking" a focused button, which would double-advance.
      if (k === "enter" || k === " ") e.preventDefault();
      if (phase !== "playing") {
        if (k === "enter") begin();
        return;
      }
      if (!revealed) {
        if (k === "y" || k === "arrowleft") answer(true);
        else if (k === "n" || k === "arrowright") answer(false);
      } else if (k === "s") {
        setPeek((p) => !p);
      } else if (k === "enter" || k === " ") {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, revealed, answer, next, begin]);

  if (phase === "intro") return <Intro best={best} onStart={begin} leaving={leaving} opponent={opponent} />;
  if (phase === "done")
    return (
      <Results
        answers={answers}
        score={score}
        best={best}
        bestStreak={bestStreak}
        opponent={opponent}
        onAgain={begin}
        leaving={leaving}
      />
    );
  if (!current) return null;

  const isLast = index + 1 >= deck.length;
  const showOverlay = revealed && !peek;

  return (
    <main className={"play" + (revealed && peek ? " peeking" : "")}>
      <div className="hud">
        {opponent ? (
          <div className="versus-score" aria-label="Head to head">
            <span className="vs-you">You {youRight}</span>
            <span className="vs-dash">–</span>
            <span className="vs-them">
              {oppRight} {opponent.short}
            </span>
          </div>
        ) : null}
        <Stat label="Score" value={score} />
        <Stat label="Streak" value={streak} hot={streak >= 3} />
        <Stat label="Pair" value={`${index + 1}/${deck.length}`} />
      </div>

      <div className="progress" aria-hidden>
        {deck.map((_, i) => (
          <span
            key={i}
            style={{ "--i": i } as CSSProperties}
            className={
              "dot " + (i < answers.length ? (answers[i].correct ? "ok" : "bad") : i === index ? "now" : "")
            }
          />
        ))}
      </div>

      <p className="prompt">
        <span>
          Do these two records point to the <em>same address</em>?
        </span>
        <span className={`diff diff-${current.difficulty}`}>{current.difficulty}</span>
      </p>

      <div className="stage">
        {/* Keyed by pair so each new pair slides in. */}
        <div key={current.id} className={"cards" + (showOverlay ? " dimmed" : "")}>
          <AddressCard source="Overture" record={current.a} other={peek ? current.b : undefined} />
          <div className="divider" role="group" aria-label="Your answer">
            <button
              className={"pick yes" + (lastAnswer?.guess === true ? " chosen" : "")}
              onClick={() => answer(true)}
              disabled={revealed}
              title="Same address (Y or ←)"
            >
              <span className="sym">=</span>
              <span className="pick-label">same</span>
            </button>
            <button
              className={"pick no" + (lastAnswer?.guess === false ? " chosen" : "")}
              onClick={() => answer(false)}
              disabled={revealed}
              title="Different address (N or →)"
            >
              <span className="sym">≠</span>
              <span className="pick-label">diff</span>
            </button>
          </div>
          <AddressCard source="Foursquare" record={current.b} other={peek ? current.a : undefined} />
        </div>

        {revealed && lastAnswer && (
          <Reveal
            answer={lastAnswer}
            opponent={opponent}
            peek={peek}
            onNext={next}
            onPeek={() => setPeek((p) => !p)}
            isLast={isLast}
          />
        )}
      </div>

      {!revealed && (
        <p className="hint">
          <kbd>Y</kbd>/<kbd>←</kbd> same · <kbd>N</kbd>/<kbd>→</kbd> different
        </p>
      )}
    </main>
  );
}

function Stat({ label, value, hot }: { label: string; value: number | string; hot?: boolean }) {
  return (
    <div className={"stat" + (hot ? " hot" : "")}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/* ============================== Result overlay ============================== */

function Reveal({
  answer,
  opponent,
  peek,
  onNext,
  onPeek,
  isLast,
}: {
  answer: Answer;
  opponent?: Model;
  peek: boolean;
  onNext: () => void;
  onPeek: () => void;
  isLast: boolean;
}) {
  const { pair, guess, correct, points } = answer;

  return (
    <div
      className={"reveal " + (correct ? "is-ok" : "is-bad") + (peek ? " peeking" : "")}
      role="dialog"
      aria-live="polite"
    >
      <div className="reveal-main">
        <div className="verdict-line">
          {/* Green/red here means right/wrong only. The answer itself is shown with neutral = / ≠ chips. */}
          <span className="verdict">
            <span className="verdict-sym">{correct ? "✓" : "✗"}</span>
            {correct ? "Correct" : "Nope"}
          </span>
          <span className="points">{correct ? `+${points}` : "+0"}</span>
        </div>
        <p className="truth">
          {!correct && (
            <>
              You said <span className="ans">{guess ? "=" : "≠"}</span> {guess ? "same" : "different"}.{" "}
            </>
          )}
          They're <span className="ans">{pair.isMatch ? "=" : "≠"}</span>{" "}
          <strong>{pair.isMatch ? "the same" : "different"}</strong>.
        </p>
        {pair.trap && <div className="trap">{pair.trap}</div>}
        <div className="reveal-actions">
          <button className="next" onClick={onNext} autoFocus>
            {isLast ? "See results" : "Next pair"} <kbd>Enter</kbd>
          </button>
          <button className="ghost" onClick={onPeek} aria-pressed={peek}>
            {peek ? "Show result" : "Show pair"} <kbd>S</kbd>
          </button>
        </div>
      </div>

      <AnswerChart pair={pair} opponent={opponent} />
    </div>
  );
}

/* ================================== Intro ================================== */

function Intro({
  best,
  onStart,
  leaving,
  opponent,
}: {
  best: number;
  onStart: () => void;
  leaving: boolean;
  opponent?: Model;
}) {
  return (
    <main className={"intro" + (leaving ? " leaving" : "")}>
      {opponent ? (
        <>
          <h1>
            Beat the <span className="hl">{opponent.short}</span>.
          </h1>
          <p className="lede">
            {opponent.blurb} It gets <strong>{pct(accuracy(opponent.id))}</strong> of all pairs right. Can you beat it
            over {ROUND_SIZE}?
            {opponent.placeholder && <span className="lede-note"> (Its answers are placeholders for now.)</span>}
          </p>
        </>
      ) : (
        <>
          <h1>
            Addresses are <span className="hl">weird</span>.
          </h1>
          <p className="lede">
            Two map datasets, two records. Same place or not? You get {ROUND_SIZE} pairs. Harder pairs are worth more,
            and streaks add a bonus.
          </p>
        </>
      )}
      <ul className="legend">
        {DIFFICULTIES.map((d) => (
          <li key={d}>
            <span className={`diff diff-${d}`}>{d}</span> {POINTS[d]} pts
          </li>
        ))}
      </ul>
      <button className={"start" + (leaving ? " pressed" : "")} onClick={onStart}>
        Start <span className="go-arrow">→</span> <kbd>Enter</kbd>
      </button>
      <p className="keys">
        <kbd>Y</kbd>/<kbd>←</kbd> same · <kbd>N</kbd>/<kbd>→</kbd> different · <kbd>S</kbd> show pair
        {best > 0 && <> · best score {best}</>}
      </p>
      {opponent ? <ModelDiagram model={opponent} /> : <Demo />}
    </main>
  );
}

/* ================================= Results ================================= */

function Scoreboard({ answers, opponent }: { answers: Answer[]; opponent?: Model }) {
  const n = answers.length;
  const rows = [
    { id: "you", name: "You", note: "", placeholder: false, right: answers.filter((a) => a.correct).length },
    {
      id: "players",
      name: "Players (majority)",
      note: "What most players answered on each pair.",
      placeholder: true,
      right: answers.filter((a) => crowdFor(a.pair).majorityRight).length,
    },
    ...MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      note: m.blurb,
      placeholder: m.placeholder,
      right: answers.filter((a) => isRight(m.id, a.pair)).length,
    })),
  ].sort((x, y) => y.right - x.right || (x.id === "you" ? -1 : y.id === "you" ? 1 : 0));
  const top = rows[0].right;

  return (
    <section className="board">
      <h2>You vs everyone</h2>
      <p className="board-sub">Same {n} pairs.</p>
      {rows.map((r) => (
        <div
          key={r.id}
          className={"board-row" + (r.id === "you" ? " me" : "") + (r.id === opponent?.id ? " opp" : "")}
        >
          <div className="board-name">
            {r.name}
            {r.right === top && (
              <span className="crown" aria-label="top score">
                ★
              </span>
            )}
            {r.placeholder && <span className="tag">placeholder</span>}
            {r.note && <div className="board-blurb">{r.note}</div>}
          </div>
          <div className="bar">
            <span style={{ width: `${(r.right / n) * 100}%` }} />
          </div>
          <div className="board-score">
            {r.right}/{n}
          </div>
        </div>
      ))}
    </section>
  );
}

function Results({
  answers,
  score,
  best,
  bestStreak,
  opponent,
  onAgain,
  leaving,
}: {
  answers: Answer[];
  score: number;
  best: number;
  bestStreak: number;
  opponent?: Model;
  onAgain: () => void;
  leaving: boolean;
}) {
  const right = answers.filter((a) => a.correct).length;
  const misses = answers.filter((a) => !a.correct);

  let rating: string;
  if (opponent) {
    const theirs = answers.filter((a) => isRight(opponent.id, a.pair)).length;
    rating =
      right > theirs
        ? `You beat the ${opponent.short}, ${right}–${theirs}.`
        : right < theirs
          ? `The ${opponent.short} wins, ${theirs}–${right}.`
          : `Dead heat with the ${opponent.short}, ${right}–${theirs}.`;
  } else {
    rating =
      right === answers.length
        ? "Flawless. You may be a geocoder."
        : right >= 8
          ? "Sharp eye."
          : right >= 5
            ? "Not bad. Addresses are hard."
            : "The addresses won this round.";
  }

  return (
    <main className={"results" + (leaving ? " leaving" : "")}>
      <div className="big">
        {right}
        <span>/{answers.length}</span>
      </div>
      <p className="rating">{rating}</p>
      <div className="hud results-hud">
        <Stat label="Score" value={score} />
        <Stat label="Best streak" value={bestStreak} />
        <Stat label="High score" value={Math.max(best, score)} />
      </div>

      <Scoreboard answers={answers} opponent={opponent} />

      {misses.length > 0 && (
        <section className="misses">
          <h2>What got you</h2>
          {misses.map(({ pair }) => {
            const modelsRight = MODELS.filter((m) => isRight(m.id, pair));
            return (
              <div className="miss" key={pair.id}>
                <div className="miss-pair">
                  <span>{pair.a.lines.join(", ")}</span>
                  <span className="miss-vs">{pair.isMatch ? "=" : "≠"}</span>
                  <span>{pair.b.lines.join(", ")}</span>
                </div>
                <div className="miss-why">
                  {pair.trap && <strong>{pair.trap}. </strong>}
                  {pair.explanation ?? diffSummary(pair.a, pair.b)}
                </div>
                <div className="miss-models">
                  {modelsRight.length === 0
                    ? "No model got this one either."
                    : `Got it right: ${modelsRight.map((m) => m.name).join(", ")}`}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <button className={"start" + (leaving ? " pressed" : "")} onClick={onAgain}>
        Play again <span className="go-arrow">→</span> <kbd>Enter</kbd>
      </button>
    </main>
  );
}

/* ================================== Guide ================================== */

function Guide({ onChallenge }: { onChallenge: (modelId: string) => void }) {
  return (
    <main className="guide">
      <h1>What each model is good at</h1>
      <p className="lede guide-lede">
        Four ways to decide whether two records are the same address, from a few lines of string matching to a large
        language model. Each one is scored below on all {PAIRS.length} pairs in the game. Only Token overlap actually
        runs right now; the other three use placeholder answers until real model runs are plugged in.
      </p>

      <div className="guide-table-wrap">
        <table className="guide-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>All</th>
              {DIFFICULTIES.map((d) => (
                <th key={d}>
                  <span className={`diff diff-${d}`}>{d}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODELS.map((m) => (
              <tr key={m.id}>
                <td className="gt-name">{m.name}</td>
                <td className="gt-all">{pct(accuracy(m.id))}</td>
                {DIFFICULTIES.map((d) => {
                  const a = accuracy(m.id, d);
                  return (
                    <td key={d}>
                      <span className="cell-bar" style={{ ["--w" as string]: `${a * 100}%` }}>
                        {pct(a)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {MODELS.map((m) => {
        const misses = PAIRS.filter((p) => !isRight(m.id, p));
        return (
          <article key={m.id} className="model-article">
            <header>
              <h2>
                {m.name}
                {m.placeholder && <span className="tag">placeholder</span>}
              </h2>
              <span className="ma-acc">{pct(accuracy(m.id))} right</span>
            </header>
            <p>{m.guide.how}</p>
            <div className="ma-cols">
              <div>
                <h3 className="good">Good at</h3>
                <ul>
                  {m.guide.goodAt.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="bad">Struggles with</h3>
                <ul>
                  {m.guide.badAt.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            </div>
            {misses.length > 0 && (
              <div className="ma-misses">
                <span className="ma-misses-label">Misses in this set</span>
                {misses.map((p) => (
                  <span key={p.id} className="trap" title={p.a.lines.join(", ") + "  vs  " + p.b.lines.join(", ")}>
                    {p.trap ?? p.id}
                  </span>
                ))}
              </div>
            )}
            <button className="ghost" onClick={() => onChallenge(m.id)}>
              Try to beat it →
            </button>
          </article>
        );
      })}
    </main>
  );
}
