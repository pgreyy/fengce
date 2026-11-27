import { href, mount, Addr, StartLink } from "../fengce/ui";
import { useWallet } from "../fengce/wallet";

/** For outside testers: create a Safe, set limits, try them, send the Safe address back. */
function Onboard() {
  const w = useWallet();
  const issue = w.safe
    ? `https://github.com/pgreyy/fengce/issues/new?title=${encodeURIComponent("Tester Safe")}&body=${encodeURIComponent(`My Safe on X Layer: ${w.safe}\nLimits installed from getfengce.vercel.app/onboard`)}`
    : "https://github.com/pgreyy/fengce/issues/new?title=Tester%20Safe";
  const steps: [string, string, React.ReactNode][] = [
    ["01 · Wallet", "OKX Wallet or MetaMask, on X Layer", <>A little OKB on X Layer pays the gas (a few cents), and 1 to 2 USDT0 to try a swap. The app adds X Layer to your wallet when you connect.</>],
    ["02 · Safe", "Connect, then Create a new Safe", <>A Safe 1.5 owned only by your wallet, made in one transaction. <StartLink className="alink accent">Connect</StartLink></>],
    ["03 · Limits", "Set max per buy and trades per hour", <>On <a className="alink" href={href("limits")}>Limits</a>, choose your numbers, press Test before you sign, then Install with one signature.</>],
    ["04 · Try", "Swap under and over your cap", <>On <a className="alink" href={href("try")}>Try</a>, swap under your cap (it goes through), then over it (your Safe refuses, with the reason). <a className="alink" href={href("wallet")}>My wallet</a> shows both.</>],
    ["05 · Send it", "Send us your Safe address", <>Open a short GitHub issue with your Safe address (prefilled below), or send it to whoever invited you. Nothing private is in it.</>],
  ];
  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <span className="lbl">Onboarding · 10 minutes</span>
        <h1 className="disp" style={{ fontSize: 50 }}>
          Put limits on <em>your own Safe.</em>
        </h1>
        <p className="body" style={{ color: "var(--text)" }}>Five steps on X Layer mainnet. You keep every key; Fengce never holds or moves your funds.</p>
      </div>
      <div className="ts-steps" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {steps.map(([k, t, d]) => (
          <div key={k}>
            <span className="lbl">{k}</span>
            <div className="ts-st">{t}</div>
            <div className="ts-sd">{d}</div>
          </div>
        ))}
      </div>
      <section className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
        <span className="lbl">Your Safe</span>
        {w.safe ? (
          <>
            <Addr value={w.safe} label="Copy your Safe address" />
            <a className="pill accent big" style={{ alignSelf: "flex-start" }} href={issue} target="_blank" rel="noreferrer noopener">Send my Safe address</a>
            <a className="alink" href={href("wallet", { safe: w.safe })}>Check it read-only</a>
          </>
        ) : (
          <>
            <span className="small">Connect and create or choose a Safe first.</span>
            <StartLink className="pill accent big">Connect</StartLink>
          </>
        )}
      </section>
    </main>
  );
}

mount("onboard", 1, <Onboard />);
