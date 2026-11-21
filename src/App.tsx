import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PAIRS } from "./data/game";
import { MODELS, MODEL_BY_ID, PREDICTIONS, accuracy, isRight, type Model } from "./data/models";
import { diffSummary } from "./lib/text";
import { AddressCard } from "./AddressCard";
import { ModelDiagram } from "./Diagrams";
import { Demo } from "./Demo";
import { ShareButton } from "./Share";
import { AnswerChart } from "./AnswerChart";
import type { AddressPair, Difficulty } from "./types";

const ROUND_SIZE = 10;
const POINTS: Record<Difficulty, number> = { easy: 100, medium: 150, hard: 200 };
const DIFFICULTIES = Object.keys(POINTS) as Difficulty[];
const STREAK_BONUS = 25;
const BEST_KEY = "same-place:best";
const TAB_KEY = "same-place:tab";
const OPP_KEY = "same-place:opponent";
const DIFF_KEY = "same-place:difficulty";

type DiffChoice = Difficulty | "any";
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

/** True on phone-width screens (matches the CSS breakpoint), kept up to date on resize/rotate. */
const PHONE_QUERY = "(max-width: 640px)";
function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia?.(PHONE_QUERY).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const on = () => setIsPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isPhone;
}

/**
 * Difficulty of a pair.
 * Against everyone: the pair's own level (how many of the 6 exported models miss it; same as The models page).
 * Against one model: that model's confidence in the right answer: sure and right (>= SURE) easy,
 * right but unsure medium, wrong hard. For the exported models the confidence is P(right answer).
 */
const SURE = 0.9;
function difficultyFor(pair: AddressPair, opponent?: Model): Difficulty {
  if (!opponent) return pair.difficulty;
  const p = PREDICTIONS[opponent.id][pair.id];
  if (p.match !== pair.isMatch) return "hard";
  return p.confidence >= SURE ? "easy" : "medium";
}

/**
 * The pairs a round can draw from: the chosen difficulty ("any" = all), judged against the opponent if there is one.
 * No opponent: endless, the pool shuffled (another shuffle is appended when it runs out).
 * Versus a model: ROUND_SIZE pairs from the pool (fewer if the pool is smaller).
 */
const OPPONENT_ROUND: Record<DiffChoice, string> = {
  any: "This round mixes pairs it gets right and wrong.",
  easy: "Every pair in this round is one it gets right, and is sure about.",
  medium: "Every pair in this round is one it gets right, but without much confidence.",
  hard: "Every pair in this round is one it gets wrong.",
};
const PROGRESS_WINDOW = 10; // dots shown in endless mode: the latest answers + the current pair
function poolFor(difficulty: DiffChoice, opponent?: Model): AddressPair[] {
  return PAIRS.filter((p) => difficulty === "any" || difficultyFor(p, opponent) === difficulty);
}
function dealRound(difficulty: DiffChoice, opponent?: Model): AddressPair[] {
  const pool = shuffle(poolFor(difficulty, opponent));
  return opponent ? pool.slice(0, ROUND_SIZE) : pool;
}

/* ================================ App shell ================================ */

const TABS = [
  { id: "play", label: "Play" },
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
  const [opponentId, setOpponentId] = useState(() => {
    const saved = load(OPP_KEY) ?? "";
    return MODEL_BY_ID[saved] ? saved : "";
  });
  const [difficulty, setDifficulty] = useState<DiffChoice>(() => {
    const saved = load(DIFF_KEY) as DiffChoice | null;
    return saved && (saved === "any" || saved in POINTS) ? saved : "any";
  });
  const chooseOpponent = (id: string) => {
    setOpponentId(id);
    save(OPP_KEY, id);
  };
  const chooseDifficulty = (d: DiffChoice) => {
    setDifficulty(d);
    save(DIFF_KEY, d);
  };
  const opponent = opponentId ? MODEL_BY_ID[opponentId] : undefined;
  // Everyone: one option, all pairs. One model: easy / medium / hard by its own confidence (Hard if nothing was picked yet).
  const roundDifficulty: DiffChoice = opponent ? (difficulty === "any" ? "hard" : difficulty) : "any";

  // On a narrow screen the tab row scrolls sideways: keep the active tab in view.
  useEffect(() => {
    document.querySelector(".tab.active")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <button className="brand" onClick={() => setTab("play")} title="Back to the start">
            <span className="pin" aria-hidden>
              ⌖
            </span>
            Same Place?
          </button>
          <ShareButton />
        </div>
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
        <nav className="tabs-compact" aria-label="Modes">
          <div className="tc-row">
            <button
              className={"tab" + (tab === "play" ? " active" : "")}
              onClick={() => setTab("play")}
              aria-current={tab === "play" ? "page" : undefined}
            >
              Play
            </button>
            <button
              className={"tab" + (tab === "models" ? " active" : "")}
              onClick={() => setTab("models")}
              aria-current={tab === "models" ? "page" : undefined}
            >
              The models
            </button>
          </div>
        </nav>
      </header>

      {/* Keyed per tab so every switch replays the fade-in. */}
      <div key={tab} className="page-in">
        {tab === "models" ? (
          <Guide
            onChallenge={(id) => {
              chooseOpponent(id);
              setTab("play");
            }}
          />
        ) : (
          <Game
            key={`${tab}:${visit}:${opponentId}:${roundDifficulty}`}
            opponent={opponent}
            difficulty={roundDifficulty}
            onOpponent={chooseOpponent}
            onDifficulty={chooseDifficulty}
          />
        )}
      </div>
    </div>
  );
}

/* ================================== Game ================================== */

function Game({
  opponent,
  difficulty,
  onOpponent,
  onDifficulty,
}: {
  opponent?: Model;
  difficulty: DiffChoice;
  onOpponent: (id: string) => void;
  onDifficulty: (d: DiffChoice) => void;
}) {
  const bestKey = `${BEST_KEY}:${opponent ? opponent.id : "free"}:${difficulty}`;
  const endless = !opponent; // free play has no fixed length
  const [phase, setPhase] = useState<Phase>("intro");
  const [deck, setDeck] = useState<AddressPair[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [peek, setPeek] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false); // endless mode: "End game?" is showing
  const [best, setBest] = useState(() => Number(load(bestKey)) || 0);

  const current = deck[index];
  const revealed = answers.length > index;
  const lastAnswer = revealed ? answers[index] : undefined;
  const score = answers.reduce((s, a) => s + a.points, 0);
  const youRight = answers.filter((a) => a.correct).length;
  const oppRight = opponent ? answers.filter((a) => isRight(opponent.id, a.pair)).length : 0;

  const start = useCallback(() => {
    const deck = dealRound(difficulty, opponent);
    if (deck.length === 0) return; // nothing fits this difficulty + opponent (Start is disabled too)
    setDeck(deck);
    setIndex(0);
    setAnswers([]);
    setStreak(0);
    setBestStreak(0);
    setPeek(false);
    setPhase("playing");
    window.scrollTo({ top: 0 });
  }, [opponent, difficulty]);

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
      const points = correct ? POINTS[difficultyFor(current, opponent)] + STREAK_BONUS * (newStreak - 1) : 0;
      setStreak(newStreak);
      setBestStreak((b) => Math.max(b, newStreak));
      setAnswers((as) => [...as, { pair: current, guess, correct, points }]);
    },
    [current, revealed, streak, opponent]
  );

  const finish = useCallback(() => {
    if (answers.length === 0) return;
    setPeek(false);
    setConfirmEnd(false);
    if (score > best) {
      setBest(score);
      save(bestKey, String(score));
    }
    setPhase("done");
  }, [answers.length, score, best, bestKey]);

  const next = useCallback(() => {
    if (!revealed) return;
    if (index + 1 >= deck.length) {
      if (!endless) return finish();
      setDeck((d) => [...d, ...dealRound(difficulty)]); // endless: deal the pool again
    }
    setPeek(false);
    setConfirmEnd(false);
    setIndex((i) => i + 1);
  }, [revealed, index, deck.length, endless, finish, difficulty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = (e.key ?? "").toLowerCase(); // some phone keyboards send events with no key name
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
      } else if (k === "e" && endless) {
        if (confirmEnd) finish();
        else setConfirmEnd(true);
      } else if (confirmEnd && (k === "escape" || k === "n")) {
        setConfirmEnd(false);
      } else if (k === "enter" || k === " ") {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, revealed, answer, next, begin, finish, endless, confirmEnd]);

  if (phase === "intro")
    return (
      <Intro
        best={best}
        onStart={begin}
        leaving={leaving}
        opponent={opponent}
        difficulty={difficulty}
        onOpponent={onOpponent}
        onDifficulty={onDifficulty}
      />
    );
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

  const isLast = !endless && index + 1 >= deck.length;
  const showOverlay = revealed && !peek;
  // Endless: a rolling window of dots ending at the current pair. Fixed round: one dot per pair.
  const dotStart = endless ? Math.max(0, index + 1 - PROGRESS_WINDOW) : 0;
  const dotEnd = endless ? index + 1 : deck.length;

  return (
    <main className={"play" + (revealed ? " answered" : "") + (revealed && peek ? " peeking" : "")}>
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
        <Stat label="Pair" value={endless ? `${index + 1}` : `${index + 1}/${deck.length}`} />
      </div>

      <div className="progress" aria-hidden>
        {deck.slice(dotStart, dotEnd).map((_, j) => {
          const i = dotStart + j;
          return (
          <span
            key={i}
            style={{ "--i": j } as CSSProperties}
            className={
              "dot " + (i < answers.length ? (answers[i].correct ? "ok" : "bad") : i === index ? "now" : "")
            }
          />
          );
        })}
      </div>

      <p className="prompt">
        <span>
          Do these two records point to the <em>same address</em>?
        </span>
        <span className={`diff diff-${difficultyFor(current, opponent)}`}>{difficultyFor(current, opponent)}</span>
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
            onEnd={endless ? () => setConfirmEnd(true) : undefined}
            confirmEnd={confirmEnd}
            onConfirmEnd={finish}
            onCancelEnd={() => setConfirmEnd(false)}
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
  onEnd,
  confirmEnd,
  onConfirmEnd,
  onCancelEnd,
  isLast,
}: {
  answer: Answer;
  opponent?: Model;
  peek: boolean;
  onNext: () => void;
  onPeek: () => void;
  /** Endless mode only: ask to stop (then confirm or cancel). */
  onEnd?: () => void;
  confirmEnd?: boolean;
  onConfirmEnd?: () => void;
  onCancelEnd?: () => void;
  isLast: boolean;
}) {
  const { pair, guess, correct, points } = answer;
  const isPhone = useIsPhone();
  const actions = (
    <div className="reveal-actions">
      <button className="next" onClick={onNext} autoFocus={!isPhone}>
        {isLast ? "See results" : "Next pair"} <kbd>Enter</kbd>
      </button>
      <button className="ghost" onClick={onPeek} aria-pressed={peek}>
        {peek ? "Show result" : "Show pair"} <kbd>S</kbd>
      </button>
      {onEnd && (
        <button className="danger" onClick={onEnd}>
          <span className="lbl-long">End &amp; see results</span>
          <span className="lbl-short">End</span> <kbd>E</kbd>
        </button>
      )}
    </div>
  );

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
        {/* On phones the buttons render straight into <body> as the fixed bottom bar: a fixed bar
            nested inside the scrolling result sheet misbehaved on real phones when Show pair hid the sheet. */}
        {isPhone ? createPortal(<div className="phone-bar">{actions}</div>, document.body) : actions}
      </div>

      <AnswerChart pair={pair} opponent={opponent} />

      {confirmEnd &&
        onConfirmEnd &&
        onCancelEnd &&
        createPortal(
          <div className="modal-backdrop" onClick={onCancelEnd}>
            <div
              className="modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="end-q"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="end-q">End the game?</h2>
              <p>You'll see your results and how every model did on the same pairs.</p>
              <div className="modal-actions">
                <button className="ghost" onClick={onCancelEnd}>
                  Keep playing <kbd>Esc</kbd>
                </button>
                <button className="danger solid" onClick={onConfirmEnd} autoFocus>
                  Yes, end it <kbd>E</kbd>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/* ================================== Intro ================================== */

function Intro({
  best,
  onStart,
  leaving,
  opponent,
  difficulty,
  onOpponent,
  onDifficulty,
}: {
  best: number;
  onStart: () => void;
  leaving: boolean;
  opponent?: Model;
  difficulty: DiffChoice;
  onOpponent: (id: string) => void;
  onDifficulty: (d: DiffChoice) => void;
}) {
  const poolSize = poolFor(difficulty, opponent).length;
  const roundSize = opponent ? Math.min(ROUND_SIZE, poolSize) : poolSize;
  return (
    <main className={"intro" + (leaving ? " leaving" : "")}>
      {opponent ? (
        <>
          <h1>
            Beat the <span className="hl">{opponent.short}</span>.
          </h1>
          <p className="lede">
            {opponent.blurb} It gets <strong>{pct(accuracy(opponent.id))}</strong> of all pairs right.{" "}
            {OPPONENT_ROUND[difficulty]} Can you beat it?
            {opponent.placeholder && <span className="lede-note"> (Its answers are placeholders for now.)</span>}
          </p>
        </>
      ) : (
        <>
          <h1>
            Addresses are <span className="hl">weird</span>.
          </h1>
          <p className="lede">
            Two map datasets, two records. Same place or not? Play as long as you like and stop whenever you want.
            Harder pairs are worth more, and streaks add a bonus.
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
      <div className="pickers">
        <label>
          <span className="picker-label">Difficulty</span>
          <select
            value={difficulty}
            onChange={(e) => onDifficulty(e.target.value as DiffChoice)}
            disabled={!opponent}
            title={opponent ? undefined : "Pick an opponent to choose a difficulty"}
          >
            {((opponent ? DIFFICULTIES : ["any"]) as DiffChoice[]).map((d) => {
              const n = poolFor(d, opponent).length;
              return (
                <option key={d} value={d} disabled={n === 0}>
                  {d === "any" ? "All pairs" : d[0].toUpperCase() + d.slice(1)} ({n.toLocaleString()})
                </option>
              );
            })}
          </select>
        </label>
        <label>
          <span className="picker-label">Opponent</span>
          <select value={opponent?.id ?? ""} onChange={(e) => onOpponent(e.target.value)}>
            <option value="">Everyone</option>
            {MODELS.map((m) => {
              const n = poolFor(difficulty, m).length;
              return (
                <option key={m.id} value={m.id} disabled={n === 0}>
                  {m.name}
                  {difficulty !== "any" && ` (${n.toLocaleString()} ${difficulty})`}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      <p className="pool-note">
        {poolSize === 0
          ? "No pairs fit this combination."
          : opponent
            ? `${roundSize} of ${poolSize.toLocaleString()} pairs, at random. Difficulty is judged by the ${opponent.short}'s own confidence.`
            : `${poolSize.toLocaleString()} pairs, endless.`}
      </p>
      <button className={"start" + (leaving ? " pressed" : "")} onClick={onStart} disabled={poolSize === 0}>
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
      <p className="board-sub">Same {n} {n === 1 ? "pair" : "pairs"}.</p>
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
        : right >= 0.8 * answers.length
          ? "Sharp eye."
          : right >= 0.5 * answers.length
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
        Seven ways to decide whether two records are the same address, from a few lines of string matching to a large
        language model. Each one is scored below on all {PAIRS.length.toLocaleString()} pairs in the game: real
        Connecticut addresses (Overture × Foursquare) from the validation and test splits. None of the trained models
        was trained on them; the validation pairs were used to choose when to stop training. Difficulty is how many of the six models with saved answers (all but token overlap) get a pair wrong:
        none is easy, 1–2 medium, 3–6 hard.
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
                {misses.slice(0, 8).map((p) => (
                  <span key={p.id} className="trap" title={p.trap ?? (p.isMatch ? "Same place" : "Different places")}>
                    {p.a.lines.join(", ") + "  vs  " + p.b.lines.join(", ")}
                  </span>
                ))}
                {misses.length > 8 && <span className="ma-misses-label">+{(misses.length - 8).toLocaleString()} more</span>}
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
