import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PRODUCT_NAME, REPO, TAPE_NAME } from "../brand";
import { createSafe, useOwnedSafes } from "./safes";
import { chooseSafe, connect, disconnect, useWallet } from "./wallet";
import "./styles.css";

// ------------------------------------------------------------------ routes (static pages, relative links: works on DeWeb)
export type Page = "" | "start" | "limits" | "wallet" | "tilt" | "try" | "agents" | "docs" | "install" | "onboard";
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
/** The wordmark: "fengce" set in Space Grotesk. */
export function Wordmark({ height = 26 }: { height?: number }) {
  return (
    <span aria-label={PRODUCT_NAME} style={{ fontFamily: "var(--fd)", fontSize: Math.round(height * 0.81), letterSpacing: "-0.02em", lineHeight: 1, color: "currentColor" }}>
      fengce
    </span>
  );
}
export function Lockup({ knot = 24, word = 26 }: { knot?: number; word?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
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

/** Small copy icon; shows "Copied" for 1.5 s. */
export function CopyButton({ text, label = "Copy address" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={label}
      title={done ? "Copied" : label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? (
        <span className="mono" style={{ fontSize: 11 }}>Copied</span>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
      )}
    </button>
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
          localStorage.setItem("fengce-theme", next);
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

// ------------------------------------------------------------------ wallet menu (dropdown on desktop, inside the sheet on mobile)
function WalletMenu({ close }: { close: () => void }) {
  const w = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const owned = useOwnedSafes();
  const known = [
    { name: "OKX Wallet", match: /okx|okex/i },
    { name: "MetaMask", match: /metamask/i },
  ];
  return (
    <>
    {w.account ? (
      <>
        <span className="mono small" style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
          {w.wallet?.name ?? "Wallet"} · {short(w.account)}
          <CopyButton text={w.account} label="Copy wallet address" />
          {!w.chainOk && " · switch to X Layer"}
        </span>
        <span className="lbl" style={{ padding: "6px 10px 2px" }}>Your Safes{owned.loading ? " · reading" : ""}</span>
        {owned.safes.length === 0 && !owned.loading && <span className="small" style={{ padding: "4px 10px" }}>None found yet</span>}
        {owned.safes.map((sf) => {
          const on = sf.toLowerCase() === w.safe?.toLowerCase();
          return (
            <div key={sf} className="menu-row" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" role="menuitemradio" aria-checked={on} style={{ flex: 1 }} onClick={() => (chooseSafe(sf), close())}>
                <span className="mono">{short(sf)}</span>
                <span className="lbl" style={{ color: on ? "var(--accent)" : undefined }}>{on ? "In use" : "Switch"}</span>
              </button>
              <CopyButton text={sf} label="Copy Safe address" />
            </div>
          );
        })}
        <button
          type="button"
          role="menuitem"
          disabled={!!creating}
          onClick={() => {
            setErr(null);
            setCreating("Confirm in your wallet");
            createSafe(w.account!).then(
              () => (location.href = href("start")),
              (e) => (setCreating(null), setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message)),
            );
          }}
        >
          {creating ?? "Create a new Safe"}
        </button>
        {err && <span className="err" style={{ padding: "6px 10px" }}>{err}</span>}
        <span style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />
        <a role="menuitem" href={href("wallet")}>My wallet</a>
        <a role="menuitem" href={href("limits")}>My limits</a>
        <button type="button" role="menuitem" style={{ color: "var(--deny)" }} onClick={() => (disconnect(), close())}>
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
              onClick={() => found && connect(found).then(() => close(), (e) => setErr((e as Error).message))}
            >
              {k.name} <span className="lbl">{found ? "Detected" : "Not found"}</span>
            </button>
          );
        })}
        {w.wallets
          .filter((x) => !known.some((k) => k.match.test(x.name) || k.match.test(x.rdns)))
          .map((x) => (
            <button key={x.uuid} type="button" role="menuitem" onClick={() => connect(x).then(() => close(), (e) => setErr((e as Error).message))}>
              {x.name} <span className="lbl">Browser</span>
            </button>
          ))}
        <button type="button" role="menuitem" disabled style={{ color: "var(--muted)" }}>
          WalletConnect <span className="lbl">Coming soon</span>
        </button>
        {err && <span className="err" style={{ padding: "6px 10px" }}>{err}</span>}
      </>
    )}
    </>
  );
}

function useOutside(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("click", close), document.removeEventListener("keydown", esc));
  }, [open, setOpen]);
  return ref;
}

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, setOpen);
  return (
    <div className="wallet-btn" ref={ref}>
      {w.account ? (
        <button type="button" className="pill line hpill" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="dot" style={{ background: w.chainOk ? "var(--allow)" : "var(--deny)" }} />
          {short(w.account)}
        </button>
      ) : (
        <button type="button" className="pill line hpill" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="long">Connect</span>
          <span className="short">Connect</span>
        </button>
      )}
      {open && (
        <div className="menu" role="menu">
          <WalletMenu close={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Under 768px: one header row; this icon opens a full-width sheet with the nav and the wallet actions. */
function MobileMenu({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, setOpen);
  return (
    <div className="mnav" ref={ref}>
      <button type="button" className="icon-btn mnav-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div className="sheet">
          <nav aria-label="Main">
            {NAV.map((n) => (
              <a key={n.page} href={href(n.page)} aria-current={n.page === page ? "page" : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="sheet-wallet">
            <WalletMenu close={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ shell
const NAV: { page: Page; label: string }[] = [
  { page: "limits", label: "Limits" },
  { page: "try", label: "Try" },
  { page: "tilt", label: "Tilt-shield" },
  { page: "agents", label: "Agents" },
  { page: "docs", label: "Docs" },
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
        <div className="head-r">
          <WalletButton />
          <MobileMenu page={page} />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const col = (title: string, links: [string, string, boolean?][]) => (
    <div className="foot-col">
      <span className="lbl" style={{ marginBottom: 4 }}>{title}</span>
      {links.map(([label, to, ext]) => (
        <a key={label} href={to} {...(ext ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{label}</a>
      ))}
    </div>
  );
  return (
    <footer className="foot">
      <div className="w foot-in">
        <div className="foot-col foot-brand" style={{ gap: 12 }}>
          <Lockup knot={22} word={22} />
          <span style={{ fontSize: 14.5, color: "var(--muted)", maxWidth: 300 }}>Limits your wallet keeps, even on you. Built on TapeOut circuits on X Layer.</span>
          <div className="foot-pw">
            <span className="mono muted" style={{ fontSize: 12 }}>{TAPE_NAME}</span>
            <ThemeButton />
          </div>
        </div>
        {col("Product", [["Limits", href("limits")], ["Try", href("try")], ["Tilt-shield", href("tilt")], ["Wallet", href("wallet")]])}
        {col("Build", [["Docs", href("docs")], ["Agents", href("agents")], ["Catalog", href("limits", { tab: "add" })], ["GitHub", REPO, true]])}
        {col("Proof", [["Contracts", href("docs", { tab: "contracts" })], ["Circuits", href("docs", { tab: "circuits" })], ["Incidents", href("docs", { tab: "inc" })], ["For judges", href("docs", { tab: "judges" })]])}
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
