import { useState } from "react";
import { isAddress, parseAbi, type Address } from "viem";
import { DEPLOYMENT, client } from "../lib/chain";
import { CHECK_ADAPTER, COVERAGE, WALLETS, tone, type Coverage } from "../lib/wallets";
import { INSTALLABLE, InstallFlow } from "../protect/Install";
import { SafeCheck } from "../protect/SafeCheck";
import { Addr, ErrorLine, Loading, Pill, Section, fmtInt, href, mount, param, useLoad } from "../ui/kit";

type Step = "1" | "2" | "3";
const STEPS: { n: Step; label: string }[] = [
  { n: "1", label: "Choose your wallet" },
  { n: "2", label: "Install" },
  { n: "3", label: "Check a wallet" },
];
const COV_TONE: Record<Coverage, string> = { Full: "checked", Partial: "amber", "Agent only": "neutral", "Not integrated": "gap" };

function go(q: Record<string, string>) {
  location.href = href("protect", q);
}

// ---------------------------------------------------------------- 1. choose

function Choose({ picked }: { picked: string }) {
  return (
    <>
      <p className="lede" style={{ marginTop: 0 }}>
        Which smart wallets can host Fengce, through which adapter, and what each one guarantees. Mirrors docs/WALLETS.md, where every cell names
        its test. Pick yours to continue.
      </p>
      <div className="tablewrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Coverage</th>
              <th>Adapter</th>
              <th>Owner path</th>
              <th>Agents</th>
              <th>Uninstall protection</th>
              <th>Tests</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {WALLETS.map((w) => (
              <tr key={w.key} style={w.key === picked ? { outline: "1px solid var(--accent)", outlineOffset: -1 } : undefined}>
                <td className="name">
                  {w.wallet}
                  <div className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>
                    on X Layer: {w.onXLayer}
                  </div>
                </td>
                <td>
                  <Pill tone={COV_TONE[COVERAGE[w.key] ?? "Not integrated"]}>{COVERAGE[w.key] ?? "Not integrated"}</Pill>
                </td>
                <td style={{ maxWidth: 220 }}>{w.adapter}</td>
                {[w.owner, w.agents, w.removal].map((c, i) => (
                  <td key={i} style={{ maxWidth: 220 }}>
                    <Pill tone={tone(c.state)}>{c.state}</Pill>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {c.text}
                    </div>
                  </td>
                ))}
                <td className="mono muted" style={{ maxWidth: 200, fontSize: 11.5 }}>
                  {w.tests}
                </td>
                <td>
                  <button className={`btn${w.key === picked ? "" : " ghost"}`} type="button" onClick={() => go({ step: "2", wallet: w.key })}>
                    {w.key === picked ? "Chosen" : "Choose"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Full: adapter on X Layer mainnet with fork or mainnet tests and no known bypass. Partial: checks work, with a known way to remove the hook or
        skip the timelock. Agent only: agents are checked, owners are not. Wallets not deployed on X Layer were tested with their canonical code read
        from Base and placed on an X Layer fork.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- 2. install

function Install({ picked }: { picked: string }) {
  const w = WALLETS.find((x) => x.key === picked)!;
  if (INSTALLABLE.includes(picked)) return <InstallFlow type={picked} />;
  return (
    <div className="note">
      <b>{w.wallet}</b>: {COVERAGE[w.key] ?? "Not integrated"}. This app has no install flow for it yet.
      {w.install?.length ? (
        <ol style={{ margin: "10px 0 0", paddingLeft: 18 }}>
          {w.install.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : (
        <> Adapter: {w.adapter}. Install calls and known gaps are in docs/WALLETS.md.</>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 3. check

const hookAbi = parseAbi([
  "function isInitialized(address) view returns (bool)",
  "function uninstallReadyAt(address) view returns (uint256)",
  "function inspectorOf(address) view returns (address)",
]);
const ownerAbi = parseAbi(["function isConfigured(address) view returns (bool)", "function inspectorOf(address) view returns (address)"]);

const ADAPTERS = {
  hook7579: { name: "FengceHook", address: DEPLOYMENT.contracts.FengceHook as Address },
  hook6900: { name: "FengceHook6900", address: DEPLOYMENT.contracts.FengceHook6900 as Address },
  agentOwner: { name: "FengceAgentOwner", address: DEPLOYMENT.contracts.FengceAgentOwner as Address },
};

/** Non-Safe wallets: what the adapters expose per account (installed, uninstall schedule, outcome checker). */
function AdapterCheck({ kind, account }: { kind: "hook7579" | "hook6900" | "agentOwner"; account: Address }) {
  const a = ADAPTERS[kind];
  const { data, error, loading, reload } = useLoad(async () => {
    if (kind === "agentOwner") {
      const [on, inspector] = await Promise.all([
        client.readContract({ address: a.address, abi: ownerAbi, functionName: "isConfigured", args: [account] }),
        client.readContract({ address: a.address, abi: ownerAbi, functionName: "inspectorOf", args: [account] }),
      ]);
      return { on, inspector, uninstall: null as bigint | null };
    }
    const [on, uninstall, inspector] = await Promise.all([
      client.readContract({ address: a.address, abi: hookAbi, functionName: "isInitialized", args: [account] }),
      client.readContract({ address: a.address, abi: hookAbi, functionName: "uninstallReadyAt", args: [account] }),
      client.readContract({ address: a.address, abi: hookAbi, functionName: "inspectorOf", args: [account] }),
    ]);
    return { on, inspector, uninstall };
  }, [kind, account]);
  if (loading) return <Loading what="the adapter" />;
  if (error || !data) return <ErrorLine error={error} retry={reload} />;
  const zero = /^0x0{40}$/i;
  return (
    <>
      <dl className="kv">
        <dt>Adapter</dt>
        <dd>
          {a.name} <Addr a={a.address} />
        </dd>
        <dt>{kind === "agentOwner" ? "Configured" : "Installed"}</dt>
        <dd>
          <Pill tone={data.on ? "checked" : "gap"}>{data.on ? "yes" : "no"}</Pill>
        </dd>
        {data.uninstall !== null && (
          <>
            <dt>Uninstall scheduled</dt>
            <dd className="mono">{data.uninstall === 0n ? "no" : new Date(Number(data.uninstall) * 1000).toLocaleString()}</dd>
          </>
        )}
        <dt>Outcome checker</dt>
        <dd>{zero.test(data.inspector) ? <span className="muted">none</span> : <Addr a={data.inspector} />}</dd>
      </dl>
      <p className="note">
        The adapters keep each account's policy in internal storage with no public getter, so this check shows whether Fengce is installed, not
        which policy. The full status page (policy, guards, denied calls, events) is available for Safe.
      </p>
    </>
  );
}

function Check({ picked }: { picked: string }) {
  const kind = CHECK_ADAPTER[picked] ?? null;
  const w = WALLETS.find((x) => x.key === picked)!;
  const [input, setInput] = useState(param("address") ?? (kind === "guard" ? DEPLOYMENT.demoSafe : ""));
  if (kind === "guard") return <SafeCheck />;
  if (kind === null)
    return (
      <p className="note">
        {w.wallet} has no Fengce adapter, so there is nothing to check on-chain. Status pages are available for Safe (full) and for wallets using
        FengceHook, FengceHook6900 or FengceAgentOwner (installed or not).
      </p>
    );
  const account = param("address");
  return (
    <>
      <form
        className="row"
        style={{ maxWidth: 640, marginBottom: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          go({ step: "3", wallet: picked, address: input });
        }}
      >
        <input className="mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`0x… ${w.wallet} address`} style={{ flex: 1 }} />
        <button className="btn" type="submit">
          Read
        </button>
      </form>
      {account && !isAddress(account) && <p className="err">Not an address.</p>}
      {account && isAddress(account) && <AdapterCheck kind={kind} account={account} />}
    </>
  );
}

// ---------------------------------------------------------------- page

function ProtectPage() {
  const step: Step = (["1", "2", "3"].includes(param("step") ?? "") ? param("step") : "1") as Step;
  const picked = WALLETS.some((w) => w.key === param("wallet")) ? param("wallet")! : "safe";
  const w = WALLETS.find((x) => x.key === picked)!;
  return (
    <>
      <h1 className="title">Protect a wallet</h1>
      <p className="lede">
        Choose your wallet, install a policy on it, and check any wallet's status. Everything is built in your browser from live X Layer reads;
        nothing is signed or sent here.
      </p>
      <div className="seg" role="tablist" aria-label="Steps" style={{ margin: "18px 0 0" }}>
        {STEPS.map((s) => (
          <button key={s.n} type="button" role="tab" aria-selected={step === s.n} aria-pressed={step === s.n} onClick={() => go({ step: s.n, wallet: picked })}>
            {s.n} · {s.label}
          </button>
        ))}
      </div>
      <Section
        n={Number(step)}
        label={STEPS[Number(step) - 1].label}
        aside={
          step !== "1" ? (
            <span>
              {w.wallet} · {COVERAGE[w.key] ?? "Not integrated"} ·{" "}
              <a className="accent" href={href("protect", { step: "1", wallet: picked })}>
                change
              </a>
            </span>
          ) : (
            `${fmtInt(WALLETS.length)} wallets`
          )
        }
      >
        {step === "1" && <Choose picked={picked} />}
        {step === "2" && <Install picked={picked} />}
        {step === "3" && <Check picked={picked} />}
      </Section>
    </>
  );
}

mount("protect", 1, <ProtectPage />);
