import { useEffect, useState } from "react";
import type { Address } from "viem";
import { safeActivity, type ActivityRow } from "./chainActivity";
import { CopyButton, short } from "./ui";
import { EXPLORER_TX } from "./wallet";

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

// ------------------------------------------------------------------ plain labels for one row

function action(r: ActivityRow): string {
  const t = r.type;
  if (/^Swap/i.test(t)) return "Swap";
  if (/^Send/i.test(t)) return "Send";
  if (/^Agent/i.test(t)) return "Agent call";
  if (/^Limits installed/i.test(t)) return "Limits installed";
  if (/^Limit change/i.test(t)) return "Limit change";
  if (/^Received/i.test(t)) return "Received";
  if (/^Approve/i.test(t)) return "Approve";
  return "Safe tx";
}

/** Short reason line and a reason code (null when there is nothing to explain). */
function reason(r: ActivityRow): { line: string; code: string | null } {
  const x = `${r.reason} ${r.result}`.toLowerCase();
  if (r.ok === true) return { line: "Within your limits", code: null };
  if (r.ok === null) {
    const s = r.reason || r.result;
    return { line: s ? s[0].toUpperCase() + s.slice(1) : "Done", code: null };
  }
  if (/agent cap|agent_cap/.test(x)) return { line: "Over the agent's cap", code: "AGENT_CAP" };
  if (/max per buy|maximum|amountgt/.test(x)) return { line: "Over max per buy", code: "MAX_PER_BUY" };
  if (/trades? (this|per) hour|tick|too many/.test(x)) return { line: "Too many trades this hour", code: "TRADES_PER_HOUR" };
  if (/quiet/.test(x)) return { line: "Inside quiet hours", code: "QUIET_HOURS" };
  if (/hold/.test(x)) return { line: "Hold lock", code: "HOLD_LOCK" };
  if (/tilt/.test(x)) return { line: "Tilt-shield pause", code: "TILT_SHIELD" };
  if (/over the limit|denied|limit/.test(x)) return { line: "Over the limit", code: "LIMIT" };
  if (/revert|fail/.test(x)) return { line: "The call inside failed", code: "FAILED" };
  return { line: "Refused", code: "REFUSED" };
}

/** Amounts recorded by this browser are numbers only: take the token from the action text. */
function amount(r: ActivityRow): string {
  if (/^\d[\d.,]*$/.test(r.amount.trim())) {
    const m = r.type.match(/\d[\d.,]*\s+([A-Z0-9]{2,})/);
    return m ? `${r.amount} ${m[1]}` : r.amount;
  }
  return r.amount;
}

function age(t: number | null): { rel: string; exact: string } {
  if (t === null) return { rel: "on chain", exact: "" };
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  const rel =
    s < 60 ? `${s} secs ago` : s < 3600 ? `${Math.floor(s / 60)} min${s < 120 ? "" : "s"} ago` : s < 86_400 ? `${Math.floor(s / 3600)} hr${s < 7200 ? "" : "s"} ago` : `${Math.floor(s / 86_400)} day${s < 172_800 ? "" : "s"} ago`;
  return { rel, exact: new Date(t * 1000).toLocaleString() };
}

/** Etherscan-style table, one line per cell. On narrow screens it scrolls sideways in its own box with the
 * Transaction column sticky. */
export function ActivityTable({
  rows,
  err,
  max,
  pageSize,
  empty,
}: {
  rows: ActivityRow[] | null;
  err?: string | null;
  max?: number;
  pageSize?: number;
  empty?: string;
}) {
  const [page, setPage] = useState(0);
  const all = rows ?? [];
  const pages = pageSize ? Math.max(1, Math.ceil(all.length / pageSize)) : 1;
  const list = pageSize ? all.slice(page * pageSize, (page + 1) * pageSize) : all.slice(0, max ?? all.length);
  return (
    <div className="act-wrap">
      <div className="act-scroll">
        <table className="act">
          <colgroup>
            <col className="c-tx" />
            <col style={{ width: 204 }} />
            <col />
            <col style={{ width: 244 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky">Transaction</th>
              <th>Action</th>
              <th>Result</th>
              <th className="r">Amount</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td className="sticky muted" colSpan={5}>Reading X Layer…</td>
              </tr>
            )}
            {rows !== null && list.length === 0 && (
              <tr>
                <td className="sticky muted" colSpan={5}>{err ? `Could not read the chain: ${err}` : (empty ?? "Nothing yet.")}</td>
              </tr>
            )}
            {list.map((r, i) => {
              const sim = !r.tx;
              const rs = reason(r);
              const a = age(r.time);
              const tone = r.ok === true ? "g" : r.ok === false ? "r" : "n";
              return (
                <tr key={`${r.tx ?? "sim"}-${i}`}>
                  <td className="sticky">
                    {r.tx ? (
                      <span className="act-tx">
                        <a className="mono code-link" href={EXPLORER_TX(r.tx)} target="_blank" rel="noreferrer noopener" title={r.tx}>
                          {short(r.tx)}
                        </a>
                        <CopyButton text={r.tx} label="Copy transaction ID" />
                      </span>
                    ) : (
                      <span className="mono muted">Not sent</span>
                    )}
                  </td>
                  <td>
                    <span className="chip-s">{action(r)}</span>
                  </td>
                  <td>
                    <div className="act-res">
                      <span className="act-line">
                        <span className={`tag ${tone}`}>{r.ok === true ? "Allowed" : r.ok === false ? "Refused" : "Done"}</span>
                        {rs.code && <span className="tag n mono">{rs.code}</span>}
                        {sim && <span className="tag n">Simulated</span>}
                      </span>
                      <span className="act-why">{rs.line}</span>
                    </div>
                  </td>
                  <td className="r">
                    <span className="mono act-amt" title={amount(r)}>{amount(r)}</span>
                  </td>
                  <td>
                    <span className="muted act-age" title={a.exact}>{a.rel}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pageSize && pages > 1 && (
        <div className="act-pages">
          <button type="button" className="pill line" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</button>
          <span className="mono muted" style={{ fontSize: 12 }}>
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="pill line" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Older</button>
        </div>
      )}
    </div>
  );
}
