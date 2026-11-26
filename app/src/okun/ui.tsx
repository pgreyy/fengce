import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PRODUCT_NAME, REPO, TAPE_NAME } from "../brand";
import { connect, disconnect, useWallet } from "./wallet";
import "./styles.css";

// ------------------------------------------------------------------ routes (static pages, relative links: works on DeWeb)
export type Page = "" | "start" | "limits" | "wallet" | "tilt" | "try" | "fengce";
let DEPTH = 0;
export function href(page: Page, q?: Record<string, string>, hash?: string) {
  const base = DEPTH === 0 ? "./" : "../";
  return `${base}${page ? `${page}/` : ""}${q ? `?${new URLSearchParams(q)}` : ""}${hash ? `#${hash}` : ""}`;
}
export function param(name: string) {
  return new URLSearchParams(location.search).get(name);
}
export const short = (a: string, n = 4) => (a.length > 2 + 2 * n ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a);

// ------------------------------------------------------------------ marks
export function Knot({ size = 24, stroke = 1.6, ring = "currentColor" }: { size?: number; stroke?: number; ring?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block", flex: "0 0 auto" }}>
      <circle cx="9" cy="12" r="6" stroke={ring} strokeWidth={stroke} />
      <path d="M15 6 A6 6 0 1 1 15 18 A6 6 0 0 1 9.6 14.6" stroke={ring} strokeWidth={stroke} strokeLinecap="round" />
      <path d="M9.2 9.6 A6 6 0 0 1 15 6" stroke="var(--accent, #F0533F)" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}
/** logo/okun-wordmark.svg: monoline "okun"; the u-n stem is the accent. Width is explicit so it never stretches. */
export function Wordmark({ height = 26 }: { height?: number }) {
  const width = Math.round((height * 53) / 24);
  return (
    <svg width={width} height={height} viewBox="0 0 53 24" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" role="img" aria-label={PRODUCT_NAME} style={{ display: "block", flex: "0 0 auto" }}>
      <circle cx="8" cy="14" r="6.6" stroke="currentColor" />
      <path d="M19 1.5 V21 M19 15.4 L26.2 7 M21.9 12.3 L26.6 21" stroke="currentColor" />
      <path d="M28.8 7 V15 A5.6 5.6 0 0 0 40 15 V13 A5.6 5.6 0 0 1 51.2 13 V21" stroke="currentColor" />
      <path d="M40 11.2 V16.8" stroke="var(--accent)" />
    </svg>
  );
}
export function Lockup({ knot = 24, word = 26 }: { knot?: number; word?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Knot size={knot} />
      <Wordmark height={word} />
    </span>
  );
}

// ------------------------------------------------------------------ copy-able code
export function CodeCard({ title, code }: { title: string; code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="code">
      <div className="code-head">
        <span className="lbl">// {title}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            });
          }}
        >
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

// ------------------------------------------------------------------ theme (footer icon only)
function currentTheme(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function ThemeButton() {
  const [t, setT] = useState(currentTheme);
  const next = t === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("okun-theme", next);
        } catch {
          /* storage blocked */
        }
        setT(next);
      }}
    >
      {t === "dark" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}

// ------------------------------------------------------------------ wallet button
function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const known = [
    { name: "OKX Wallet", match: /okx|okex/i },
    { name: "MetaMask", match: /metamask/i },
  ];
  return (
    <div className="wallet-btn" ref={ref}>
      {w.account ? (
        <button type="button" className="pill line" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="dot" style={{ background: w.chainOk ? "var(--allow)" : "var(--deny)" }} />
          {short(w.account)}
        </button>
      ) : (
        <button type="button" className="pill accent" aria-expanded={open} onClick={() => setOpen(!open)}>
          Connect wallet
        </button>
      )}
      {open && (
        <div className="menu" role="menu">
          {w.account ? (
            <>
              <span className="mono small" style={{ padding: "8px 10px" }}>
                {w.wallet?.name ?? "Wallet"} · {w.safe ? `Safe ${short(w.safe)}` : "no Safe chosen"}
                {!w.chainOk && " · switch to X Layer"}
              </span>
              <a role="menuitem" href={href("wallet")}>My wallet</a>
              <a role="menuitem" href={href("limits")}>My limits</a>
              <button type="button" role="menuitem" style={{ color: "var(--deny)" }} onClick={() => (disconnect(), setOpen(false))}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <span className="lbl">Connect a wallet</span>
              {known.map((k) => {
                const found = w.wallets.find((x) => k.match.test(x.name) || k.match.test(x.rdns));
                return (
                  <button
                    key={k.name}
                    type="button"
                    role="menuitem"
                    disabled={!found}
                    style={found ? undefined : { color: "var(--muted)" }}
                    onClick={() => found && connect(found).then(() => setOpen(false), (e) => setErr((e as Error).message))}
                  >
                    {k.name} <span className="lbl">{found ? "Detected" : "Not found"}</span>
                  </button>
                );
              })}
              {w.wallets
                .filter((x) => !known.some((k) => k.match.test(x.name) || k.match.test(x.rdns)))
                .map((x) => (
                  <button key={x.uuid} type="button" role="menuitem" onClick={() => connect(x).then(() => setOpen(false), (e) => setErr((e as Error).message))}>
                    {x.name} <span className="lbl">Browser</span>
                  </button>
                ))}
              <button type="button" role="menuitem" disabled style={{ color: "var(--muted)" }}>
                WalletConnect <span className="lbl">Coming soon</span>
              </button>
              {err && <span className="err" style={{ padding: "6px 10px" }}>{err}</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ shell
const NAV: { page: Page; label: string }[] = [
  { page: "limits", label: "Limits" },
  { page: "tilt", label: "Tilt shield" },
  { page: "fengce", label: "Fengce" },
];

function Header({ page }: { page: Page }) {
  return (
    <header className="head">
      <div className="head-in">
        <a className="lockup" href={href("")} aria-label={`${PRODUCT_NAME}, home`}>
          <Lockup />
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.page} href={href(n.page)} aria-current={n.page === page ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="w foot-in">
        <div className="foot-col" style={{ gap: 12 }}>
          <Lockup knot={22} word={22} />
          <span style={{ fontSize: 15, color: "var(--muted)" }}>Wallet limits as TapeOut circuits on X Layer.</span>
          <a className="powered" href={href("fengce")}>
            <span className="muted">Powered by</span> <span className="accent">Fengce</span>
          </a>
          <ThemeButton />
        </div>
        <div className="foot-col">
          <span className="lbl" style={{ marginBottom: 4 }}>Product</span>
          <a href={href("limits")}>Limits</a>
          <a href={href("tilt")}>Tilt shield</a>
        </div>
        <div className="foot-col">
          <span className="lbl" style={{ marginBottom: 4 }}>Fengce</span>
          <a href={href("fengce")}>How it works</a>
          <a href={REPO} target="_blank" rel="noreferrer noopener">GitHub</a>
        </div>
        <div className="foot-col">
          <span className="lbl" style={{ marginBottom: 4 }}>Network</span>
          <span className="v">X Layer 196</span>
          <span className="v">{TAPE_NAME}</span>
        </div>
      </div>
    </footer>
  );
}

/** Home page only, once per browser session; never for reduced motion or automated browsers (previews must see the page). */
function Splash() {
  const [show] = useState(() => {
    try {
      if (navigator.webdriver || matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      if (sessionStorage.getItem("okun-splash")) return false;
      sessionStorage.setItem("okun-splash", "1");
      return true;
    } catch {
      return false;
    }
  });
  const [gone, setGone] = useState(!show);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setGone(true), 1700);
    return () => clearTimeout(t);
  }, [show]);
  if (gone) return null;
  return (
    <div className="splash" aria-hidden="true">
      <Knot size={72} stroke={1.2} ring="#EDEDE8" />
    </div>
  );
}

export function mount(page: Page, depth: number, node: ReactNode, opts: { home?: boolean } = {}) {
  DEPTH = depth;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {opts.home && <Splash />}
      <Header page={page} />
      {node}
      <Footer />
    </StrictMode>,
  );
}
