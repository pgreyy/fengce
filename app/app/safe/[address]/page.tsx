import { getAddress } from "viem";
import { safeStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

const ZERO = "0x0000000000000000000000000000000000000000";

export default async function SafePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const s = (await safeStatus(getAddress(address))) as any;
  const f = s.fengce;
  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <h1>Safe {s.safe}</h1>
      <table><tbody>
        <tr><th>Version</th><td>{s.version}</td></tr>
        <tr><th>Owners</th><td className="mono">{s.owners.join(", ")}</td></tr>
        <tr><th>Threshold / nonce</th><td>{s.threshold} / {s.nonce}</td></tr>
        <tr><th>Modules</th><td className="mono">{s.modules.length ? s.modules.join(", ") : "none"}</td></tr>
        <tr><th>Guard</th><td className="mono">{s.guard === ZERO ? "none" : s.guard}</td></tr>
        <tr><th>Module guard</th><td className="mono">{s.moduleGuard === ZERO ? "none" : s.moduleGuard}</td></tr>
        <tr><th>Fallback handler</th><td className="mono">{s.fallbackHandler}</td></tr>
      </tbody></table>
      <h2>Fengce</h2>
      {f ? (
        <table><tbody>
          <tr><th>Configured</th><td>{String(f.set)}</td></tr>
          <tr><th>Pin</th><td className="mono">{f.pinId}</td></tr>
          <tr><th>Delays (recovery / window / admin, s)</th><td>{f.recoveryDelay} / {f.recoveryWindow} / {f.adminDelay}</td></tr>
          <tr><th>Tick group</th><td className="mono">{f.tick === ZERO ? "none" : `${f.tick} ${f.tickGroup}`}</td></tr>
          <tr><th>Recovery</th><td>{f.recovery.readyAt === "0" ? "not scheduled" : `ready at ${f.recovery.readyAt}, expires ${f.recovery.expiresAt}${Number(f.recovery.readyAt) > now ? " (waiting)" : ""}`}</td></tr>
        </tbody></table>
      ) : (
        <p className="muted">No FengceGuard on this Safe.</p>
      )}
      <h2>Pending and past timelocks, recovery (last {s.eventsWindowBlocks} blocks)</h2>
      {s.events.length === 0 ? <p className="muted">No guard events in this window.</p> : (
        <table>
          <thead><tr><th>Block</th><th>Event</th><th>Arguments</th><th>Transaction</th></tr></thead>
          <tbody>{s.events.map((e: any, i: number) => (
            <tr key={i}><td>{e.block}</td><td>{e.event}</td><td className="mono">{JSON.stringify(e.args)}</td><td className="mono">{e.tx}</td></tr>
          ))}</tbody>
        </table>
      )}
      <h2>Blocked attempts</h2>
      <p className="muted">{s.blockedAttempts}</p>
    </>
  );
}
