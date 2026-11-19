import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { client, EXPLORER, friendlyError } from "../lib/chain";
import type { Snapshot } from "../lib/events";
import "../tokens.css";
import "../styles.css";

/** Pages live at the root (catalog) or one folder deep; links are relative so the build runs from any base path. */
let DEPTH = 0;
export function href(page: "" | "simulator" | "install" | "safe" | "wallets" | "policy", query?: Record<string, string>) {
  const base = DEPTH === 0 ? "./" : "../";
  const q = query ? `?${new URLSearchParams(query).toString()}` : "";
  return `${base}${page ? `${page}/` : ""}${q}`;
}

const NAV: { page: "" | "simulator" | "install" | "safe" | "wallets"; label: string }[] = [
  { page: "", label: "Catalog" },
  { page: "simulator", label: "Simulator" },
  { page: "install", label: "Install" },
  { page: "safe", label: "Safe" },
  { page: "wallets", label: "Wallets" },
];

export function mount(page: string, depth: number, node: ReactNode) {
  DEPTH = depth;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Shell page={page}>{node}</Shell>
    </StrictMode>,
  );
}

function LiveBlock() {
  const [block, setBlock] = useState<bigint | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const b = await client.getBlockNumber({ cacheTime: 0 });
        if (alive) {
          setBlock(b);
          setStale(false);
        }
      } catch {
        if (alive) setStale(true);
      }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div className={`live mono${stale || block === null ? " stale" : ""}`} title="Latest X Layer block, read from your browser">
      <i />
      <span className="lbl muted">X LAYER</span>
      <span>{block === null ? "…" : `#${fmtInt(block)}`}</span>
    </div>
  );
}

/** The two themes of this build (design handoff: DARK_ACCENT copper, LIGHT_THEME ember). */
const THEMES = { dark: "dark-copper", light: "light-ember" } as const;
type ThemeKey = keyof typeof THEMES;

function currentTheme(): ThemeKey {
  return document.documentElement.getAttribute("data-theme")?.startsWith("light") ? "light" : "dark";
}

/** Dark / Light segmented switch; the choice is remembered (localStorage, when available). */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeKey>(() => currentTheme());
  const pick = (t: ThemeKey) => {
    document.documentElement.setAttribute("data-theme", THEMES[t]);
    try {
      localStorage.setItem("fengce-theme", t);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    setTheme(t);
  };
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {(["dark", "light"] as ThemeKey[]).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => pick(t)}>
          {t === "dark" ? "Dark" : "Light"}
        </button>
      ))}
    </div>
  );
}

function Shell({ page, children }: { page: string; children: ReactNode }) {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="wordmark" href={href("")}>
            Fengce<span>.</span>
          </a>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.label} href={href(n.page)} aria-current={(n.page || "catalog") === page ? "page" : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <ThemeSwitch />
          <LiveBlock />
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="foot">
        <div className="wrap">
          <span>Read-only. Every figure on this page is read from X Layer by your browser; nothing is sent.</span>
          <span className="mono">
            chain 196 · release v2 · on TapeOut DeWeb:{" "}
            <a href="https://6-2-180.tapekit.org/" target="_blank" rel="noreferrer noopener" title="tape://6.2.180.tape (files stored on X Layer, verified by SHA-256)">
              6.2.180.tape
            </a>
          </span>
        </div>
      </footer>
    </>
  );
}

export function Section({ n, label, aside, children, className }: { n: number; label: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className ?? ""}`}>
      <h2 className="label">
        <b>{String(n).padStart(2, "0")}</b>
        {label}
        {aside ? <span className="aside">{aside}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export function Figure({ v, k, tone }: { v: ReactNode; k: string; tone?: "amber" | "red" | "copper" }) {
  return (
    <div className="figure">
      <div className={`v ${tone ?? ""}`}>{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function tierTone(tier: string | null | undefined) {
  return tier === "Green" ? "green" : tier === "Amber" ? "amber" : tier === "Red" ? "red" : "neutral";
}

export function short(a: string, n = 4) {
  return a.length > 2 + n * 2 + 1 ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a;
}

export function Addr({ a, kind = "address", n = 4 }: { a: string | null | undefined; kind?: "address" | "tx"; n?: number }) {
  const [copied, setCopied] = useState(false);
  if (!a) return <span className="muted">–</span>;
  return (
    <span className="addr" title={a}>
      <span>{short(a, n)}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(a).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "OK" : "COPY"}
      </button>
      <a className="x" href={`${EXPLORER}/${kind}/${a}`} target="_blank" rel="noreferrer noopener">
        EXP
      </a>
    </span>
  );
}

export function fmtInt(v: bigint | number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "–";
  try {
    return BigInt(v).toLocaleString("en-US");
  } catch {
    return String(v);
  }
}

export function fmtDuration(seconds: bigint | number | string) {
  const s = Number(seconds);
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  return `${s}s`;
}

/** Runs an async loader once (and again when deps change); returns data, error and a reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      // Up to three attempts with backoff: the public RPC nodes rate-limit bursts.
      for (let attempt = 0; ; attempt++) {
        try {
          const data = await fn();
          if (alive) setState({ data, error: null, loading: false });
          return;
        } catch (e) {
          if (attempt >= 2) {
            if (alive) setState({ data: null, error: friendlyError(e), loading: false });
            return;
          }
          await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

export function Loading({ what }: { what: string }) {
  return <p className="loading">Reading {what} from X Layer…</p>;
}

export function ErrorLine({ error, retry }: { error: string | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="row" style={{ margin: "10px 0" }}>
      <p className="err" style={{ margin: 0 }}>
        {error}
      </p>
      {retry && (
        <button className="btn ghost" type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Where an event list comes from: the build's snapshot plus a live scan of newer blocks. */
export function HistoryNote({ h }: { h: any }) {
  if (!h) return <span className="muted">event history not read</span>;
  return (
    <span className="mono">
      {h.snapshot ? `snapshot ${fmtInt(h.snapshot.from)}–${fmtInt(h.snapshot.to)}` : "no snapshot"}
      {h.live ? ` + live ${fmtInt(h.live.from)}–${fmtInt(h.live.to)}` : ""}
      {h.live?.failed ? ` (${h.live.failed} windows not answered)` : ""}
      {h.gap ? ` · gap ${fmtInt(h.gap.from)}–${fmtInt(h.gap.to)} not scanned` : ""}
    </span>
  );
}

/** The event snapshot shipped with the build (events-snapshot.json at the site root), or null if it cannot be read. */
let snapshotPromise: Promise<Snapshot | null> | null = null;
export function loadSnapshot(): Promise<Snapshot | null> {
  snapshotPromise ??= fetch(`${DEPTH === 0 ? "./" : "../"}events-snapshot.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))
    .catch(() => null);
  return snapshotPromise;
}

export function param(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}
