#!/usr/bin/env bash
# Milestone 2 on X Layer mainnet, in order, stopping at the first error:
#   1. tape out the Tilt-shield latch circuit and deploy FengceGuardV3 (+ FengceRulesV3) and AgentExecutorV3
#   2. create a demo Safe owned by the deployer and install v3 (max per buy 2 USDT0, 5 trades per clock hour,
#      Tilt-shield 4 buys / 30 min, quiet hours off; with AGENT=0x... that agent key at 0.5 USDT0 a day)
#   3. fund it with 1.5 USDT0 from the deployer (the whole demo needs at most 2 USDT0)
#   4. buy 0.2 USDT0 of OKB (allowed)
#   5. record on chain that a 3 USDT0 buy is refused (MAX_PER_BUY), without sending it
#   6. wait for the next 30-minute window, then 4 buys of 0.2: the 4th trips Tilt-shield
#   7. record on chain that one more buy is refused (TILT_SHIELD)
# Every address and transaction ID goes to deployments/m2-demo-xlayer-196.json.
#
# Usage:  scripts/m2-onchain.sh             (mainnet: asks for the fengce-deployer keystore password once)
#         scripts/m2-onchain.sh --dry-run   (a local fork of X Layer: no password, nothing broadcast to mainnet)
#         AGENT=0x... scripts/m2-onchain.sh (also sets that agent key on the Safe; see /agents)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

DEPLOYER=0x6eAC9821430aCa193a717a7C17D68f8033D46087
ACCOUNT=fengce-deployer
MAINNET=https://rpc.xlayer.tech
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

if [[ $DRY == 1 ]]; then
  OUT=deployments/m2-demo-dryrun.json # git-ignored
  STATE=$OUT
  rm -f "$STATE"
  PORT=8549
  RPC=http://127.0.0.1:$PORT
  anvil --fork-url "$MAINNET" --port $PORT --auto-impersonate --silent &
  ANVIL=$!
  trap 'kill $ANVIL 2>/dev/null' EXIT
  for _ in $(seq 60); do cast block-number --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done
  # the fork deployer gets 2 USDT0 and some OKB, as on mainnet
  cast rpc anvil_setBalance $DEPLOYER 0x16345785D8A0000 --rpc-url $RPC >/dev/null
  POOL=$(cast call 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA "factory()(address)" --rpc-url $RPC)
  POOL=$(cast call "$POOL" "getPool(address,address,uint24)(address)" 0x779Ded0c9e1022225f8E0630b35a9b54bE713736 0xe538905cf8410324e03A5A23C1c177a474D59b2b 500 --rpc-url $RPC)
  cast rpc anvil_setBalance "$POOL" 0x16345785D8A0000 --rpc-url $RPC >/dev/null
  cast send 0x779Ded0c9e1022225f8E0630b35a9b54bE713736 "transfer(address,uint256)" $DEPLOYER 2000000 --from "$POOL" --unlocked --rpc-url $RPC >/dev/null
  SIGN=(--unlocked --sender $DEPLOYER)
  echo "Dry run on a local fork of X Layer (port $PORT). Nothing is sent to mainnet."
else
  OUT=deployments/m2-demo-xlayer-196.json
  STATE=$OUT
  RPC=$MAINNET
  echo "Milestone 2 on X Layer mainnet, from $DEPLOYER ($ACCOUNT)."
  read -r -s -p "Keystore password for $ACCOUNT: " PW
  echo
  SIGN=(--account $ACCOUNT --sender $DEPLOYER)
fi
[[ -f "$STATE" && -s "$STATE" ]] || echo '{"chainId":196,"txs":{}}' >"$STATE"

RECORD=$(cat <<'PY'
import json, re, sys
state, name, run = sys.argv[1], sys.argv[2], sys.argv[3]
s = json.load(open(state))
TOP = {"guard", "agentExecutor", "safe", "owner", "agent", "tiltLatchCircuitId", "tiltLatchPin", "tiltLatchNetlistHash"}
for line in sys.stdin:
    m = re.search(r"M2 (\w+) (\S+)", line)
    if m:
        k, v = m.group(1), m.group(2)
        if k in TOP:
            s[k] = v
        else:
            s.setdefault("steps", {}).setdefault(name, {})[k] = v
r = json.load(open(run))
txs = []
for t in r.get("transactions", []):
    txs.append({"hash": t.get("hash"), "to": (t.get("transaction") or {}).get("to"), "function": t.get("function"), "contract": t.get("contractName"), "created": t.get("contractAddress")})
    if str(t.get("contractName") or "").startswith("FengceRulesV3"):
        s["rulesLibrary"] = t.get("contractAddress")
s.setdefault("txs", {})[name] = txs
json.dump(s, open(state, "w"), indent=2)
for t in txs:
    print("   tx", t["hash"], t["function"] or ("create " + str(t["contract"])))
PY
)

# Runs one step of script/M2Demo.s.sol, then records its printed values and transaction IDs in $STATE.
step() {
  local name=$1
  echo "== $name"
  local log
  if [[ $DRY == 1 ]]; then
    log=$(cd contracts && STEP=$name STATE="$ROOT/$STATE" forge script script/M2Demo.s.sol --rpc-url $RPC "${SIGN[@]}" --broadcast --slow 2>&1) || { echo "$log" | tail -25; exit 1; }
  else
    # the password reaches forge through a pipe (process substitution): never on disk, never in the process list
    log=$(cd contracts && STEP=$name STATE="$ROOT/$STATE" forge script script/M2Demo.s.sol --rpc-url $RPC "${SIGN[@]}" --password-file <(printf '%s' "$PW") --broadcast --slow 2>&1) || { echo "$log" | tail -25; exit 1; }
  fi
  local run=contracts/broadcast/M2Demo.s.sol/196/run-latest.json
  python3 -c "$RECORD" "$STATE" "$name" "$run" <<<"$log"
}

step deploy
step safe
step fund
step swap
step refuse

# Tilt-shield counts buys per 30-minute window (UTC :00 and :30): start the 4 buys in a fresh window, so the allowed
# swap above is not counted with them.
NOW=$(cast block latest --field timestamp --rpc-url $RPC)
WAIT=$(( (NOW / 1800 + 1) * 1800 - NOW + 15 ))
if [[ $DRY == 1 ]]; then
  cast rpc evm_increaseTime $WAIT --rpc-url $RPC >/dev/null && cast rpc evm_mine --rpc-url $RPC >/dev/null
  echo "== (fork) moved $WAIT s ahead to a new 30-minute window"
else
  echo "== waiting $((WAIT / 60)) min $((WAIT % 60)) s for a new 30-minute window (UTC :00 or :30)"
  sleep $WAIT
fi
step tilt
step paused

unset PW
echo "Done. Addresses and transaction IDs: $OUT"
