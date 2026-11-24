import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DEPLOYMENT, EXPLORER, client, friendlyError } from "../lib/chain";
import deweb from "../../../deployments/deweb-xlayer-196.json";
import type { Snapshot } from "../lib/events";
import "../tokens.css";
import "../styles.css";
import { initMotion } from "./motion";

/** Pages live at the root (catalog) or one folder deep; links are relative so the build runs from any base path. */
let DEPTH = 0;
export type Page = "" | "catalog" | "simulator" | "install" | "safe" | "wallets" | "policy" | "verdict";
export function href(page: Page, query?: Record<string, string>, hash?: string) {
  const base = DEPTH === 0 ? "./" : "../";
  const q = query ? `?${new URLSearchParams(query).toString()}` : "";
  return `${base}${page ? `${page}/` : ""}${q}${hash ? `#${hash}` : ""}`;
}

const NAV: { page: Page; label: string; hash?: string; landing?: boolean }[] = [
  { page: "catalog", label: "Catalog", landing: true },
  { page: "simulator", label: "Simulator", landing: true },
  { page: "install", label: "Install" },
  { page: "safe", label: "Safe" },
  { page: "wallets", label: "Wallets", landing: true },
  { page: "verdict", label: "Verdict", landing: true },
  { page: "", label: "Developers", hash: "developers", landing: true },
];

/** The DeWeb copy of this site (deployments/deweb-xlayer-196.json) and a gateway that opens it in any browser. */
export const DEWEB = { name: deweb.name as string, gateway: `https://${String(deweb.name).replace(/\.tape$/, "").replace(/\./g, "-")}.tapekit.org/` };
export const RELEASE = `v${String(DEPLOYMENT.version).replace(/^v/, "").split(".")[0]}`;
export const LINKS = {
  repo: "https://github.com/pgreyy/fengce",
  docs: "https://github.com/pgreyy/fengce/tree/main/docs",
  api: "https://github.com/pgreyy/fengce/blob/main/docs/API.md",
  npm: "https://www.npmjs.com/package/@fengce/sdk",
  sourcify: `https://repo.sourcify.dev/196/${DEPLOYMENT.contracts.FengceGuard}`,
};

export function mount(page: string, depth: number, node: ReactNode, opts: { landing?: boolean } = {}) {
  DEPTH = depth;
  initMotion();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Shell page={page} landing={!!opts.landing}>
        {node}
      </Shell>
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

/** Package mark (design handoff logo/fengce-mark.svg): frame and pins in the text colour, the die in the accent. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="logo-mark">
      <rect x="8" y="8" width="16" height="16" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="13" width="6" height="6" className="logo-die" style={{ fill: "var(--accent)" }} />
      <path d="M12 4v4M16 4v4M20 4v4M12 24v4M16 24v4M20 24v4M4 12h4M4 16h4M4 20h4M24 12h4M24 16h4M24 20h4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** The two themes of this build (cobalt, dark and light). */
const THEMES = { dark: "dark-cobalt", light: "light-cobalt" } as const;
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

function Shell({ page, landing, children }: { page: string; landing: boolean; children: ReactNode }) {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="wordmark" href={href("")} aria-label="Fengce, home">
            <LogoMark />
            <span>Fengce</span>
          </a>
          <nav className="nav" aria-label="Main">
            {NAV.filter((n) => !landing || n.landing).map((n) => (
              <a key={n.label} href={href(n.page, undefined, n.hash)} aria-current={!n.hash && n.page === page ? "page" : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <ThemeSwitch />
          {landing ? (
            <a className="btn" href={href("catalog")}>
              Open app
            </a>
          ) : (
            <LiveBlock />
          )}
        </div>
      </header>
      {landing ? <main className="landing">{children}</main> : <main className="wrap">{children}</main>}
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-brand">
          <span className="foot-name">Fengce</span>
          <span>The wallet-level enforcement layer for TapeOut.</span>
        </div>
        <nav className="foot-links" aria-label="Project">
          <a href={LINKS.docs} target="_blank" rel="noreferrer noopener">Docs</a>
          <a href={LINKS.repo} target="_blank" rel="noreferrer noopener">GitHub</a>
          <a href={LINKS.api} target="_blank" rel="noreferrer noopener">API</a>
          <a href={LINKS.npm} target="_blank" rel="noreferrer noopener">npm</a>
          <a href={LINKS.sourcify} target="_blank" rel="noreferrer noopener">Sourcify</a>
        </nav>
        <span className="mono">
          {RELEASE} · X Layer 196 · also on TapeOut:{" "}
          <a href={DEWEB.gateway} target="_blank" rel="noreferrer noopener" title={`tape://${DEWEB.name} (files stored on X Layer, verified by SHA-256)`}>
            {DEWEB.name}
          </a>
        </span>
      </div>
      <div className="foot-word" aria-hidden="true">
        Fengce
      </div>
    </footer>
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
