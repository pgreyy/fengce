import { useEffect, useMemo, useState } from "react";
import type { CircuitTrace } from "@fengce/sdk";

const COL = 62;
const ROW = 22;
const PAD = 34;
const GW = 18;
const GH = 14;
/** Above this many top-level records the graph is replaced by a per-level activity strip. */
export const MAX_GATES = 300;

function reducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Steps a level counter from -1 to depth + 1 (outputs); jumps straight to the end with reduced motion. */
export function useLevelClock(depth: number, runKey: number, onDone?: () => void) {
  const [cur, setCur] = useState(-1);
  useEffect(() => {
    if (runKey === 0) return;
    if (reducedMotion()) {
      setCur(depth + 1);
      onDone?.();
      return;
    }
    setCur(-1);
    const step = Math.max(40, Math.min(220, Math.round(1800 / Math.max(1, depth))));
    let c = -1;
    const t = setInterval(() => {
      c += 1;
      setCur(c);
      if (c > depth) {
        clearInterval(t);
        onDone?.();
      }
    }, step);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, depth]);
  return cur;
}

interface Node {
  x: number;
  y: number;
  h: number;
}

function layout(t: CircuitTrace) {
  const used = new Set<number>();
  for (const r of t.records) r.ins.forEach((s) => used.add(s));
  t.outputs.forEach((s) => used.add(s));
  const rows = new Map<number, number>(); // level -> next row
  const take = (level: number, n: number) => {
    const r = rows.get(level) ?? 0;
    rows.set(level, r + n);
    return r;
  };
  const sig = new Map<number, Node>(); // signal -> output point
  const rec: Node[] = [];
  const colX = (level: number) => PAD + 40 + level * COL;
  // level 0: constants actually used, inputs, latches
  for (const s of [0, 1]) if (used.has(s)) sig.set(s, { x: colX(0), y: PAD + take(0, 1) * ROW, h: GH });
  for (let i = 0; i < t.nIn; i++) sig.set(2 + i, { x: colX(0), y: PAD + take(0, 1) * ROW, h: GH });
  t.records.forEach((r, k) => {
    const n = r.op === "ref" ? Math.max(r.ins.length, r.outs.length, 2) : 1;
    const row = take(r.level, n);
    const node = { x: colX(r.level), y: PAD + row * ROW, h: r.op === "ref" ? n * ROW - 8 : GH };
    rec[k] = node;
    r.outs.forEach((s, j) => sig.set(s, { x: node.x, y: r.op === "ref" ? node.y + j * ROW : node.y, h: GH }));
  });
  const outX = colX(t.depth + 1);
  const maxRows = Math.max(...rows.values(), t.outputs.length);
  return { sig, rec, outX, width: outX + 90, height: PAD * 2 + maxRows * ROW };
}

function wire(a: Node, b: { x: number; y: number }) {
  const x1 = a.x + GW;
  const y1 = a.y + GH / 2;
  const x2 = b.x;
  const y2 = b.y;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

const NAND_PATH = `M0,0 H${GW / 2} A${GH / 2},${GH / 2} 0 0 1 ${GW / 2},${GH} H0 Z`;

export function GateGraph({
  trace,
  cur,
  fields,
  depthLabel = true,
}: {
  trace: CircuitTrace;
  cur: number;
  fields?: string[];
  depthLabel?: boolean;
}) {
  const L = useMemo(() => layout(trace), [trace]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const done = (level: number) => level <= cur;
  const val = (s: number) => trace.values[s];
  const lvl = (s: number) => trace.levels[s];
  const wireClass = (s: number) => (done(lvl(s)) ? (val(s) ? "wire on1" : "wire on0") : "wire");
  const refs = trace.records.map((r, k) => ({ r, k })).filter((x) => x.r.op === "ref");

  if (trace.records.length > MAX_GATES) return <ActivityStrip trace={trace} cur={cur} refs={refs} open={open} setOpen={setOpen} />;

  return (
    <>
      <div className="stage">
        <svg width={L.width} height={L.height} role="img" aria-label={`Gate graph: ${trace.records.length} records over ${trace.depth} levels`}>
          {trace.records.map((r, k) => {
            const n = L.rec[k];
            return r.ins.map((s, j) => {
              const from = L.sig.get(s);
              if (!from) return null;
              const to = r.op === "ref" ? { x: n.x, y: n.y + j * ROW + GH / 2 } : { x: n.x, y: n.y + (j === 0 ? 3 : GH - 3) };
              return <path key={`${k}-${j}`} className={wireClass(s)} d={wire(from, to)} />;
            });
          })}
          {trace.outputs.map((s, j) => {
            const from = L.sig.get(s)!;
            return <path key={`o${j}`} className={done(trace.depth + 1) ? (val(s) ? "wire on1" : "wire on0") : "wire"} d={wire(from, { x: L.outX, y: PAD + j * ROW + GH / 2 })} />;
          })}
          {[0, 1].map((s) =>
            L.sig.has(s) ? (
              <g key={`c${s}`} className={`gate ${done(0) ? `v${s}` : "pending"}`} transform={`translate(${L.sig.get(s)!.x},${L.sig.get(s)!.y})`}>
                <rect width={GW} height={GH} />
                <text x={-6} y={GH - 3} textAnchor="end">
                  {s}
                </text>
              </g>
            ) : null,
          )}
          {[...Array(trace.nIn).keys()].map((i) => {
            const n = L.sig.get(2 + i)!;
            return (
              <g key={`i${i}`} className={`gate ${done(0) ? `v${val(2 + i)}` : "pending"}`} transform={`translate(${n.x},${n.y})`}>
                <rect width={GW} height={GH} />
                <text x={-6} y={GH - 3} textAnchor="end">
                  {fields?.[i] ?? `in${i}`}
                </text>
              </g>
            );
          })}
          {trace.records.map((r, k) => {
            const n = L.rec[k];
            if (r.op === "ref") {
              const on = done(r.level) && r.outs.some((s) => val(s) === 1);
              return (
                <g key={k} className={`refbox ${on ? "v1" : ""}`} transform={`translate(${n.x},${n.y})`} onClick={() => setOpen(toggle(open, k))}>
                  <rect width={GW + 34} height={n.h + 6} y={-3} />
                  <text x={4} y={9}>
                    REF #{r.ref!.id.toString()}
                  </text>
                  <text x={4} y={20}>
                    {open.has(k) ? "−" : "+"} {r.ref!.trace.records.length}g
                  </text>
                </g>
              );
            }
            const state = done(r.level) ? `v${val(r.outs[0])}` : "pending";
            return (
              <g key={k} className={`gate ${state} ${r.level === cur ? "pulse" : ""}`} transform={`translate(${n.x},${n.y})`}>
                {r.op === "nand" ? <path d={NAND_PATH} /> : <rect width={GW} height={GH} />}
                {r.op === "latch" && (
                  <text x={GW + 3} y={GH - 3}>
                    L
                  </text>
                )}
              </g>
            );
          })}
          {trace.outputs.map((s, j) => (
            <g key={`out${j}`} className={`gate ${done(trace.depth + 1) ? `v${val(s)}` : "pending"}`} transform={`translate(${L.outX},${PAD + j * ROW})`}>
              <rect width={GW} height={GH} />
              <text x={GW + 6} y={GH - 3}>
                {trace.outputs.length > 1 ? `out${j}` : "out"}
              </text>
            </g>
          ))}
        </svg>
        {depthLabel && (
          <div className="levelbar">
            <span>
              level {Math.max(0, Math.min(cur, trace.depth))} / {trace.depth}
            </span>
            <span>
              {trace.records.length} records · {trace.records.filter((r) => r.op === "ref").length} REF
            </span>
          </div>
        )}
      </div>
      <RefPanels trace={trace} refs={refs} open={open} />
    </>
  );
}

function toggle(s: Set<number>, k: number) {
  const n = new Set(s);
  if (n.has(k)) n.delete(k);
  else n.add(k);
  return n;
}

function RefPanels({ trace, refs, open }: { trace: CircuitTrace; refs: { r: CircuitTrace["records"][number]; k: number }[]; open: Set<number> }) {
  return (
    <>
      {refs
        .filter((x) => open.has(x.k))
        .map(({ r, k }) => (
          <div key={k} style={{ marginTop: 14 }}>
            <h3 className="mono" style={{ fontSize: 12, textTransform: "none" }}>
              REF #{r.ref!.id.toString()} on {r.ref!.cpu.slice(0, 8)}… · inputs {r.ins.map((s) => trace.values[s]).join("")} → outputs{" "}
              {r.outs.map((s) => trace.values[s]).join("")}
            </h3>
            <GateGraph trace={r.ref!.trace} cur={Number.MAX_SAFE_INTEGER} depthLabel={false} />
          </div>
        ))}
    </>
  );
}

function ActivityStrip({
  trace,
  cur,
  refs,
  open,
  setOpen,
}: {
  trace: CircuitTrace;
  cur: number;
  refs: { r: CircuitTrace["records"][number]; k: number }[];
  open: Set<number>;
  setOpen: (s: Set<number>) => void;
}) {
  const per = useMemo(() => {
    const p = [...Array(trace.depth + 1)].map(() => ({ one: 0, zero: 0 }));
    for (const r of trace.records) for (const s of r.outs) (trace.values[s] ? (p[r.level].one += 1) : (p[r.level].zero += 1));
    return p;
  }, [trace]);
  const max = Math.max(1, ...per.map((x) => x.one + x.zero));
  return (
    <>
      <div className="stage">
        <div className="strip" role="img" aria-label={`Activity per level: ${trace.records.length} records over ${trace.depth} levels`}>
          {per.slice(1).map((p, i) => {
            const level = i + 1;
            const on = level <= cur;
            return (
              <div className="lv" key={level} title={`level ${level}: ${p.one} high, ${p.zero} low`}>
                <span style={{ height: `${(p.one / max) * 96}px`, background: on ? "var(--allowed)" : "var(--line)" }} />
                <span style={{ height: `${(p.zero / max) * 96}px`, background: on ? "var(--muted)" : "var(--line)", opacity: on ? 0.45 : 1 }} />
              </div>
            );
          })}
        </div>
        <div className="levelbar">
          <span>
            level {Math.max(0, Math.min(cur, trace.depth))} / {trace.depth} · amber: gates outputting 1
          </span>
          <span>{trace.records.length} records (graph shown up to {MAX_GATES})</span>
        </div>
      </div>
      {refs.length > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          {refs.map(({ r, k }) => (
            <button key={k} className="btn ghost" type="button" onClick={() => setOpen(toggle(open, k))}>
              {open.has(k) ? "−" : "+"} REF #{r.ref!.id.toString()}
            </button>
          ))}
        </div>
      )}
      <RefPanels trace={trace} refs={refs} open={open} />
    </>
  );
}
