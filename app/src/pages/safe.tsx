import { useState } from "react";
import { isAddress, type Address } from "viem";
import { ADDR, DEPLOYMENT } from "../lib/chain";
import { safeStatus } from "../lib/data";
import { Addr, ErrorLine, Figure, HistoryNote, Loading, Section, fmtDuration, fmtInt, href, loadSnapshot, mount, param, useLoad } from "../ui/kit";

function SafePage() {
  const safe = (param("address") ?? DEPLOYMENT.demoSafe) as Address;
  const [input, setInput] = useState(safe);
  const valid = isAddress(safe);
  const { data, error, loading, reload } = useLoad(async () => (valid ? ((await safeStatus(safe, await loadSnapshot())) as any) : null), [safe]);
  const f = data?.fengce;
  const guarded = data && data.guard?.toLowerCase() === ADDR.guard.toLowerCase();
  const moduleGuarded = data && data.moduleGuard?.toLowerCase() === ADDR.guard.toLowerCase();
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <>
      <h1 className="title">Safe status</h1>
      <form
        className="row"
        style={{ maxWidth: 640, marginBottom: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          location.href = href("safe", { address: input });
        }}
      >
        <input className="mono" value={input} onChange={(e) => setInput(e.target.value as Address)} placeholder="0x… Safe address" style={{ flex: 1 }} />
        <button className="btn" type="submit">
          Read
        </button>
      </form>
      {!valid && <p className="err">Not an address.</p>}
      {safe.toLowerCase() === DEPLOYMENT.demoSafe.toLowerCase() && <p className="muted">The demo Safe of release v2: one owner, a 1 USDT0 cap, one agent.</p>}
      {loading && <Loading what="the Safe" />}
      <ErrorLine error={error} retry={reload} />
      {data && (
        <>
          <div className="figures" style={{ margin: "26px 0 8px" }}>
            <Figure v={`${data.threshold}/${data.owners.length}`} k="Signatures / owners" />
            <Figure v={guarded && moduleGuarded ? "ON" : guarded || moduleGuarded ? "PART" : "OFF"} k="Fengce guards (both paths)" tone={guarded && moduleGuarded ? "amber" : "red"} />
            <Figure v={fmtInt(data.deniedAgentCalls.length)} k="Denied agent calls since v2" tone={data.deniedAgentCalls.length ? "red" : undefined} />
            <Figure v={fmtInt(data.nonce)} k="Safe nonce" />
          </div>
          <Section n={5} label="Configuration" aside={<Addr a={data.safe} />}>
            <div className="grid">
              <div className="c6">
                <dl className="kv">
                  <dt>Version</dt>
                  <dd className="mono">{data.version}</dd>
                  <dt>Owners</dt>
                  <dd>
                    {data.owners.map((o: string) => (
                      <div key={o}>
                        <Addr a={o} />
                      </div>
                    ))}
                  </dd>
                  <dt>Guard</dt>
                  <dd>
                    <Addr a={data.guard} /> {guarded ? <span className="amber mono">FengceGuard v2</span> : null}
                  </dd>
                  <dt>Module guard</dt>
                  <dd>
                    <Addr a={data.moduleGuard} /> {moduleGuarded ? <span className="amber mono">FengceGuard v2</span> : null}
                  </dd>
                  <dt>Modules</dt>
                  <dd>
                    {data.modules.length
                      ? data.modules.map((m: string) => (
                          <div key={m}>
                            <Addr a={m} /> {m.toLowerCase() === data.agentExecutor?.toLowerCase() ? <span className="mono muted">AgentExecutor</span> : null}
                          </div>
                        ))
                      : "none"}
                  </dd>
                  <dt>Fallback</dt>
                  <dd>
                    <Addr a={data.fallbackHandler} />
                  </dd>
                </dl>
              </div>
              <div className="c6">
                <h3>Timelocks</h3>
                {f ? (
                  <div className="tablewrap">
                    <table className="dt">
                      <tbody>
                        <tr>
                          <td>Policy pin</td>
                          <td className="num">{`${String(f.pinId).slice(0, 10)}…${String(f.pinId).slice(-6)}`}</td>
                        </tr>
                        <tr>
                          <td>Admin delay (policy and module changes)</td>
                          <td className="num">{fmtDuration(f.adminDelay)}</td>
                        </tr>
                        <tr>
                          <td>Recovery delay (all owners sign)</td>
                          <td className="num">{fmtDuration(f.recoveryDelay)}</td>
                        </tr>
                        <tr>
                          <td>Recovery window</td>
                          <td className="num">{fmtDuration(f.recoveryWindow)}</td>
                        </tr>
                        <tr>
                          <td>Scheduled recovery</td>
                          <td className="num">
                            {BigInt(f.recovery.readyAt) === 0n
                              ? "none"
                              : BigInt(f.recovery.readyAt) > now
                                ? `ready in ${fmtDuration(BigInt(f.recovery.readyAt) - now)}`
                                : "ready"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">The transaction guard is not a FengceGuard (or not configured).</p>
                )}
              </div>
            </div>
          </Section>
          <Section n={6} label="Denied attempts" aside={<HistoryNote h={data.history} />}>
            {data.deniedAgentCalls.length ? (
              <div className="tablewrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th className="num">Block</th>
                      <th>Tx</th>
                      <th>Agent</th>
                      <th>Target</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.deniedAgentCalls].reverse().map((d: any) => (
                      <tr key={`${d.tx}:${d.logIndex}`}>
                        <td className="num">{fmtInt(d.block)}</td>
                        <td>
                          <Addr a={d.tx} kind="tx" n={6} />
                        </td>
                        <td>
                          <Addr a={String(d.args.agent)} />
                        </td>
                        <td>
                          <Addr a={String(d.args.target)} />
                        </td>
                        <td className="mono red">{String(d.args.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No Denied events for this Safe since the v2 deployment.</p>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              History: the snapshot shipped with this site, then a live scan of newer blocks (X Layer RPCs answer eth_getLogs for at most 100
              blocks per request). Owner transactions the guard blocks revert and leave no event.
            </p>
          </Section>
          <Section n={7} label="Guard events" aside={<HistoryNote h={data.history} />}>
            {data.events.length ? (
              <div className="tablewrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th className="num">Block</th>
                      <th>Event</th>
                      <th>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.events].reverse().map((e: any, i: number) => (
                      <tr key={i}>
                        <td className="num">{fmtInt(e.block)}</td>
                        <td className="mono">{e.event}{e.args.pinId ? ` ${String(e.args.pinId).slice(0, 10)}…` : ""}</td>
                        <td>
                          <Addr a={e.tx} kind="tx" n={6} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No guard events for this Safe since the v2 deployment.</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}

mount("safe", 1, <SafePage />);
