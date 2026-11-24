import { useEffect, useState } from "react";
import { onSync, syncHistory, type SyncState } from "../lib/events";
import { fmtInt, loadSnapshot } from "./kit";

/** The page's event history, synced in the background (snapshot, then this browser's cache, then a live scan). Views
 * render their on-chain state at once and fill in event-derived numbers when this finishes. */
export function useEventSync(): SyncState {
  const [s, setS] = useState<SyncState>({ phase: "syncing", done: 0, total: 0, history: null });
  useEffect(() => {
    const off = onSync(setS);
    loadSnapshot().then((snap) => syncHistory(snap).catch(() => undefined));
    return off;
  }, []);
  return s;
}

/** "syncing events…" with a progress hint, or where the history came from once done. */
export function SyncNote({ s }: { s: SyncState }) {
  if (s.phase === "error") return <span className="mono red">events not read: {s.error}</span>;
  if (s.phase === "syncing") {
    const pct = s.total ? Math.floor((s.done / s.total) * 100) : 0;
    return (
      <span className="mono muted" aria-live="polite">
        syncing events…{s.total ? ` ${fmtInt(s.done)} / ${fmtInt(s.total)} windows (${pct}%)` : ""}
      </span>
    );
  }
  const h = s.history!;
  return (
    <span className="mono muted">
      {h.snapshot ? `snapshot to ${fmtInt(h.snapshot.to)}` : "no snapshot"}
      {h.cached ? ` + cached to ${fmtInt(h.cached.to)}` : ""}
      {h.live ? ` + live to ${fmtInt(h.live.to)}` : ""}
      {h.live?.failed ? ` (${h.live.failed} windows not answered)` : ""}
      {h.gap ? ` · gap ${fmtInt(h.gap.from)}–${fmtInt(h.gap.to)} not scanned` : ""}
    </span>
  );
}
