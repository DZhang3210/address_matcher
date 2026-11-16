import type { ReactNode } from "react";
import { DEMO_PAIRS } from "./data/pairs";
import type { Model } from "./data/models";
import { tokenSet } from "./lib/text";

/*
 * "What you're up against": an architecture figure per model, drawn in the
 * app's own palette and laid out left to right. Not a tutorial. If you know,
 * you know; if you don't, it looks like a big scary algorithm. Each links to
 * the papers for anyone who wants more.
 */

interface Ref {
  label: string;
  href: string;
}

const FIGURES: Record<string, { n: number; caption: string; refs: Ref[]; svg: () => ReactNode }> = {
  "token-overlap": {
    n: 1,
    caption: "Overlap coefficient on normalized word sets, thresholded at τ = 0.75.",
    refs: [{ label: "Overlap coefficient (Szymkiewicz–Simpson)", href: "https://en.wikipedia.org/wiki/Overlap_coefficient" }],
    svg: () => <VennFigure />,
  },
  xgb: {
    n: 2,
    caption: "XGBoost over 23 string-similarity features: 100 trees (depth ≤ 6), each fit to the previous trees' errors; their summed output is a logit.",
    refs: [
      { label: "Chen & Guestrin, XGBoost (2016)", href: "https://arxiv.org/abs/1603.02754" },
      { label: "Lee, Claridades & Lee, address matching with similarity features (2020)", href: "https://doi.org/10.3390/app10165628" },
    ],
    svg: () => <TreesFigure />,
  },
  esim: {
    n: 3,
    caption: "ESIM: frozen word2vec vectors (rare tokens get their own fixed random row) → BiLSTM → soft alignment between A and B → comparison → BiLSTM → mean + max pooling → MLP.",
    refs: [
      { label: "Chen et al., Enhanced LSTM for Natural Language Inference (2017)", href: "https://arxiv.org/abs/1609.06038" },
      { label: "Lin et al., deep semantic address matching (2020)", href: "https://doi.org/10.1080/13658816.2019.1681431" },
    ],
    svg: () => <EsimFigure />,
  },
  bi: {
    n: 4,
    caption: "Bi-encoder: one DistilBERT encodes each address on its own; the two mean-pooled vectors meet only in the head.",
    refs: [
      { label: "Reimers & Gurevych, Sentence-BERT (2019)", href: "https://arxiv.org/abs/1908.10084" },
      { label: "Sanh et al., DistilBERT (2019)", href: "https://arxiv.org/abs/1910.01108" },
    ],
    svg: () => <BiEncoderFigure />,
  },
  cross: {
    n: 5,
    caption: "Cross-encoder: both addresses in one DistilBERT input, so every layer attends across them; mean + max pooling → MLP.",
    refs: [
      { label: "Devlin et al., BERT (2019)", href: "https://arxiv.org/abs/1810.04805" },
      { label: "Sanh et al., DistilBERT (2019)", href: "https://arxiv.org/abs/1910.01108" },
    ],
    svg: () => <CrossEncoderFigure />,
  },
  llm: {
    n: 6,
    caption: "Zero-shot gpt-4o-mini: P(same) from the probabilities of its first token (YES vs NO); the sentence after it is the reasoning shown in the game.",
    refs: [
      { label: "Narayan et al., Can Foundation Models Wrangle Your Data? (2022)", href: "https://arxiv.org/abs/2205.09911" },
      { label: "OpenAI API: log probabilities", href: "https://platform.openai.com/docs/api-reference/chat/create" },
    ],
    svg: () => <LlmFigure />,
  },
};

/** Phone version of each figure: the same pipeline as a vertical list of steps (accent = the model's key step). */
interface FlowStep {
  title: string;
  detail?: string;
  accent?: boolean;
}
const FLOWS: Record<string, FlowStep[]> = {
  "token-overlap": [
    { title: "A, B" },
    { title: "Normalize", detail: "lower-case, strip punctuation, expand abbreviations (St → street)" },
    { title: "Word sets A and B" },
    { title: "overlap = |A ∩ B| / min(|A|, |B|)", accent: true },
    { title: "Same if overlap ≥ 0.75" },
  ],
  xgb: [
    { title: "A, B" },
    { title: "23 similarity scores", detail: "Jaro-Winkler, Levenshtein, Jaccard, Cosine, … on street · number · ZIP, + missing-number flag" },
    { title: "100 decision trees", detail: "each one fit to the errors of the ones before", accent: true },
    { title: "logit = tree 1 + tree 2 + … + tree 100" },
    { title: "σ(logit) → P(same)", detail: "same if ≥ 0.5" },
  ],
  esim: [
    { title: "A and B, as words" },
    { title: "word2vec 200 (frozen)", detail: "rare tokens get their own fixed random row" },
    { title: "BiLSTM 200", detail: "same weights for A and B" },
    { title: "Soft alignment", detail: "each word of A attends to B, and B to A", accent: true },
    { title: "Compare: [a; ã; a−ã; a⊙ã]" },
    { title: "Projection + BiLSTM 200" },
    { title: "Mean + max pool, both sides joined" },
    { title: "MLP 200, tanh" },
    { title: "σ(logit) → P(same)", detail: "same if ≥ 0.5" },
  ],
  bi: [
    { title: "[CLS] A [SEP]   and   [CLS] B [SEP]", detail: "encoded separately" },
    { title: "DistilBERT, 6 layers", detail: "the same weights for both addresses", accent: true },
    { title: "Masked mean pool → vectors u and v" },
    { title: "Head: [|u−v|; u⊙v] → Linear" },
    { title: "σ(logit) → P(same)", detail: "same if ≥ 0.5" },
  ],
  cross: [
    { title: "[CLS] A [SEP] B [SEP]", detail: "both addresses in one input" },
    { title: "DistilBERT, 6 layers", detail: "attention across A's and B's tokens", accent: true },
    { title: "Mean + max pool over all tokens" },
    { title: "MLP 200, tanh, dropout 0.3" },
    { title: "σ(logit) → P(same)", detail: "same if ≥ 0.5" },
  ],
  llm: [
    { title: "Prompt", detail: "A, B, and \u201cAnswer YES or NO first, then one sentence why\u201d" },
    { title: "gpt-4o-mini, temperature 0", accent: true },
    { title: "First token: log-probabilities of YES and NO" },
    { title: "P(same) = e^ℓYES / (e^ℓYES + e^ℓNO)", detail: "same if ≥ 0.5" },
    { title: "The rest of the text → the one-sentence reasoning shown in the game" },
  ],
};

function VerticalFlow({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="vflow">
      {steps.map((st, i) => (
        <li key={i} className={"vstep" + (st.accent ? " accent" : "")}>
          <span className="vstep-title">{st.title}</span>
          {st.detail && <span className="vstep-detail">{st.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ModelDiagram({ model }: { model: Model }) {
  const fig = FIGURES[model.id];
  if (!fig) return null;
  return (
    <section className="diagram" aria-label={`Architecture of the ${model.short}`}>
      <h2 className="diagram-title">What you're up against</h2>
      <figure className="figure-card">
        <div className="fig-scroll">{fig.svg()}</div>
        {FLOWS[model.id] && <VerticalFlow steps={FLOWS[model.id]} />}
        <figcaption>
          <span className="fig-n">Fig. {fig.n}</span> {fig.caption}
        </figcaption>
      </figure>
      <p className="paper-refs">
        Read more:{" "}
        {fig.refs.map((r, i) => (
          <span key={r.href}>
            {i > 0 && " · "}
            <a href={r.href} target="_blank" rel="noopener noreferrer">
              {r.label} ↗
            </a>
          </span>
        ))}
      </p>
    </section>
  );
}

/* ---------------- drawing bits (colors come from CSS classes / theme vars) ---------------- */

function Defs() {
  return (
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
      </marker>
    </defs>
  );
}

type Tone = "plain" | "soft" | "accent";

function Box({ x, y, w, h, tone = "plain", lines }: { x: number; y: number; w: number; h: number; tone?: Tone; lines: string[] }) {
  const cy = y + h / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} className={`bx ${tone}`} />
      {lines.map((l, i) => (
        <text key={i} x={x + w / 2} y={cy + (i - (lines.length - 1) / 2) * 14 + 4} textAnchor="middle" className="t">
          {l}
        </text>
      ))}
    </g>
  );
}

const Arrow = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} className="wire" markerEnd="url(#arr)" />
);

function Labels({ x, y, lines, cls = "t" }: { x: number; y: number; lines: string[]; cls?: string }) {
  return (
    <>
      {lines.map((l, i) => (
        <text key={i} x={x} y={y + i * 15} textAnchor="middle" className={cls}>
          {l}
        </text>
      ))}
    </>
  );
}

/* ---------------- shared layout helper: a row of boxes joined by arrows ---------------- */

interface Step {
  lines: string[];
  w: number;
  tone?: Tone;
}

/** Boxes left to right on one center line, an arrow into each one after the first. Returns the drawing and the right edge. */
function chain(x: number, cy: number, steps: Step[], h = 54, gap = 26): { el: ReactNode; end: number } {
  const out: ReactNode[] = [];
  let cx = x;
  steps.forEach((st, i) => {
    if (i > 0) out.push(<Arrow key={`a${i}`} x1={cx - gap} y1={cy} x2={cx - 2} y2={cy} />);
    out.push(<Box key={`b${i}`} x={cx} y={cy - h / 2} w={st.w} h={h} tone={st.tone} lines={st.lines} />);
    cx += st.w + gap;
  });
  return { el: <>{out}</>, end: cx - gap };
}

/** The common ending: logit → σ → P(same), drawn from x on line cy. */
function SigmoidOut({ x, cy }: { x: number; cy: number }) {
  return (
    <>
      <Arrow x1={x} y1={cy} x2={x + 22} y2={cy} />
      <rect x={x + 24} y={cy - 15} width={36} height={30} rx={6} className="bx soft" />
      <path d={`M${x + 29},${cy + 8} C${x + 42},${cy + 8} ${x + 40},${cy - 8} ${x + 55},${cy - 8}`} className="curve" />
      <text x={x + 42} y={cy + 30} textAnchor="middle" className="s">
        σ
      </text>
      <Arrow x1={x + 60} y1={cy} x2={x + 84} y2={cy} />
      <Labels x={x + 122} y={cy - 4} lines={["P(same)"]} cls="t strong" />
      <Labels x={x + 122} y={cy + 14} lines={["same if ≥ 0.5"]} cls="s" />
    </>
  );
}

/* ---------------- XGBoost: features → boosted trees → Σ → σ ---------------- */

function Tree({ x, y }: { x: number; y: number }) {
  // a small depth-2 tree, root at (x, y)
  return (
    <g>
      <path d={`M${x},${y} L${x - 14},${y + 16} M${x},${y} L${x + 14},${y + 16} M${x + 14},${y + 16} L${x + 7},${y + 30} M${x + 14},${y + 16} L${x + 21},${y + 30}`} className="wire" />
      <circle cx={x} cy={y} r={4.5} className="node accent" />
      <circle cx={x - 14} cy={y + 16} r={3.5} className="node soft" />
      <circle cx={x + 14} cy={y + 16} r={3.5} className="node" />
      <circle cx={x + 7} cy={y + 30} r={3} className="node soft" />
      <circle cx={x + 21} cy={y + 30} r={3} className="node soft" />
    </g>
  );
}

function TreesFigure() {
  const cy = 104;
  const xs = [330, 420, 560]; // tree 1, tree 2, tree 100
  return (
    <svg viewBox="0 0 860 200" className="fig" role="img" aria-label="XGBoost architecture diagram" style={{ ["--fig-min" as string]: "660px" }}>
      <Defs />
      <Labels x={34} y={cy + 4} lines={["A, B"]} cls="m" />
      <Arrow x1={58} y1={cy} x2={82} y2={cy} />
      <Box
        x={84}
        y={cy - 60}
        w={186}
        h={120}
        tone="soft"
        lines={["23 similarity scores", "", "Jaro-Winkler, Levenshtein,", "Jaccard, Cosine, …", "on street · number · ZIP"]}
      />
      <Arrow x1={270} y1={cy} x2={296} y2={cy} />
      <rect x={298} y={cy - 52} width={310} height={104} rx={12} className="block" />
      <text x={453} y={cy - 60} textAnchor="middle" className="s">
        100 trees, each one fit to the errors of the ones before
      </text>
      {xs.map((x, i) => (
        <g key={x}>
          <Tree x={x} y={cy - 26} />
          <text x={x} y={cy + 30} textAnchor="middle" className="m">
            {["tree 1", "tree 2", "tree 100"][i]}
          </text>
        </g>
      ))}
      <text x={375} y={cy + 2} textAnchor="middle" className="t big">+</text>
      <text x={490} y={cy + 2} textAnchor="middle" className="t big">+ … +</text>
      <Arrow x1={608} y1={cy} x2={632} y2={cy} />
      <Labels x={652} y={cy + 4} lines={["logit"]} cls="m" />
      <SigmoidOut x={672} cy={cy} />
    </svg>
  );
}

/* ---------------- ESIM: two lanes, cross-attention in the middle ---------------- */

function EsimFigure() {
  const yA = 56;
  const yB = 196;
  const mid = (yA + yB) / 2;
  const enc: Step[] = [
    { lines: ["word2vec 200", "(frozen)"], w: 108, tone: "soft" },
    { lines: ["BiLSTM", "200"], w: 76 },
  ];
  const cmp: Step[] = [
    { lines: ["[a; ã; a−ã; a⊙ã]"], w: 124 },
    { lines: ["projection", "+ BiLSTM 200"], w: 104 },
    { lines: ["mean + max", "pool"], w: 86 },
  ];
  const encA = chain(66, yA, enc);
  const encB = chain(66, yB, enc);
  const xAl = encA.end + 30;
  const wAl = 104;
  const cmpA = chain(xAl + wAl + 30, yA, cmp);
  const cmpB = chain(xAl + wAl + 30, yB, cmp);
  const xMlp = cmpA.end + 40;
  return (
    <svg viewBox="0 0 1150 260" className="fig" role="img" aria-label="ESIM architecture diagram" style={{ ["--fig-min" as string]: "860px" }}>
      <Defs />
      <Labels x={32} y={yA + 4} lines={["A"]} cls="m big" />
      <Labels x={32} y={yB + 4} lines={["B"]} cls="m big" />
      <Arrow x1={42} y1={yA} x2={64} y2={yA} />
      <Arrow x1={42} y1={yB} x2={64} y2={yB} />
      {encA.el}
      {encB.el}
      <text x={120} y={mid + 4} textAnchor="middle" className="s">
        rare tokens: own fixed random row
      </text>
      <text x={encA.end - 38} y={mid + 22} textAnchor="middle" className="s">
        shared weights
      </text>
      <Arrow x1={encA.end} y1={yA} x2={xAl - 2} y2={yA} />
      <Arrow x1={encB.end} y1={yB} x2={xAl - 2} y2={yB} />
      <Box x={xAl} y={yA - 27} w={wAl} h={yB - yA + 54} tone="accent" lines={["Soft", "alignment", "", "each word of A", "attends to B,", "and B to A"]} />
      <Arrow x1={xAl + wAl} y1={yA} x2={xAl + wAl + 28} y2={yA} />
      <Arrow x1={xAl + wAl} y1={yB} x2={xAl + wAl + 28} y2={yB} />
      {cmpA.el}
      {cmpB.el}
      <path d={`M${cmpA.end},${yA} H${cmpA.end + 18} V${mid - 14} H${xMlp - 2}`} className="wire" markerEnd="url(#arr)" />
      <path d={`M${cmpB.end},${yB} H${cmpB.end + 18} V${mid + 14} H${xMlp - 2}`} className="wire" markerEnd="url(#arr)" />
      <Box x={xMlp} y={mid - 30} w={88} h={60} lines={["MLP 200", "tanh"]} />
      <SigmoidOut x={xMlp + 88} cy={mid} />
    </svg>
  );
}

/* ---------------- Bi-encoder: two separate passes, compared in the head ---------------- */

function BiEncoderFigure() {
  const yA = 60;
  const yB = 190;
  const mid = (yA + yB) / 2;
  const lane: Step[] = [
    { lines: ["DistilBERT", "6 layers"], w: 112, tone: "accent" },
    { lines: ["masked", "mean pool"], w: 92 },
  ];
  const a = chain(150, yA, lane);
  const b = chain(150, yB, lane);
  const xHead = a.end + 96;
  return (
    <svg viewBox="0 0 960 250" className="fig" role="img" aria-label="Bi-encoder architecture diagram" style={{ ["--fig-min" as string]: "720px" }}>
      <Defs />
      <Labels x={70} y={yA + 4} lines={["[CLS] A [SEP]"]} cls="m" />
      <Labels x={70} y={yB + 4} lines={["[CLS] B [SEP]"]} cls="m" />
      <Arrow x1={124} y1={yA} x2={148} y2={yA} />
      <Arrow x1={124} y1={yB} x2={148} y2={yB} />
      <rect x={140} y={yA - 38} width={132} height={yB - yA + 76} rx={12} className="block" />
      <text x={206} y={mid + 4} textAnchor="middle" className="s">
        same weights
      </text>
      {a.el}
      {b.el}
      <Arrow x1={a.end} y1={yA} x2={a.end + 26} y2={yA} />
      <Arrow x1={b.end} y1={yB} x2={b.end + 26} y2={yB} />
      <Labels x={a.end + 38} y={yA + 5} lines={["u"]} cls="m big" />
      <Labels x={b.end + 38} y={yB + 5} lines={["v"]} cls="m big" />
      <path d={`M${a.end + 50},${yA} H${a.end + 66} V${mid - 12} H${xHead - 2}`} className="wire" markerEnd="url(#arr)" />
      <path d={`M${b.end + 50},${yB} H${b.end + 66} V${mid + 12} H${xHead - 2}`} className="wire" markerEnd="url(#arr)" />
      <Box x={xHead} y={mid - 27} w={124} h={54} lines={["[|u−v|; u⊙v]"]} />
      <Arrow x1={xHead + 124} y1={mid} x2={xHead + 150} y2={mid} />
      <Box x={xHead + 152} y={mid - 22} w={64} h={44} lines={["Linear"]} />
      <SigmoidOut x={xHead + 216} cy={mid} />
    </svg>
  );
}

/* ---------------- Cross-encoder: one joined input ---------------- */

function CrossEncoderFigure() {
  const cy = 100;
  const c = chain(150, cy, [
    { lines: ["DistilBERT, 6 layers", "", "attention across", "A's and B's tokens"], w: 150, tone: "accent" },
    { lines: ["mean + max pool", "(all tokens)"], w: 118 },
    { lines: ["MLP 200, tanh", "dropout 0.3"], w: 112 },
  ], 90);
  return (
    <svg viewBox="0 0 840 200" className="fig" role="img" aria-label="Cross-encoder architecture diagram">
      <Defs />
      <Labels x={70} y={cy - 6} lines={["[CLS] A [SEP]", "B [SEP]"]} cls="m" />
      <Arrow x1={124} y1={cy} x2={148} y2={cy} />
      {c.el}
      <SigmoidOut x={c.end} cy={cy} />
    </svg>
  );
}

/* ---------------- LLM: prompt → first-token probabilities + reasoning ---------------- */

function LlmFigure() {
  const cy = 120;
  const yP = 62;
  const yR = 184;
  return (
    <svg viewBox="0 0 900 240" className="fig" role="img" aria-label="LLM scoring diagram" style={{ ["--fig-min" as string]: "680px" }}>
      <Defs />
      <Box x={14} y={cy - 56} w={190} h={112} tone="soft" lines={["Prompt", "", "A: …   B: …", "\u201cAnswer YES or NO first,", "then one sentence why\u201d"]} />
      <Arrow x1={204} y1={cy} x2={234} y2={cy} />
      <Box x={236} y={cy - 40} w={128} h={80} tone="accent" lines={["gpt-4o-mini", "(OpenAI API)", "temperature 0"]} />
      <path d={`M364,${cy} H384 V${yP} H412`} className="wire" markerEnd="url(#arr)" />
      <path d={`M364,${cy} H384 V${yR} H412`} className="wire" markerEnd="url(#arr)" />
      <Box x={414} y={yP - 27} w={160} h={54} lines={["1st token: top-5", "log-probabilities ℓ"]} />
      <Arrow x1={574} y1={yP} x2={600} y2={yP} />
      <Box x={602} y={yP - 27} w={176} h={54} lines={["e^ℓYES / (e^ℓYES + e^ℓNO)"]} />
      <Arrow x1={778} y1={yP} x2={800} y2={yP} />
      <Labels x={846} y={yP - 2} lines={["P(same)"]} cls="t strong" />
      <Labels x={846} y={yP + 16} lines={["same if ≥ 0.5"]} cls="s" />
      <Box x={414} y={yR - 22} w={160} h={44} lines={["rest of the text"]} />
      <Arrow x1={574} y1={yR} x2={600} y2={yR} />
      <Labels x={690} y={yR - 2} lines={["one-sentence reasoning"]} cls="t strong" />
      <Labels x={690} y={yR + 16} lines={["written after the answer"]} cls="s" />
    </svg>
  );
}

/* ---------------- Token overlap: Venn of word sets (live numbers) ---------------- */

const EX = DEMO_PAIRS.find((p) => p.id === "saint-marks")!;

function VennFigure() {
  const A = tokenSet(EX.a);
  const B = tokenSet(EX.b);
  const onlyA = [...A].filter((t) => !B.has(t)).slice(0, 4);
  const onlyB = [...B].filter((t) => !A.has(t)).slice(0, 4);
  const both = [...A].filter((t) => B.has(t)).slice(0, 5);
  const inter = [...A].filter((t) => B.has(t)).length;
  const denom = Math.min(A.size, B.size);
  const words = (list: string[], x: number) =>
    list.map((t, i) => (
      <text key={t} x={x} y={118 + (i - (list.length - 1) / 2) * 17} textAnchor="middle" className="m">
        {t}
      </text>
    ));
  return (
    <svg viewBox="0 0 640 260" className="fig" role="img" aria-label="Venn diagram of word sets">
      <circle cx={265} cy={118} r={100} className="venn a" />
      <circle cx={375} cy={118} r={100} className="venn b" />
      <text x={186} y={20} className="m big">
        A
      </text>
      <text x={444} y={20} className="m big">
        B
      </text>
      {words(onlyA, 212)}
      {words(both, 320)}
      {words(onlyB, 428)}
      <text x={320} y={248} textAnchor="middle" className="m">
        overlap(A, B) = |A ∩ B| / min(|A|, |B|) = {inter}/{denom} {inter / denom >= 0.75 ? "≥" : "<"} τ
      </text>
    </svg>
  );
}
