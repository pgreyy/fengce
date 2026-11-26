import { useEffect, useState } from "react";
import type { Address } from "viem";
import { safeActivity, type ActivityRow } from "./chainActivity";
import { CopyButton } from "./ui";
import { EXPLORER_TX } from "./wallet";

const fmtTime = (t: number | null) => {
  if (t === null) return "on chain";
  const d = new Date(t * 1000);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days < 1 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function useActivity(safe: Address | null, limit = 25, bump = 0) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!safe) return setRows([]);
    let live = true;
    setRows(null);
    setErr(null);
    // the Safe's own transactions first (fast), then again with agent events from the Fengce history (slower)
    safeActivity(safe, limit, false).then((r) => live && setRows((cur) => cur ?? r), () => undefined);
    safeActivity(safe, limit).then((r) => live && setRows(r), (e) => live && (setErr((e as Error).message), setRows((cur) => cur ?? [])));
    return () => void (live = false);
  }, [safe, limit, bump]);
  return { rows, err };
}

/** Newest first: time, type, amount, result and reason, the full transaction hash with copy and an OKLink link. */
export function ActivityTable({ rows, err, max, empty }: { rows: ActivityRow[] | null; err?: string | null; max?: number; empty?: string }) {
  const list = rows ? rows.slice(0, max ?? rows.length) : [];
  return (
    <div className="scroll-x">
      <table className="rt stk act" style={{ minWidth: 820 }}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th className="r">Amount</th>
            <th>Result</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows === null && (
            <tr>
              <td colSpan={5} className="muted">Reading X Layer…</td>
            </tr>
          )}
          {rows !== null && list.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">{err ? `Could not read the chain: ${err}` : (empty ?? "Nothing yet.")}</td>
            </tr>
          )}
          {list.map((r, i) => (
            <tr key={`${r.tx ?? "local"}-${i}`}>
              <td data-label="Time" className="mono muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{fmtTime(r.time)}</td>
              <td data-label="Type">{r.type}</td>
              <td data-label="Amount" className="r num" style={{ whiteSpace: "nowrap" }}>{r.amount}</td>
              <td data-label="Result" className="mono" style={{ fontSize: 13.5 }}>
                <span style={{ color: r.ok === null ? "var(--muted)" : r.ok ? "var(--allow)" : "var(--deny)" }}>{r.result}</span>
                {r.reason && <span className="muted"> · {r.reason}</span>}
              </td>
              <td data-label="Transaction">
                {r.tx ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <a className="mono" href={EXPLORER_TX(r.tx)} target="_blank" rel="noreferrer noopener" title="Open on OKLink (X Layer explorer)" style={{ fontSize: 12, overflowWrap: "anywhere", textDecoration: "underline", textDecorationColor: "var(--line)" }}>
                      {r.tx}
                    </a>
                    <CopyButton text={r.tx} label="Copy transaction ID" />
                  </span>
                ) : (
                  <span className="mono muted" style={{ fontSize: 12 }}>not sent</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
