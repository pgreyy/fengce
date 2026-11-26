// A ruled comparison table: first column is the row name, other cells carry a tone (good, neutral, bad).
export type Tone = "g" | "m" | "b";
export const tone = (t: Tone) => (t === "g" ? "var(--allow)" : t === "b" ? "var(--deny)" : "var(--muted)");

export function Ruled({ cols, rows, label }: { cols: string[]; rows: [string, ...[string, Tone][]][]; label: string }) {
  return (
    <div className="scroll-x">
      <table className="rt stk" aria-label={label} style={{ minWidth: 760 }}>
        <thead>
          <tr>
            <th />
            {cols.map((c, i) => (
              <th key={c} style={i === cols.length - 1 ? { color: "var(--accent)" } : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, ...cells]) => (
            <tr key={k}>
              <td className="rowhead" style={{ color: "var(--text)" }}>{k}</td>
              {cells.map(([t, tn], i) => (
                <td key={i} data-label={cols[i]} style={{ fontSize: 14, color: tone(tn), fontWeight: i === cells.length - 1 ? 500 : 400 }}>{t}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
