/// <reference types="vite/client" />
/**
 * Anonymous answer logging for a possible follow-up study (see /privacy.html).
 *
 * Each answer becomes one row in the Supabase table `answers`. The key below is Supabase's
 * *publishable* key: it is meant to be public, and the table only lets it insert rows
 * (no reading, editing or deleting). Nothing identifying is sent: no account, no free text,
 * and a session id that is random per tab visit and never stored across visits.
 *
 * Logging is skipped when the player opted out on the privacy page, or the browser sends
 * Global Privacy Control. It never blocks or breaks the game: failures are ignored.
 */

const SUPABASE_URL = "https://xvmrqalslwlildmvulpl.supabase.co";
const SUPABASE_KEY = "sb_publishable_HQ1ysqLwKwUry7eTE43KsA_ln-vPNyC";

/** Bump when the round format or scoring changes, so the data can be split by version. */
const GAME_VERSION = "2026.11.22";
/** Rows from `npm run dev` are tagged so they can be filtered out of the data. */
const APP_VERSION = import.meta.env.DEV ? `${GAME_VERSION}-dev` : GAME_VERSION;

/** Also read and written by public/privacy.html's on/off switch. */
const OPT_OUT_KEY = "same-place:no-logging";
const SESSION_KEY = "same-place:session";

export function loggingEnabled(): boolean {
  try {
    if (localStorage.getItem(OPT_OUT_KEY) === "1") return false;
  } catch {
    /* storage blocked: fall through */
  }
  return !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}

export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older browsers: RFC 4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Per tab visit: sessionStorage is cleared when the tab closes, so visits aren't linked. */
function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return (memorySession ??= newId());
  }
}
let memorySession: string | undefined;

export interface AnswerLog {
  roundId: string;
  position: number;
  pairId: string;
  guess: boolean;
  correct: boolean;
  responseMs: number;
  wasHidden: boolean;
  opponent: string | null;
  difficulty: "any" | "easy" | "medium" | "hard";
  device: "phone" | "desktop";
}

export function logAnswer(a: AnswerLog): void {
  if (!loggingEnabled()) return;
  const row = {
    session_id: sessionId(),
    round_id: a.roundId,
    position: a.position,
    pair_id: a.pairId,
    guess: a.guess,
    correct: a.correct,
    response_ms: Math.max(0, Math.min(3_600_000, Math.round(a.responseMs))),
    was_hidden: a.wasHidden,
    opponent: a.opponent,
    difficulty: a.difficulty,
    device: a.device,
    app_version: APP_VERSION,
  };
  try {
    void fetch(`${SUPABASE_URL}/rest/v1/answers`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
      keepalive: true, // still sent if the player closes the tab right after answering
    }).catch(() => {});
  } catch {
    /* never let logging break the game */
  }
}
