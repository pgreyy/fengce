#!/usr/bin/env bash
# Milestone 2c on X Layer mainnet: Catalog install and Build your own on a fresh Safe (contracts/script/M2bDemo.s.sol),
# stopping at the first error:
#   1. setup    deploy FengceSetupV3: a new Safe gets guard v3 during creation, in one signature
#   2. fresh    create a second Safe through it (max per buy 0.1 USDT0, Tilt-shield on, the deployer as partner from
#               creation), fund it with 0.12 USDT0 from the deployer
#   3. catalog  install the Catalog's Stablecoin Transfer Limit (circuit #2, cap 0.1 USDT0); free during launch, so no
#               payInstall; the change is scheduled, the partner approves it early and it applies; send 0.05 USDT0 to the
#               owner (allowed); record that a 0.5 USDT0 send is refused
#   4. build    tape out and pin a new circuit as Limits -> Build your own compiles it ("or": over 0.1 USDT0 or USDC),
#               schedule, partner approves, apply; send 0.05 USDT0 to the owner (allowed); record a 0.5 USDT0 refusal
# Moves 0.12 USDT0 to the new Safe (0.1 comes back to the owner) and pays about 0.002 OKB in TapeOut fees.
# Every address and transaction ID goes to deployments/m2-demo-xlayer-196.json.
#
# Usage:  scripts/m2c-onchain.sh             (mainnet: asks for the keystore password once)
#         scripts/m2c-onchain.sh --dry-run   (a local fork of X Layer: nothing broadcast to mainnet)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

DEPLOYER=0x6eAC9821430aCa193a717a7C17D68f8033D46087
ACCOUNT=fengce-deployer
MAINNET=https://rpc.xlayer.tech
DRY=0
PHASE2=0
for a in "$@"; do [[ $a == --dry-run ]] && DRY=1; [[ $a == --partner ]] && PHASE2=1; done

# One cleanup for every exit path (success, failure, Ctrl+C, kill): stop the fork and shred the password file.
ANVIL=""
PWFILE=""
cleanup() {
  [[ -n "$ANVIL" ]] && kill "$ANVIL" 2>/dev/null
  [[ -n "$PWFILE" && -e "$PWFILE" ]] && shred -u "$PWFILE" 2>/dev/null
  PWFILE=""
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ $DRY == 1 ]]; then
  STATE=deployments/m2c-demo-dryrun.json # git-ignored copy
  cp deployments/m2-demo-xlayer-196.json "$STATE"
  PORT=8554
  RPC=http://127.0.0.1:$PORT
  anvil --fork-url "$MAINNET" --port $PORT --auto-impersonate --silent &
  ANVIL=$!
  for _ in $(seq 60); do cast block-number --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.5; done
  SIGN=(--unlocked --sender $DEPLOYER)
  echo "Dry run on a local fork of X Layer (port $PORT). Nothing is sent to mainnet."
else
  STATE=deployments/m2-demo-xlayer-196.json
  RPC=$MAINNET
  echo "Milestone 2b on X Layer mainnet, from $DEPLOYER ($ACCOUNT)."
  read -r -s -p "Keystore password for $ACCOUNT: " PW
  echo
  # forge cannot read /dev/fd paths, so the password goes to a private file (mode 600, in the per-user runtime folder
  # when there is one) that the EXIT/INT/TERM trap shreds. It is never echoed or logged.
  PWDIR=${XDG_RUNTIME_DIR:-$HOME/.cache}
  [[ -d "$PWDIR" ]] || (umask 077 && mkdir -p "$PWDIR")
  PWFILE=$(umask 077 && mktemp "$PWDIR/m2-pw.XXXXXX")
  chmod 600 "$PWFILE"
  printf '%s' "$PW" >"$PWFILE"
  unset PW
  SIGN=(--account $ACCOUNT --sender $DEPLOYER)
fi

RECORD=$(cat <<'PY'
import json, re, sys
state, name, run = sys.argv[1], sys.argv[2], sys.argv[3]
s = json.load(open(state))
TOP = {"setupV3", "freshSafe", "catalogPin", "buildCircuitId", "buildPin", "buildNetlistHash"}
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
s.setdefault("txs", {})[name] = txs
json.dump(s, open(state, "w"), indent=2)
for t in txs:
    print("   tx", t["hash"], t["function"] or ("create " + str(t["contract"])))
PY
)

step() {
  local name=$1
  echo "== $name"
  local log pwarg=()
  [[ $DRY == 1 ]] || pwarg=(--password-file "$PWFILE")
  log=$(cd contracts && STEP=$name STATE="$ROOT/$STATE" forge script script/M2bDemo.s.sol --rpc-url $RPC "${SIGN[@]}" "${pwarg[@]}" --broadcast --slow 2>&1) || { echo "$log" | tail -25; exit 1; }
  python3 -c "$RECORD" "$STATE" "$name" contracts/broadcast/M2bDemo.s.sol/196/run-latest.json <<<"$log"
}

# waits (mainnet) or moves the fork's clock (dry run) until unix time $1
wait_until() {
  local now; now=$(cast block latest --field timestamp --rpc-url $RPC)
  local d=$(( $1 - now ))
  (( d > 0 )) || return 0
  if [[ $DRY == 1 ]]; then
    cast rpc evm_increaseTime $d --rpc-url $RPC >/dev/null && cast rpc evm_mine --rpc-url $RPC >/dev/null
    echo "== (fork) moved $d s ahead"
  else
    echo "== waiting $((d / 3600)) h $((d % 3600 / 60)) min ($2)"
    sleep $d
  fi
}

step setup
step fresh
step catalog
step build

cleanup
echo "Done. Addresses and transaction IDs: $STATE"
