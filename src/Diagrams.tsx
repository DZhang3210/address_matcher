import type { ReactNode } from "react";
import { PAIRS } from "./data/pairs";
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
  logreg: {
    n: 2,
    caption: "Logistic regression over hand-engineered pair features.",
    refs: [
      { label: "Fellegi & Sunter, A Theory for Record Linkage (1969)", href: "https://doi.org/10.1080/01621459.1969.10501049" },
    ],
    svg: () => <NeuronFigure />,
  },
  transformer: {
    n: 3,
    caption: "Transformer encoder used as a cross-encoder over the concatenated pair.",
    refs: [
      { label: "Vaswani et al., Attention Is All You Need (2017)", href: "https://arxiv.org/abs/1706.03762" },
      { label: "Li et al., Ditto: Deep Entity Matching (2020)", href: "https://arxiv.org/abs/2004.00584" },
    ],
    svg: () => (
      <StackFigure
        n="N×"
        attention={["Multi-Head", "Attention"]}
        embed={["Input", "Embedding"]}
        positional
        input={["[CLS] A", "[SEP] B"]}
        output={["P(same)", "P(diff)"]}
      />
    ),
  },
  llm: {
    n: 4,
    caption: "Decoder-only transformer (~10¹¹ parameters), prompted zero-shot.",
    refs: [
      { label: "Brown et al., Language Models are Few-Shot Learners (2020)", href: "https://arxiv.org/abs/2005.14165" },
      { label: "Narayan et al., Can Foundation Models Wrangle Your Data? (2022)", href: "https://arxiv.org/abs/2205.09911" },
    ],
    svg: () => (
      <StackFigure
        n="96×"
        attention={["Masked", "Multi-Head", "Self-Attn"]}
        embed={["Text &", "Position", "Embed"]}
        input={["“Same", "address?”"]}
        output={["“SAME” |", "“DIFF”"]}
      />
    ),
  },
};

export function ModelDiagram({ model }: { model: Model }) {
  const fig = FIGURES[model.id];
  if (!fig) return null;
  return (
    <section className="diagram" aria-label={`Architecture of the ${model.short}`}>
      <h2 className="diagram-title">What you're up against</h2>
      <figure className="figure-card">
        <div className="fig-scroll">{fig.svg()}</div>
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

/* ---------------- Transformer stack, laid on its side ---------------- */

function StackFigure({
  n,
  attention,
  embed,
  positional,
  input,
  output,
}: {
  n: string;
  attention: string[];
  embed: string[];
  positional?: boolean;
  input: string[];
  output: string[];
}) {
  const cy = 112;
  const h = 70;
  const y = cy - h / 2;
  // x positions, left to right
  const xIn = 38;
  const xEmb = 82;
  const wEmb = 84;
  const xPlus = 198;
  const xBlk = 226;
  const xAttn = 252;
  const xAN1 = 352;
  const xFF = 424;
  const xAN2 = 520;
  const wAttn = 82;
  const wAN = 56;
  const wFF = 74;
  const xBlkEnd = xAN2 + wAN + 18;
  const xLin = xBlkEnd + 26;
  const wLin = 64;
  const xSm = xLin + wLin + 22;
  const wSm = 72;
  const xOut = xSm + wSm + 46;
  const W = xOut + 40;

  return (
    <svg viewBox={`0 0 ${W} 220`} className="fig" role="img" aria-label="Transformer architecture diagram">
      <Defs />
      {/* inputs */}
      <Labels x={xIn} y={cy - 18} lines={["Inputs"]} />
      <Labels x={xIn} y={cy + 2} lines={input} cls="m" />
      <Arrow x1={xIn + 30} y1={cy} x2={xEmb - 2} y2={cy} />
      <Box x={xEmb} y={y} w={wEmb} h={h} tone="soft" lines={embed} />

      {/* positional encoding */}
      {positional ? (
        <>
          <line x1={xEmb + wEmb} y1={cy} x2={xPlus - 9} y2={cy} className="wire" />
          <circle cx={xPlus} cy={cy} r={9} className="node" />
          <path d={`M${xPlus - 5},${cy} H${xPlus + 5} M${xPlus},${cy - 5} V${cy + 5}`} className="wire" />
          <circle cx={xPlus} cy={cy + 62} r={12} className="node" />
          <path d={`M${xPlus - 8},${cy + 62} q4,-9 8,0 t8,0`} className="wire" fill="none" />
          <Arrow x1={xPlus} y1={cy + 50} x2={xPlus} y2={cy + 11} />
          <Labels x={xPlus} y={cy + 92} lines={["Positional", "Encoding"]} cls="s" />
          <Arrow x1={xPlus + 9} y1={cy} x2={xAttn - 24} y2={cy} />
        </>
      ) : (
        <Arrow x1={xEmb + wEmb} y1={cy} x2={xAttn - 24} y2={cy} />
      )}

      {/* repeated block */}
      <rect x={xBlk} y={y - 34} width={xBlkEnd - xBlk} height={h + 68} rx={14} className="block" />
      <text x={xBlk + 8} y={y - 42} className="t strong">
        {n}
      </text>

      {/* Q, K, V into attention */}
      <line x1={xAttn - 24} y1={cy - 22} x2={xAttn - 24} y2={cy + 22} className="wire" />
      {[-22, 0, 22].map((dy) => (
        <Arrow key={dy} x1={xAttn - 24} y1={cy + dy} x2={xAttn - 2} y2={cy + dy} />
      ))}
      <Box x={xAttn} y={y} w={wAttn} h={h} tone="accent" lines={attention} />
      <Arrow x1={xAttn + wAttn} y1={cy} x2={xAN1 - 2} y2={cy} />
      <Box x={xAN1} y={y} w={wAN} h={h} lines={["Add &", "Norm"]} />
      <Arrow x1={xAN1 + wAN} y1={cy} x2={xFF - 2} y2={cy} />
      <Box x={xFF} y={y} w={wFF} h={h} tone="soft" lines={["Feed", "Forward"]} />
      <Arrow x1={xFF + wFF} y1={cy} x2={xAN2 - 2} y2={cy} />
      <Box x={xAN2} y={y} w={wAN} h={h} lines={["Add &", "Norm"]} />

      {/* residual connections, arcing over the top */}
      <path d={`M${xAttn - 14},${cy - 22} V${y - 16} H${xAN1 + wAN / 2} V${y - 2}`} className="wire" fill="none" markerEnd="url(#arr)" />
      <path
        d={`M${(xAN1 + wAN + xFF) / 2},${cy} V${y - 16} H${xAN2 + wAN / 2} V${y - 2}`}
        className="wire"
        fill="none"
        markerEnd="url(#arr)"
      />

      {/* head */}
      <Arrow x1={xAN2 + wAN} y1={cy} x2={xLin - 2} y2={cy} />
      <Box x={xLin} y={y + 10} w={wLin} h={h - 20} lines={["Linear"]} />
      <Arrow x1={xLin + wLin} y1={cy} x2={xSm - 2} y2={cy} />
      <Box x={xSm} y={y + 10} w={wSm} h={h - 20} tone="accent" lines={["Softmax"]} />
      <Arrow x1={xSm + wSm} y1={cy} x2={xOut - 34} y2={cy} />
      <Labels x={xOut} y={cy - 18} lines={["Output"]} />
      <Labels x={xOut} y={cy + 2} lines={output} cls="m" />
    </svg>
  );
}

/* ---------------- Logistic regression: single-unit diagram ---------------- */

function NeuronFigure() {
  const inputs = [
    { y: 40, label: "x₁", w: "w₁" },
    { y: 92, label: "x₂", w: "w₂" },
    { y: 180, label: "xₙ", w: "wₙ" },
  ];
  const sx = 310;
  const sy = 128;
  return (
    <svg viewBox="0 0 640 270" className="fig" role="img" aria-label="Logistic regression diagram">
      <Defs />
      <Labels x={70} y={14} lines={["pair features"]} cls="s" />
      {inputs.map((n) => (
        <g key={n.label}>
          <line x1={86} y1={n.y} x2={sx - 30} y2={sy} className="wire" markerEnd="url(#arr)" />
          <circle cx={70} cy={n.y} r={16} className="node soft" />
          <text x={70} y={n.y + 5} textAnchor="middle" className="m big">
            {n.label}
          </text>
          <text x={(86 + sx - 30) / 2} y={(n.y + sy) / 2 - 7} textAnchor="middle" className="m">
            {n.w}
          </text>
        </g>
      ))}
      <text x={70} y={142} textAnchor="middle" className="t big">
        ⋮
      </text>
      <line x1={86} y1={236} x2={sx - 24} y2={sy + 18} className="wire" markerEnd="url(#arr)" />
      <circle cx={70} cy={236} r={16} className="node" />
      <text x={70} y={241} textAnchor="middle" className="t">
        +1
      </text>
      <text x={190} y={200} textAnchor="middle" className="m">
        b
      </text>

      <circle cx={sx} cy={sy} r={30} className="node accent" />
      <text x={sx} y={sy + 9} textAnchor="middle" className="t huge">
        Σ
      </text>
      <text x={sx} y={sy + 52} textAnchor="middle" className="m">
        z = wᵀx + b
      </text>

      <Arrow x1={sx + 30} y1={sy} x2={398} y2={sy} />
      <rect x={400} y={sy - 30} width={78} height={60} rx={8} className="bx soft" />
      <path d={`M410,${sy + 16} C436,${sy + 16} 430,${sy - 16} 468,${sy - 16}`} className="curve" />
      <text x={439} y={sy + 50} textAnchor="middle" className="m">
        σ(z)
      </text>

      <Arrow x1={478} y1={sy} x2={540} y2={sy} />
      <circle cx={566} cy={sy} r={24} className="node accent" />
      <text x={566} y={sy + 6} textAnchor="middle" className="m big">
        ŷ
      </text>
      <text x={566} y={sy + 44} textAnchor="middle" className="s">
        P(match)
      </text>

      <text x={330} y={262} textAnchor="middle" className="m">
        ŷ = σ( Σᵢ wᵢ xᵢ + b ),  match ⇔ ŷ &gt; 0.5
      </text>
    </svg>
  );
}

/* ---------------- Token overlap: Venn of word sets (live numbers) ---------------- */

const EX = PAIRS.find((p) => p.id === "saint-marks")!;

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
