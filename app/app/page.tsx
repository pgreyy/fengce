import { catalog } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const c = (await catalog()) as any;
  return (
    <>
      <h1>Catalog</h1>
      {c.deployed ? (
        <table>
          <thead>
            <tr>
              <th>Pin</th><th>Tier</th><th>Measured gas</th><th>Vectors (allow / deny)</th><th>Certificate</th><th>Designer</th><th>Fee (wei)</th><th>Active</th><th>Description</th>
            </tr>
          </thead>
          <tbody>
            {c.entries.map((e: any) => (
              <tr key={e.pinId}>
                <td className="mono">{e.pinId}</td><td>{e.tier}</td><td>{e.measuredGas}</td><td>{e.allowVectors} / {e.denyVectors}</td>
                <td className="mono">{e.certificateHash}</td><td className="mono">{e.designer}</td><td>{e.installFee}</td><td>{String(e.active)}</td><td>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{c.note}</p>
      )}
      <h2>Known circuits on X Layer</h2>
      <table>
        <thead>
          <tr><th>Policy</th><th>Processor</th><th>Circuit</th><th>State</th><th></th></tr>
        </thead>
        <tbody>
          {c.known.map((k: any) => (
            <tr key={k.key}>
              <td>{k.name}</td><td className="mono">{k.processor}</td><td>{k.id}</td><td>{k.stateful ? "stateful (Tick)" : "stateless"}</td>
              <td><a href={`/policy/${k.processor}/${k.id}`}>details</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
