#!/usr/bin/env bash
# Re-uploads the current site build to TapeOut DeWeb on X Layer, in place (the same circuit, container and name,
# 6.2.180.tape), in small batches that survive interruptions (contracts/script/DeployDeWeb.s.sol):
#   - every batch first reads the chain and sends only the chunks that are missing (a partial file resumes; SiteRegistry's
#     appendChunk checks the chunk index, so a chunk can never be appended twice);
#   - before each batch it waits until no transaction from the deployer is still pending, reports which of Foundry's
#     recorded transactions landed, then starts the batch fresh (nothing already on chain is sent again);
#   - each batch is retried up to 5 times with backoff, switching to the second X Layer RPC when one keeps failing;
#   - phase 1 uploads the content-hashed assets (new names: the live site keeps working); phase 2 uploads data files and
#     then the pages, and only when every chunk is on chain removes old files and keeps the name live;
#   - at the end every file is read back from chain and checked by SHA-256 against the build;
#   - a lock file stops a second upload from running at the same time.
#
# Usage:  scripts/deweb-upload.sh             (mainnet: asks for the fengce-deployer keystore password once)
#         scripts/deweb-upload.sh --dry-run   (reads the chain: chunks left and the OKB they need; nothing is sent)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEPLOYER=0x6eAC9821430aCa193a717a7C17D68f8033D46087
ACCOUNT=fengce-deployer
RPCS=(https://rpc.xlayer.tech https://xlayerrpc.okx.com)
RPC_I=0
BATCH=${BATCH:-12}            # chunks per batch
GAS_PER_CHUNK=5300000         # measured: 825M gas for 158 chunks of 24 KB
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
ANVIL=""
RUN=contracts/broadcast/DeployDeWeb.s.sol/196/run-latest.json

exec 9>"$ROOT/.deweb-upload.lock"
flock -n 9 || { echo "Another DeWeb upload is already running (lock: .deweb-upload.lock). Not starting a second one."; exit 1; }

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

rpc() { echo "${RPCS[$RPC_I]}"; }
switch_rpc() { RPC_I=$(( (RPC_I + 1) % ${#RPCS[@]} )); echo "   switching RPC to $(rpc)"; }
val() { grep -oE "DEWEB $1 [0-9]+" <<<"$2" | tail -1 | awk '{print $3}'; }

# forge with retries: up to 5 attempts, backoff 10, 20, 40, 80 s, a second RPC after two failures in a row
forge_run() {
  local env=("$@") out attempt
  for attempt in 1 2 3 4 5; do
    if out=$(cd contracts && env "${env[@]}" forge script script/DeployDeWeb.s.sol --rpc-url "$(rpc)" "${FORGE_ARGS[@]}" 2>&1); then
      echo "$out"
      return 0
    fi
    echo "   attempt $attempt failed: $(grep -m1 -iE "error|reset|timed out|revert" <<<"$out" | cut -c1-160)" >&2
    (( attempt % 2 == 0 )) && switch_rpc >&2
    (( attempt < 5 )) && sleep $(( 10 * 2 ** (attempt - 1) ))
  done
  return 1
}

# no transaction of the deployer may still be in flight before a batch starts fresh
pending_clear() {
  if [[ -f "$RUN" ]]; then
    local landed=0 missing=0 h
    for h in $(python3 -c "import json;print(' '.join(t['hash'] for t in json.load(open('$RUN')).get('transactions',[]) if t.get('hash')))"); do
      if cast receipt "$h" status --rpc-url "$(rpc)" >/dev/null 2>&1; then landed=$((landed + 1)); else missing=$((missing + 1)); fi
    done
    echo "   last batch: $landed transactions on chain, $missing not on chain (those are recomputed from chain, not resent)"
  fi
  local i latest pending
  for i in $(seq 120); do
    latest=$(cast nonce $DEPLOYER --block latest --rpc-url "$(rpc)" 2>/dev/null || echo x)
    pending=$(cast nonce $DEPLOYER --block pending --rpc-url "$(rpc)" 2>/dev/null || echo y)
    [[ "$latest" == "$pending" ]] && return 0
    (( i == 1 )) && echo "   waiting for $(( pending - latest )) pending transaction(s) to settle"
    sleep 5
  done
  echo "Transactions from the deployer are still pending after 10 minutes; run the script again later." >&2
  exit 1
}

echo "== build"
(cd app && npm run build >/dev/null)
echo "   $(find app/dist -type f | wc -l) files, $(du -sh app/dist | cut -f1)"

FORGE_ARGS=(--sender $DEPLOYER)
echo "== reading the chain"
PLAN=$(forge_run PLAN=1) || { echo "Could not read the chain." >&2; exit 1; }
A=$(val remainingAssets "$PLAN"); F=$(val remainingFinal "$PLAN")
LEFT=$(( A + F ))
GWEI=$(cast gas-price --rpc-url "$(rpc)")
NEED=$(python3 -c "print(f'{($LEFT * $GAS_PER_CHUNK + 600000) * $GWEI * 1.2 / 1e18:.4f}')")
BAL=$(cast balance $DEPLOYER --ether --rpc-url "$(rpc)")
echo "   chunks left: $LEFT ($A asset chunks, $F page and data chunks)"
echo "   estimated cost: about $NEED OKB (gas price $(python3 -c "print($GWEI/1e9)") gwei, 20% margin); deployer has $BAL OKB"
if [[ $DRY == 1 ]]; then
  python3 -c "import sys;sys.exit(0 if $BAL >= $NEED else 1)" && echo "   enough OKB." || echo "   not enough OKB: send at least $(python3 -c "print(f'{$NEED - $BAL + 0.005:.3f}')") OKB to $DEPLOYER first."
  exit 0
fi

echo "TapeOut DeWeb upload on X Layer mainnet, from $DEPLOYER ($ACCOUNT)."
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
FORGE_ARGS=(--account $ACCOUNT --sender $DEPLOYER --password-file "$PWFILE" --broadcast --slow --start-fresh)

for PHASE in assets final; do
  while :; do
    pending_clear
    echo "== $PHASE: batch of up to $BATCH chunks"
    OUT=$(forge_run PHASE=$PHASE MAX_CHUNKS=$BATCH) || { echo "The batch kept failing after 5 attempts. Run the script again: it continues from the chain." >&2; exit 1; }
    echo "   sent $(val chunksSent "$OUT") chunks; left: $(val remainingAssets "$OUT") asset, $(val remainingFinal "$OUT") page and data"
    if [[ $PHASE == assets ]]; then [[ "$(val remainingAssets "$OUT")" == 0 ]] && break
    else [[ "$(val done "$OUT")" == 1 ]] && break
    fi
  done
done
cleanup

echo "== check every file on chain by SHA-256"
(cd app && npx tsx scripts/deweb-check.mts) | tail -3
python3 - <<'PY'
import hashlib, json, os
rec = json.load(open("deployments/deweb-xlayer-196.json"))["files"]
built = {os.path.relpath(os.path.join(r, f), "app/dist"): "0x" + hashlib.sha256(open(os.path.join(r, f), "rb").read()).hexdigest() for r, _, fs in os.walk("app/dist") for f in fs}
bad = [p for p in built if rec.get(p, {}).get("sha256") != built[p]] + [p for p in rec if p not in built]
print(f"   {len(built)} files in the build; on chain: {len(rec)}; {'all match' if not bad else f'{len(bad)} differ: ' + ', '.join(bad[:5])}")
PY
echo "Done. Record: deployments/deweb-xlayer-196.json"
