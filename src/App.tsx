import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PAIRS } from "./data/game";
import { MODELS, MODEL_BY_ID, PREDICTIONS, accuracy, isRight, type Model } from "./data/models";
import { diffSummary } from "./lib/text";
import { AddressCard } from "./AddressCard";
import { ModelDiagram } from "./Diagrams";
import { Demo } from "./Demo";
import { ShareButton } from "./Share";
import { AnswerChart } from "./AnswerChart";
import { Picker } from "./Picker";
import { logAnswer, loggingEnabled, newId } from "./lib/telemetry";
import type { AddressPair, Difficulty } from "./types";

/** The study this game comes from: the blog write-up, and the full paper it links to. */
const WRITEUP_URL = "https://dzhang3210.github.io/posts/address-matching/";
const PAPER_URL =
  "https://github.com/DZhang3210/address-matching-by-pair-type/blob/main/paper/address-matching-by-pair-type.pdf";

const ROUND_SIZE = 10; // short, so a first game gives feedback fast
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
 * A pair's own difficulty: how many of the 6 exported models miss it (same as The models page).
 * It sets the pair's badge and points in every mode, so "hard" always means a tricky pair.
 */
function difficultyFor(pair: AddressPair): Difficulty {
  return pair.difficulty;
}

/**
 * Versus a model, the round's difficulty is how strong the opponent plays: out of ROUND_SIZE pairs, exactly
 * this many are ones it gets right. It is always below ROUND_SIZE, so a perfect round always wins.
 */
const MODEL_SCORE: Record<Difficulty, number> = { easy: 5, medium: 7, hard: 8 };
/**
 * Which of its right answers a round uses ("true pair" = same place, "false pair" = different place):
 *   Easy:   the ones it was sure about: true pairs with P(same) >= 0.9, false pairs with P(same) <= 0.1.
 *   Medium: any right answer.
 *   Hard:   its close calls: true pairs with P(same) 0.5–0.9, false pairs with P(same) 0.1–0.5.
 * Its wrong answers are drawn at random. Its right answers are split evenly between true and false pairs,
 * so a round doesn't lean toward "same" or "different" (some models are far less sure on false pairs).
 *
 * The bands need a real probability with a 0.5 threshold. Token overlap's score is a share of words with a
 * 0.75 cut-off, and two different addresses almost never share under 10% of their words, so for it "close
 * call" is relative instead: the least confident CLOSE_SHARE of its right true pairs, and of its right false pairs.
 */
const SURE = 0.9;
const CLOSE_SHARE = 0.2;
const RANKED_MODELS = new Set(["token-overlap"]);
const closeCallCache = new Map<string, Set<string>>();
/** Ids of the right answers that count as close calls for this model. */
function closeCalls(model: Model, right: AddressPair[]): Set<string> {
  let set = closeCallCache.get(model.id);
  if (!set) {
    const preds = PREDICTIONS[model.id];
    set = new Set();
    for (const isMatch of [true, false]) {
      const group = right.filter((p) => p.isMatch === isMatch);
      const close = RANKED_MODELS.has(model.id)
        ? [...group].sort((a, b) => preds[a.id].confidence - preds[b.id].confidence).slice(0, Math.round(group.length * CLOSE_SHARE))
        : group.filter((p) => preds[p.id].confidence < SURE); // confidence = P(same) on a "same", 1 - P(same) on a "different"
      for (const p of close) set.add(p.id);
    }
    closeCallCache.set(model.id, set);
  }
  return set;
}
/** Take n, preferring `first`, topped up from `then` if it runs short. */
function takePreferring<T>(n: number, first: T[], then: T[]): T[] {
  return [...shuffle(first), ...shuffle(then)].slice(0, n);
}
const PROGRESS_WINDOW = 10; // dots shown in endless mode: the latest answers + the current pair
/** No opponent: the pairs of the chosen difficulty ("any" = all). */
function poolFor(difficulty: DiffChoice): AddressPair[] {
  return PAIRS.filter((p) => difficulty === "any" || p.difficulty === difficulty);
}
/**
 * No opponent: endless, the pool shuffled (another shuffle is appended when it runs out).
 * Versus a model: MODEL_SCORE[difficulty] pairs it gets right plus the rest from pairs it gets wrong, shuffled.
 */
function dealRound(difficulty: DiffChoice, opponent?: Model): AddressPair[] {
  if (!opponent) return shuffle(poolFor(difficulty));
  const level: Difficulty = difficulty === "any" ? "easy" : difficulty;
  const preds = PREDICTIONS[opponent.id];
  const right: AddressPair[] = [];
  const wrong: AddressPair[] = [];
  for (const p of PAIRS) (preds[p.id].match === p.isMatch ? right : wrong).push(p);
  const close = closeCalls(opponent, right);
  const inBand = (p: AddressPair) => (level === "easy" ? !close.has(p.id) : level === "hard" ? close.has(p.id) : true);
  const k = MODEL_SCORE[level];
  // Half true pairs, half false pairs; an odd k gives the extra one to a random side.
  const kTrue = Math.random() < 0.5 ? Math.ceil(k / 2) : Math.floor(k / 2);
  const picks: AddressPair[] = [];
  for (const [isMatch, n] of [[true, kTrue], [false, k - kTrue]] as const) {
    const side = right.filter((p) => p.isMatch === isMatch);
    // This side's band first, then the rest of this side if a model has too few.
    picks.push(...takePreferring(n, side.filter(inBand), side.filter((p) => !inBand(p))));
  }
  if (picks.length < k) {
    // Only if one side ran out entirely: fill from any right answer not already picked.
    const used = new Set(picks.map((p) => p.id));
    picks.push(...takePreferring(k - picks.length, right.filter((p) => inBand(p) && !used.has(p.id)), right.filter((p) => !used.has(p.id))));
  }
  return shuffle([...picks, ...shuffle(wrong).slice(0, ROUND_SIZE - k)]);
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
  // The models page opens scrolled to this model when reached from the start screen's "About the …" link.
  const [guideFocus, setGuideFocus] = useState<string | undefined>();
  const setTab = (id: string) => {
    setGuideFocus(undefined); // a plain tab click opens the models page at the top
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
  // Everyone: one option, all pairs. One model: easy / medium / hard = how many it gets right (Easy if nothing was picked yet).
  const roundDifficulty: DiffChoice = opponent ? (difficulty === "any" ? "easy" : difficulty) : "any";

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
          <div className="topbar-actions">
            <a className="writeup-link" href={WRITEUP_URL} target="_blank" rel="noopener noreferrer">
              <span className="writeup-long">Read the write-up</span>
              <span className="writeup-short">Write-up</span> ↗
            </a>
            <ShareButton />
          </div>
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
            focus={guideFocus}
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
            onAbout={(id) => {
              setTab("models");
              setGuideFocus(id);
            }}
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
  onAbout,
}: {
  opponent?: Model;
  difficulty: DiffChoice;
  onOpponent: (id: string) => void;
  onDifficulty: (d: DiffChoice) => void;
  onAbout: (modelId?: string) => void;
}) {
  // Versus rounds are keyed by round format ("v2": 10 pairs, difficulty = the model's score), so bests from
  // the old 50-pair rounds, where difficulty meant something else, don't carry over.
  const bestKey = `${BEST_KEY}:${opponent ? `v2:${opponent.id}:${difficulty}` : `free:${difficulty}`}`;
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

  // Anonymous answer logging (src/lib/telemetry.ts): when the current pair appeared, and whether
  // the tab went to the background while it was up (that answer's time is then meaningless).
  const roundId = useRef("");
  const shownAt = useRef(0);
  const wasHidden = useRef(false);
  useEffect(() => {
    shownAt.current = performance.now();
    wasHidden.current = document.hidden;
  }, [deck, index]);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) wasHidden.current = true;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const start = useCallback(() => {
    const deck = dealRound(difficulty, opponent);
    if (deck.length === 0) return; // nothing fits this difficulty + opponent (Start is disabled too)
    roundId.current = newId();
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
      const points = correct ? POINTS[difficultyFor(current)] + STREAK_BONUS * (newStreak - 1) : 0;
      setStreak(newStreak);
      setBestStreak((b) => Math.max(b, newStreak));
      setAnswers((as) => [...as, { pair: current, guess, correct, points }]);
      logAnswer({
        roundId: roundId.current,
        position: index,
        pairId: current.id,
        guess,
        correct,
        responseMs: performance.now() - shownAt.current,
        wasHidden: wasHidden.current,
        opponent: opponent?.id ?? null,
        difficulty,
        device: window.matchMedia?.(PHONE_QUERY).matches ? "phone" : "desktop",
      });
    },
    [current, revealed, streak, opponent, index, difficulty]
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
        onAbout={onAbout}
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
        <span className={`diff diff-${difficultyFor(current)}`}>{difficultyFor(current)}</span>
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
  onAbout,
}: {
  best: number;
  onStart: () => void;
  leaving: boolean;
  opponent?: Model;
  difficulty: DiffChoice;
  onOpponent: (id: string) => void;
  onDifficulty: (d: DiffChoice) => void;
  onAbout: (modelId?: string) => void;
}) {
  const poolSize = opponent ? ROUND_SIZE : poolFor(difficulty).length;
  const level: Difficulty = difficulty === "any" ? "easy" : difficulty;
  return (
    <main className={"intro" + (leaving ? " leaving" : "")}>
      {opponent ? (
        <>
          <h1>
            Beat the <span className="hl">{opponent.short}</span>.
          </h1>
          <p className="lede">
            {opponent.blurb} Can you beat it?
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
        <Picker<DiffChoice>
          label="Difficulty"
          value={difficulty}
          onChange={onDifficulty}
          disabled={!opponent}
          title={opponent ? undefined : "Pick an opponent to choose a difficulty"}
          options={((opponent ? DIFFICULTIES : ["any"]) as DiffChoice[]).map((d) =>
            d === "any"
              ? { value: d, label: "All pairs", hint: poolSize.toLocaleString() }
              : { value: d, label: d[0].toUpperCase() + d.slice(1), hint: `it gets ${MODEL_SCORE[d]}/${ROUND_SIZE}` },
          )}
        />
        <Picker<string>
          label="Opponent"
          value={opponent?.id ?? ""}
          onChange={onOpponent}
          options={[
            { value: "", label: "Everyone" },
            // Each model's accuracy over all pairs, so players can pick an opponent by strength.
            ...MODELS.map((m) => ({ value: m.id, label: m.short, hint: `${pct(accuracy(m.id))} acc` })),
          ]}
        />
      </div>
      <p className="pool-note">
        {poolSize === 0
          ? "No pairs fit this combination."
          : opponent
            ? `The ${opponent.short} gets ${MODEL_SCORE[level]} of ${ROUND_SIZE} right. Get ${MODEL_SCORE[level] + 1} to win.`
            : `${poolSize.toLocaleString()} pairs, endless.`}
        <br />
        <button type="button" className="learn-more" onClick={() => onAbout(opponent?.id)}>
          {opponent ? `Learn more about the ${opponent.short}` : "Learn more about the models"} →
        </button>
      </p>
      <button className={"start" + (leaving ? " pressed" : "")} onClick={onStart} disabled={poolSize === 0}>
        Start <span className="go-arrow">→</span> <kbd>Enter</kbd>
      </button>
      <p className="keys">
        <kbd>Y</kbd>/<kbd>←</kbd> same · <kbd>N</kbd>/<kbd>→</kbd> different · <kbd>S</kbd> show pair
        {best > 0 && <> · best score {best}</>}
      </p>
      <p className="privacy-note">
        {loggingEnabled()
          ? "Answers are recorded anonymously to compare people with the models."
          : "Recording of your answers is off."}{" "}
        <a href="/privacy.html">Privacy &amp; opt-out</a>
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

  const n = answers.length;
  let tone: "win" | "lose" | "even";
  let headline: string;
  let rating: string;
  // Versus a model the round always has it scoring MODEL_SCORE (5-8 of 10), so a plain comparison is fair.
  const theirs = opponent ? answers.filter((a) => isRight(opponent.id, a.pair)).length : 0;
  if (opponent) {
    const name = `the ${opponent.short}`;
    if (right > theirs) {
      tone = "win";
      headline = right === n ? "Flawless!" : "You got it!";
      rating = `You got ${right} of ${n}, ${name} got ${theirs}.`;
    } else if (right < theirs) {
      tone = "lose";
      headline = "Aw, shucks.";
      rating = `You got ${right} of ${n}, but ${name} got ${theirs}.`;
    } else {
      tone = "even";
      headline = "Dead even.";
      rating = `You both got ${right} of ${n}. One more would have won it.`;
    }
  } else {
    const pct = n ? right / n : 0;
    tone = pct >= 0.8 ? "win" : pct > 0.5 ? "even" : "lose";
    headline = right === n && n > 0 ? "Flawless!" : pct >= 0.8 ? "Sharp eye!" : pct > 0.5 ? "Not bad." : "Rough round.";
    rating =
      right === n && n > 0
        ? "You may be a geocoder."
        : pct >= 0.8
          ? `${right} of ${n} right.`
          : pct > 0.5
            ? "Addresses are hard."
            : `${right} of ${n} is ${pct === 0.5 ? "no better than" : "worse than"} guessing. The addresses won this one.`;
  }

  return (
    <main className={"results" + (leaving ? " leaving" : "")}>
      <h1 className={`verdict verdict-${tone}`}>{headline}</h1>
      {opponent ? (
        <div className="faceoff" aria-label={`You ${right}, ${opponent.short} ${theirs}, out of ${n}`}>
          <div className={"side" + (right > theirs ? " ahead" : "")}>
            <div className="side-name">You</div>
            <div className="big">{right}</div>
          </div>
          <div className="faceoff-vs">
            vs
            <span>out of {n}</span>
          </div>
          <div className={"side" + (theirs > right ? " ahead" : "")}>
            <div className="side-name">{opponent.short}</div>
            <div className="big">{theirs}</div>
          </div>
        </div>
      ) : (
        <div className="big">
          {right}
          <span>/{n}</span>
        </div>
      )}
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
      <p className="study-note">
        Why do pairs like these trip up people and models?{" "}
        <a href={WRITEUP_URL} target="_blank" rel="noopener noreferrer">
          Read the write-up ↗
        </a>
      </p>
    </main>
  );
}

/* ================================== Guide ================================== */

function Guide({ focus, onChallenge }: { focus?: string; onChallenge: (modelId: string) => void }) {
  useEffect(() => {
    if (focus) document.getElementById(`model-${focus}`)?.scrollIntoView({ block: "start" });
  }, [focus]);
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
      <p className="study-note guide-study">
        From a study comparing these models on the same pairs:{" "}
        <a href={WRITEUP_URL} target="_blank" rel="noopener noreferrer">
          read the write-up ↗
        </a>{" "}
        or the{" "}
        <a href={PAPER_URL} target="_blank" rel="noopener noreferrer">
          full paper (PDF) ↗
        </a>
        . Figures marked "in the paper" come from there.
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
          <article key={m.id} id={`model-${m.id}`} className="model-article">
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
