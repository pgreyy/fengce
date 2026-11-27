#!/usr/bin/env python3
"""Adds or refreshes the guard v3 claims (Milestones 2 to 4) in docs/claims.json and docs/CLAIMS.md, every one backed by
a transaction from deployments/m2-demo-xlayer-196.json, a Sourcify record or a fork script. Run from the repo root."""
import json, re
d = json.load(open("deployments/m2-demo-xlayer-196.json"))
T = d["txs"]
tx = lambda h: f"https://www.oklink.com/x-layer/tx/{h}"
src = lambda a: f"https://repo.sourcify.dev/196/{a}"
M = "X Layer mainnet (196)"
claims = [
    ("v3-deployed", "FengceGuardV3, FengceRulesV3, AgentExecutorV3 and FengceSetupV3 are deployed on X Layer mainnet and verified on Sourcify (FengceGuardV3: match, runtime bytecode identical; the other three: exact match).", "verified", M,
     [("FengceGuardV3 deploy", tx(T["deploy"][5]["hash"])), ("FengceGuardV3 on Sourcify", src(d["guard"])), ("FengceRulesV3 on Sourcify", src(d["rulesLibrary"])), ("AgentExecutorV3 on Sourcify", src(d["agentExecutor"])), ("FengceSetupV3 deploy", tx(T["setup"][0]["hash"])), ("FengceSetupV3 on Sourcify", src(d["setupV3"]))]),
    ("v3-max-per-buy", "Guard v3 on the demo Safe: a 0.2 USDT0 swap was allowed; a 3 USDT0 swap over the 2 USDT0 cap is refused with code 1 (CIRCUIT, NAND circuit #2), recorded on chain with recordRefusal.", "mainnet", M,
     [("allowed swap", tx(T["swap"][0]["hash"])), ("refusal recorded", tx(T["refuse"][0]["hash"]))]),
    ("v3-tilt-shield", "Tilt-shield on mainnet: four 0.2 USDT0 buys in the same half hour tripped it (counter circuit #7 and the Tilt-shield latch, through Tick); the next buy is refused with code 5 (TILT_SHIELD).", "mainnet", M,
     [(f"buy {i + 1}", tx(t["hash"])) for i, t in enumerate(T["tilt"])] + [("refusal recorded", tx(T["paused"][0]["hash"]))]),
    ("v3-agent-cap", "An OKX Agentic Wallet agent paid 0.3 USDT0 through AgentExecutorV3 (allowed); paying 0.3 again went over its 0.5 USDT0 daily cap and was recorded as Denied with code 6 (AGENT_CAP); nothing moved.", "mainnet", M,
     [("allowed", tx(T["agent"][0]["hash"])), ("denied", tx(T["agent"][1]["hash"]))]),
    ("setup-one-signature", "A Safe is created with guard v3 already installed in one transaction (Safe setup delegatecalls FengceSetupV3); the app's Create a new Safe uses it.", "mainnet", M,
     [("Safe created with guard v3", tx(T["fresh"][0]["hash"])), ("fork check of the app's calls", "app/scripts/install-create-fork.mts")]),
    ("catalog-install-mainnet", "A Catalog circuit (Stablecoin Transfer Limit, circuit #2, free during launch) was installed on a second Safe: scheduled, approved early by its partner, applied; a 0.05 USDT0 send was allowed and a 0.5 USDT0 send is refused (code 1).", "mainnet", M,
     [(f"step {i + 1}: {t.get('function') or 'tx'}", tx(t["hash"])) for i, t in enumerate(T["catalog"])]),
    ("build-your-own-mainnet", f"A circuit built as Limits -> Build your own builds it (4 NAND: refuse when over 0.1 USDT0 or paying USDC) was taped out as circuit #{d.get('buildCircuitId')} on processor #180, pinned and installed; a 0.05 USDT0 send was allowed and a 0.5 USDT0 send is refused (code 1).", "mainnet", M,
     [(f"step {i + 1}: {t.get('function') or 'tx'}", tx(t["hash"])) for i, t in enumerate(T["build"])]),
    ("import-any-circuit", "Any TapeOut circuit on X Layer can be imported: an unlisted circuit (1.2.131) mapped to guard facts is pinned and installed with guard v3 in one signature, and decides allow and refuse; a circuit with memory (2.2.364) is added through Tick at first install.", "fork-tested", "X Layer mainnet fork",
     [("import fork check", "app/scripts/import-fork.mts"), ("memory fork check", "app/scripts/import-stateful-fork.mts")]),
    ("templates", "The Admin key guard and Vault templates install guard v3 on a new Safe in one signature; each was shown to allow one transaction and refuse one (Admin: a delegatecall to a contract other than MultiSendCallOnly, and adding an owner right away; Vault: a send over the cap).", "fork-tested", "X Layer mainnet fork",
     [("templates fork check", "app/scripts/templates-fork.mts")]),
]
if T.get("hold"):
    claims.append(("v3-hold-lock", "Hold lock on mainnet: with a 6-hour hold lock, a 0.05 USDT0 buy went through and selling it right away is refused with code 4 (HOLD_LOCK).", "mainnet", M, [(f"step {i + 1}", tx(t["hash"])) for i, t in enumerate(T["hold"])]))
if T.get("quiet"):
    claims.append(("v3-quiet-hours", "Quiet hours on mainnet: with quiet hours over the current UTC hour (a tightening, applied at once), a buy is refused with code 3 (QUIET_HOURS).", "mainnet", M, [(f"step {i + 1}", tx(t["hash"])) for i, t in enumerate(T["quiet"])]))
if T.get("partner2"):
    claims.append(("v3-partner-early", "Partner approval on mainnet: a loosening that would wait 7 days was approved by the partner and applied at once.", "mainnet", M, [(f"step {i + 1}", tx(t["hash"])) for i, t in enumerate(T["partner2"])]))

c = json.load(open("docs/claims.json"))
ids = {x[0] for x in claims}
c["claims"] = [x for x in c["claims"] if x["id"] not in ids] + [
    {"id": i, "claim": t, "status": st, "network": n, "release": "v3", "evidence": [{"label": l, "url": u} for l, u in ev]} for i, t, st, n, ev in claims
]
json.dump(c, open("docs/claims.json", "w"), indent=2, ensure_ascii=False)
open("docs/claims.json", "a").write("\n")

md = open("docs/CLAIMS.md").read()
for i, *_ in claims:  # drop earlier copies
    md = re.sub(rf"\n\| \[{re.escape(i)}\]\(#{re.escape(i)}\)[^\n]*", "", md)
    md = re.sub(rf"\n## {re.escape(i)}\n.*?(?=\n## |\Z)", "", md, flags=re.S)
rows = "".join(f"\n| [{i}](#{i}) | {st} | {n} | v3 |" for i, t, st, n, ev in claims)
last = list(re.finditer(r"\n\| \[[^\]]+\]\(#[^)]+\)[^\n]*", md))[-1]
md = md[: last.end()] + rows + md[last.end():]
link = lambda u: u if u.startswith("http") else f"../{u}"
md = md.rstrip() + "\n" + "".join(f"\n## {i}\n\n{t}\n\nStatus: **{st}** · Network: {n} · Release: v3\n\n" + "\n".join(f"- [{l}]({link(u)})" for l, u in ev) + "\n" for i, t, st, n, ev in claims)
open("docs/CLAIMS.md", "w").write(md)
print(f"{len(claims)} v3 claims written")
