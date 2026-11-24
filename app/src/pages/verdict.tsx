import { useEffect, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { EXPLORER } from "../lib/chain";
import * as V from "../lib/verdict";
import { Addr, ErrorLine, Figure, Loading, Section, fmtInt, href, mount, param, short, useLoad } from "../ui/kit";

const usd = (x: bigint) => `${Number(formatUnits(x, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT0`;
const when = (t: bigint) => new Date(Number(t) * 1000).toLocaleString();
const DOCS = "https://github.com/pgreyy/fengce/blob/main/docs/VERDICT.md";

function phase(m: V.Market, now: number) {
  const dl = Number(m.deadline);
  const end = dl + Number(m.settleWindow);
  if (m.state === 0 && now < dl) return `Betting open, closes ${when(m.deadline)}`;
  if (m.state === 0 && now <= end) return `Checkpoint window open until ${when(BigInt(end))}`;
  if (m.state === 0) return "No checkpoint in the window: refunds open";
  if (m.state === 1) return `Checkpointed at block ${fmtInt(m.checkpointBlock)}; ready to settle`;
  if (m.state === 4) return `VOID: ${V.VOID_REASONS[m.voidReason]}. Every stake is refunded`;
  return `Settled ${V.STATES[m.state]}`;
}

function stateTone(s: number) {
  return s === 2 ? "allow" : s === 3 ? "deny" : s === 4 ? "neutral" : "amber";
}

// ---------------------------------------------------------------- list

function MarketList({ v }: { v: Address }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const n = await V.marketCount(v);
    const ids = [...Array(Number(n)).keys()].map(BigInt).reverse();
    return Promise.all(ids.map((id) => V.market(v, id)));
  }, [v]);
  if (loading) return <Loading what="markets" />;
  if (error) return <ErrorLine error={error} retry={reload} />;
  if (!data?.length) return <p className="muted">No markets yet.</p>;
  const now = Date.now() / 1000;
  return (
    <div className="tablewrap">
      <table className="dt">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>State</th>
            <th className="num">YES pool</th>
            <th className="num">NO pool</th>
            <th>Deadline</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id.toString()}>
              <td className="mono">{m.id.toString()}</td>
              <td>
                <a className="name" href={href("verdict", { id: m.id.toString(), ...(param("verdict") ? { verdict: v } : {}) })}>
                  {m.question}
                </a>
                <div className="muted" style={{ fontSize: 13 }}>
                  {phase(m, now)}
                </div>
              </td>
              <td>
                <span className={`pill ${stateTone(m.state)}`}>{V.STATES[m.state]}</span>
              </td>
              <td className="num">{usd(m.totals[0])}</td>
              <td className="num">{usd(m.totals[1])}</td>
              <td className="mono">{when(m.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- market page

function Actions({ v, m, reload }: { v: Address; m: V.Market; reload: () => void }) {
  const [account, setAccount] = useState<Address | null>(null);
  const [side, setSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: Hex } | null>(null);
  const [mine, setMine] = useState<{ stake: readonly [bigint, bigint]; claimable: bigint; balance: bigint } | null>(null);
  const now = Date.now() / 1000;
  const dl = Number(m.deadline);
  const end = dl + Number(m.settleWindow);

  useEffect(() => {
    if (!account) return;
    Promise.all([V.stakeOf(v, m.id, account), V.claimable(v, m.id, account), V.usdt0(account)])
      .then(([stake, claimable, balance]) => setMine({ stake, claimable, balance }))
      .catch(() => setMine(null));
  }, [account, v, m]);

  const run = async (label: string, fn: (a: Address) => Promise<Hex>) => {
    setMsg(null);
    setBusy(label);
    try {
      const a = account ?? (await V.connect());
      setAccount(a);
      const tx = await fn(a);
      setMsg({ ok: true, text: `${label}: confirmed`, tx });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e) });
    } finally {
      setBusy(null);
    }
  };

  const canBet = m.state === 0 && now < dl;
  const canCheckpoint = m.state === 0 && now >= dl && now <= end;
  const canSettle = m.state === 1;
  const canClaim = m.state === 2 || m.state === 3;
  const canRefund = m.state === 4 || (m.state === 0 && now > end);

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        {account ? (
          <span className="mono muted">
            Wallet <Addr a={account} />
            {mine ? ` · ${usd(mine.balance)} · your stake YES ${usd(mine.stake[0])}, NO ${usd(mine.stake[1])}` : ""}
          </span>
        ) : (
          <button className="btn ghost" type="button" onClick={() => V.connect().then(setAccount, (e) => setMsg({ ok: false, text: e.message }))}>
            Connect wallet
          </button>
        )}
      </div>
      {canBet && (
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="seg" role="group" aria-label="Side">
            <button type="button" aria-pressed={side === 0} onClick={() => setSide(0)}>
              YES
            </button>
            <button type="button" aria-pressed={side === 1} onClick={() => setSide(1)}>
              NO
            </button>
          </div>
          <input className="mono" style={{ maxWidth: 160 }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in USDT0" />
          <button className="btn" type="button" disabled={!!busy} onClick={() => run(`Bet ${side === 0 ? "YES" : "NO"}`, (a) => V.placeBet(v, a, m.id, side, parseUnits(amount || "0", 6)))}>
            {busy?.startsWith("Bet") ? "Confirm in your wallet…" : `Bet ${side === 0 ? "YES" : "NO"}`}
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            USDT0; your wallet asks to approve first if needed.
          </span>
        </div>
      )}
      <div className="row">
        {canCheckpoint && (
          <button className="btn" type="button" disabled={!!busy} onClick={() => run("Checkpoint", (a) => V.call(v, a, "checkpoint", m.id))}>
            Checkpoint the inputs
          </button>
        )}
        {canSettle && (
          <button className="btn" type="button" disabled={!!busy} onClick={() => run("Settle", (a) => V.call(v, a, "settle", m.id))}>
            Settle
          </button>
        )}
        {canClaim && (
          <button className="btn" type="button" disabled={!!busy || (mine !== null && mine.claimable === 0n)} onClick={() => run("Claim", (a) => V.call(v, a, "claim", m.id))}>
            Claim{mine && mine.claimable > 0n ? ` ${usd(mine.claimable)}` : ""}
          </button>
        )}
        {canRefund && (
          <button className="btn" type="button" disabled={!!busy} onClick={() => run("Refund", (a) => V.call(v, a, "refund", m.id))}>
            Refund my stake
          </button>
        )}
      </div>
      {msg && (
        <p className={msg.ok ? "mono" : "err"} style={{ marginTop: 10 }}>
          {msg.text}
          {msg.tx && (
            <>
              {" "}
              <a className="accent" href={`${EXPLORER}/tx/${msg.tx}`} target="_blank" rel="noreferrer noopener">
                {short(msg.tx)}
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}

function Rerun({ v, m }: { v: Address; m: V.Market }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [d, pin] = await Promise.all([V.marketData(v, m.id), V.pinInfo(v, m.pinId)]);
    return { ...d, pin };
  }, [v, m.id.toString(), m.state]);
  const [res, setRes] = useState<{ input: Hex; output: Hex; onchain: readonly [Hex, Hex] | null; err?: string } | null>(null);
  const [reread, setReread] = useState<(bigint | string)[] | null>(null);

  if (loading) return <Loading what="the recorded inputs" />;
  if (error || !data) return <ErrorLine error={error} retry={reload} />;
  const checkpointed = m.checkpointBlock > 0n;

  const go = async () => {
    setRes(null);
    try {
      const input = V.encodeBits(data.pin.nIn, data.fields, data.values);
      const output = await V.rerun(data.pin.processor, data.pin.circuitId, input);
      const onchain = await V.evaluateStored(v, m.id).catch(() => null);
      setRes({ input, output, onchain });
    } catch (e) {
      setRes({ input: "0x", output: "0x", onchain: null, err: (e as Error).message });
    }
  };
  const rereadInputs = async () => {
    setReread(await Promise.all(data.inputs.map((x) => (x.decode === 1 ? Promise.resolve(x.arg) : V.readAt(x, m.checkpointBlock).catch(() => "this RPC does not serve that block's state")))));
  };
  const answer = res && !res.err ? ((parseInt(res.output.slice(2, 4) || "0", 16) & 1) === 1 ? "YES" : "NO") : null;
  const settled = m.state === 2 || m.state === 3 ? V.STATES[m.state] : null;

  return (
    <>
      <p className="lede">
        The inputs below were read on-chain by the checkpoint. Re-run sends them, encoded in your browser, straight to the pinned
        circuit with <span className="mono">eth_call</span>, and compares the answer with the market's result.
      </p>
      <div className="tablewrap" style={{ marginBottom: 14 }}>
        <table className="dt">
          <thead>
            <tr>
              <th>#</th>
              <th>Source</th>
              <th>Read</th>
              <th className="num">Recorded value</th>
              {reread && <th className="num">Re-read at block</th>}
            </tr>
          </thead>
          <tbody>
            {data.inputs.map((x, i) => (
              <tr key={i}>
                <td className="mono">{i}</td>
                <td>{x.decode === 1 ? <span className="muted">constant</span> : <Addr a={x.source} />}</td>
                <td className="mono" style={{ wordBreak: "break-all" }}>
                  {x.decode === 1 ? "–" : `${x.callData.slice(0, 10)}… word ${x.arg}`}
                </td>
                <td className="num">{checkpointed ? fmtInt(data.values[i]) : "not checkpointed"}</td>
                {reread && <td className="num">{typeof reread[i] === "bigint" ? fmtInt(reread[i] as bigint) : <span className="muted">{String(reread[i])}</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>checkpoint block</dt>
        <dd className="mono">{checkpointed ? fmtInt(m.checkpointBlock) : "–"}</dd>
        <dt>pinned circuit</dt>
        <dd>
          <a className="accent" href={href("policy", { processor: data.pin.processor, id: data.pin.circuitId.toString() })}>
            #{data.pin.circuitId.toString()} on {short(data.pin.processor)}
          </a>{" "}
          <span className={`pill ${data.pin.pinned ? "allow" : "deny"}`}>{data.pin.pinned ? "pin holds" : "pin broken"}</span>
        </dd>
        <dt>pin id</dt>
        <dd className="mono">{short(m.pinId, 8)}</dd>
        <dt>REF closure</dt>
        <dd className="mono">{short(m.refClosureHash, 8)}</dd>
      </dl>
      <div className="row">
        <button className="btn" type="button" disabled={!checkpointed} onClick={go}>
          Re-run the circuit
        </button>
        <button className="btn ghost" type="button" disabled={!checkpointed} onClick={rereadInputs}>
          Re-read the sources at the checkpoint block
        </button>
        {!checkpointed && <span className="muted">Available after the checkpoint.</span>}
      </div>
      {res && (
        <div className="note" style={{ marginTop: 14 }}>
          {res.err ? (
            <span className="err">{res.err}</span>
          ) : (
            <>
              <div className="mono">
                input {res.input} → output {res.output} → <b>{answer}</b>
              </div>
              <div style={{ marginTop: 6 }}>
                {settled ? (
                  answer === settled ? (
                    <span className="pill allow">matches the on-chain result: {settled}</span>
                  ) : (
                    <span className="pill deny">differs from the on-chain result: {settled}</span>
                  )
                ) : (
                  <span className="muted">Not settled yet; this is the answer settle will record if the pin still holds.</span>
                )}
                {res.onchain && <span className="mono muted"> · Verdict.evaluateStored returns {res.onchain[1]}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function MarketPage({ v, id }: { v: Address; id: bigint }) {
  const { data: m, error, loading, reload } = useLoad(() => V.market(v, id), [v, id.toString()]);
  if (loading) return <Loading what="the market" />;
  if (error || !m) return <ErrorLine error={error ?? "Market not found."} retry={reload} />;
  const total = m.totals[0] + m.totals[1];
  const pct = (x: bigint) => (total === 0n ? "–" : `${Number((x * 1000n) / total) / 10}%`);
  return (
    <>
      <p className="mono muted" style={{ marginTop: 40 }}>
        <a href={href("verdict", param("verdict") ? { verdict: v } : undefined)}>Verdict</a> / market #{m.id.toString()}
      </p>
      <h1 className="title" style={{ marginTop: 8 }}>
        {m.question}
      </h1>
      <p className="lede">{phase(m, Date.now() / 1000)}.</p>
      <Section n={1} label="Pools">
        <div className="figures">
          <Figure v={usd(m.totals[0])} k={`YES · ${pct(m.totals[0])}`} tone="amber" />
          <Figure v={usd(m.totals[1])} k={`NO · ${pct(m.totals[1])}`} tone="red" />
          <Figure v={when(m.deadline)} k="deadline (betting closes)" />
          <Figure v={`${Number(m.settleWindow) / 60} min`} k="checkpoint window after the deadline" />
        </div>
      </Section>
      <Section n={2} label="Your position">
        <Actions v={v} m={m} reload={reload} />
      </Section>
      <Section n={3} label="Re-run">
        <Rerun v={v} m={m} />
      </Section>
    </>
  );
}

function VerdictPage() {
  const v = V.verdictAddress();
  const id = param("id");
  if (v && id !== null && /^\d+$/.test(id)) return <MarketPage v={v} id={BigInt(id)} />;
  return (
    <>
      <h1 className="title">Verdict</h1>
      <p className="lede">
        Prediction markets that settle on a pinned TapeOut circuit. Bet USDT0 on YES or NO; after the deadline anyone checkpoints the
        on-chain inputs, and the circuit decides. No admin, no fee. <a className="accent" href={DOCS} target="_blank" rel="noreferrer noopener">How it settles</a>
      </p>
      <Section n={1} label="Markets" aside={v ? <Addr a={v} /> : undefined}>
        {v ? (
          <MarketList v={v} />
        ) : (
          <div className="note">
            <b>Verdict is not deployed yet.</b> It is next and in progress. This page reads markets from X Layer once the contract is
            deployed; until then there is nothing to show. The settlement rules are in{" "}
            <a className="accent" href={DOCS} target="_blank" rel="noreferrer noopener">docs/VERDICT.md</a>.
          </div>
        )}
      </Section>
    </>
  );
}

mount("verdict", 1, <VerdictPage />);
