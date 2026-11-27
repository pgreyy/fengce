#!/usr/bin/env bash
# Milestone 2b on X Layer mainnet: the rest of the guard v3 rules on the demo Safe (contracts/script/M2bDemo.s.sol),
# stopping at the first error:
#   1. hold     (after the demo Safe's Tilt-shield pause ends) hold lock 6 hours, buy 0.05 USDT0 of OKB, record that
#               selling it is refused (HOLD_LOCK)
#   2. quiet    quiet hours over the current UTC hour, record that a buy is refused (QUIET_HOURS)
#   3. partner  schedule the deployer as the Safe's partner; adding a partner is a loosening, so it waits 1 day
# Then, at least 1 day later:  scripts/m2b-onchain.sh --partner
#   4. partner2 apply the partner; schedule a small loosening (hold lock 6 h -> 3 h, which waits 7 days with a partner);
#               the partner approves it and it applies at once
# Spends 0.05 USDT0 of the demo Safe (one buy); the rest only records refusals or changes settings.
# Every transaction ID goes to deployments/m2-demo-xlayer-196.json.
#
# Usage:  scripts/m2b-onchain.sh                     (mainnet, steps 1-3; asks for the keystore password once)
#         scripts/m2b-onchain.sh --partner           (mainnet, step 4, after the 1-day wait)
#         scripts/m2b-onchain.sh --dry-run           (local fork: steps 1-4, moving the clock; nothing broadcast)
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
  STATE=deployments/m2-demo-dryrun.json # git-ignored copy
  cp deployments/m2-demo-xlayer-196.json "$STATE"
  PORT=8553
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

GUARD=$(python3 -c "import json;print(json.load(open('$STATE'))['guard'])")
SAFE=$(python3 -c "import json;print(json.load(open('$STATE'))['safe'])")

if [[ $PHASE2 == 0 ]]; then
  # the demo Safe's Tilt-shield pause must be over before the hold-lock buy
  SLOT=$(cast index address "$SAFE" "$(python3 -c 'print(0x9a57f217486e173034fca5d4a86893cc651eefd65d7136fdc890c40c96dcea92 + 4)')")
  TRIPPED=$(cast to-dec "$(cast call "$GUARD" "extsload(bytes32)(bytes32)" "$SLOT" --rpc-url $RPC)")
  COOLDOWN=$(cast call "$GUARD" "rulesOf(address)((bool,uint8,uint8,uint32,bool,bytes32,bytes32,uint16,uint32,address,address))" "$SAFE" --rpc-url $RPC | python3 -c "import sys;print(sys.stdin.read().strip('()\\n').split(', ')[8].split(' ')[0])")
  (( TRIPPED > 0 )) && wait_until $(( TRIPPED + COOLDOWN + 60 )) "the demo Safe's Tilt-shield pause ends"
  step hold
  # quiet hours cover the current UTC hour: do not start in its last 5 minutes
  NOW=$(cast block latest --field timestamp --rpc-url $RPC)
  (( NOW % 3600 >= 3300 )) && wait_until $(( (NOW / 3600 + 1) * 3600 + 60 )) "the next UTC hour starts"
  step quiet
  step partner
fi
if [[ $PHASE2 == 1 || $DRY == 1 ]]; then
  READY=$(python3 -c "import json;print(json.load(open('$STATE'))['steps']['partner']['partnerReadyAt'])")
  NOW=$(cast block latest --field timestamp --rpc-url $RPC)
  if [[ $DRY == 0 && $NOW -lt $READY ]]; then
    echo "The partner change is ready at $(date -u -d @$READY '+%Y-%m-%d %H:%M UTC'); run scripts/m2b-onchain.sh --partner after that."
    exit 1
  fi
  wait_until $(( READY + 5 )) "the partner change is ready"
  step partner2
else
  echo "Partner scheduled. Ready at $(date -u -d @$(python3 -c "import json;print(json.load(open('$STATE'))['steps']['partner']['partnerReadyAt'])") '+%Y-%m-%d %H:%M UTC'); then run: scripts/m2b-onchain.sh --partner"
fi

cleanup
echo "Done. Addresses and transaction IDs: $STATE"
