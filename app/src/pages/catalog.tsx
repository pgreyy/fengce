import { catalogEntries, catalogInstalls } from "../lib/data";
import { SyncNote, useEventSync } from "../ui/sync";
import { presetFor } from "../lib/policies";
import { Addr, ErrorLine, Figure, Loading, Pill, Section, fmtInt, href, mount, tierTone, useLoad } from "../ui/kit";

interface Row {
  pinId: string;
  processor: string;
  circuitId: string;
  name: string | null;
  description: string;
  tier: string;
  measuredGas: string;
  fullPathGas: string | null;
  installs: number | null;
  designer: string;
  gateCount: number;
}

function CatalogPage() {
  const { data, error, loading, reload } = useLoad(async () => (await catalogEntries()) as any, []);
  // Installs come from events: they fill in when the background sync finishes; the listings never wait for it.
  const sync = useEventSync();
  const inst = data?.entries ? catalogInstalls(data.entries, sync.history) : [];
  const rows: Row[] = (data?.entries ?? []).map((e: any, i: number) => ({ ...e, installs: inst[i] ?? null }));
  const full = rows.map((r) => (r.fullPathGas ? BigInt(r.fullPathGas) : null)).filter((x): x is bigint => x !== null);
  const hist = sync.history;
  return (
    <>
      <h1 className="title">Catalog</h1>
      <p className="lede">Every policy listed on X Layer, with its gas, tier and installs. Read from the chain by your browser.</p>
      <Section n={1} label="Catalog" aside={data ? <Addr a={data.address} /> : null}>
        {loading && <Loading what="the Catalog" />}
        <ErrorLine error={error} retry={reload} />
        {data && (
          <>
            <div className="figures" style={{ marginBottom: 28 }}>
              <Figure v={fmtInt(rows.length)} k="Policies listed" />
              <Figure v={fmtInt(rows.filter((r) => r.tier === "Green").length)} k="Green tier" tone="amber" />
              <Figure v={full.length ? fmtInt(full.reduce((a, b) => (a < b ? a : b))) : "–"} k="Lowest full Safe path gas" />
              <Figure v={hist ? fmtInt(rows.reduce((a, r) => a + (r.installs ?? 0), 0)) : "…"} k={hist ? "Installs since v2" : "Installs (syncing events…)"} />
            </div>
            <div className="tablewrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>What it enforces</th>
                    <th>Tier</th>
                    <th className="num">Eval gas</th>
                    <th className="num">Full Safe path gas</th>
                    <th className="num">Gates</th>
                    <th className="num">Installs</th>
                    <th>Designer</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const preset = presetFor(r.processor, BigInt(r.circuitId));
                    return (
                      <tr key={r.pinId}>
                        <td>
                          <a className="name" href={href("policy", { processor: r.processor, id: r.circuitId })}>
                            {r.name ?? `#${r.circuitId}`}
                          </a>
                          <div className="mono muted">#{r.circuitId}</div>
                        </td>
                        <td style={{ maxWidth: 440 }}>{preset?.description ?? r.description}</td>
                        <td>
                          <Pill tone={tierTone(r.tier)}>{r.tier}</Pill>
                        </td>
                        <td className="num">{fmtInt(r.measuredGas)}</td>
                        <td className="num">{r.fullPathGas ? fmtInt(r.fullPathGas) : <span className="muted">–</span>}</td>
                        <td className="num">{fmtInt(r.gateCount)}</td>
                        <td className="num">{r.installs === null ? <span className="muted">…</span> : fmtInt(r.installs)}</td>
                        <td>
                          <Addr a={r.designer} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Eval gas: measured by the Catalog when the policy was listed. Full Safe path gas: the policy's Quote certificate (Safe execution,
              pre-check and outcome check).{" "}
              Installs: distinct Safes configured with the policy (FengceGuard <span className="mono">Configured</span> events since the v2
              deployment): <SyncNote s={sync} />.
            </p>
          </>
        )}
      </Section>
    </>
  );
}

mount("catalog", 1, <CatalogPage />);
