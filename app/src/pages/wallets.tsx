import { WALLETS, type Guarantee } from "../lib/wallets";
import { Pill, Section, mount } from "../ui/kit";

export function tone(g: Guarantee) {
  return g === "checked" ? "checked" : g === "gap" || g === "not restricted" || g === "not checked" ? "gap" : "neutral";
}

function Cell({ c }: { c: { state: Guarantee; text: string } }) {
  return (
    <>
      <Pill tone={tone(c.state)}>{c.state}</Pill>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
        {c.text}
      </div>
    </>
  );
}

function WalletsPage() {
  const onX = WALLETS.filter((w) => w.onXLayer.startsWith("yes")).length;
  return (
    <>
      <h1 className="title">Wallets</h1>
      <p className="lede">Which smart wallets can host Fengce, through which adapter, and what each one guarantees. Mirrors docs/WALLETS.md, where every cell names its test.</p>
      <Section n={6} label="Compatibility" aside={`${WALLETS.length} wallets · ${onX} on X Layer`}>
        <div className="tablewrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>On X Layer</th>
                <th>Adapter</th>
                <th>Owner path</th>
                <th>Agents</th>
                <th>Uninstall protection</th>
                <th>Tests</th>
              </tr>
            </thead>
            <tbody>
              {WALLETS.map((w) => (
                <tr key={w.key}>
                  <td className="name">{w.wallet}</td>
                  <td>{w.onXLayer}</td>
                  <td style={{ maxWidth: 220 }}>{w.adapter}</td>
                  <td style={{ maxWidth: 200 }}>
                    <Cell c={w.owner} />
                  </td>
                  <td style={{ maxWidth: 220 }}>
                    <Cell c={w.agents} />
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <Cell c={w.removal} />
                  </td>
                  <td className="mono muted" style={{ maxWidth: 220, fontSize: 11.5 }}>
                    {w.tests}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Wallets not deployed on X Layer were tested with their canonical code read from Base and placed on an X Layer fork, where the circuit
          lives. "From source" items were read in the wallet's code and are not covered by a test.
        </p>
      </Section>
    </>
  );
}

mount("wallets", 1, <WalletsPage />);
