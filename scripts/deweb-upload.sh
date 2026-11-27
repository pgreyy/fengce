#!/usr/bin/env bash
# Re-uploads the current site build to TapeOut DeWeb on X Layer, in place: the same circuit, container and name
# (6.2.180.tape), only files that changed, files no longer in the build removed (contracts/script/DeployDeWeb.s.sol).
# Then checks every file on chain against the build (app/scripts/deweb-check.mts) and updates
# deployments/deweb-xlayer-196.json.
#
# Usage:  scripts/deweb-upload.sh             (mainnet: asks for the fengce-deployer keystore password once)
#         scripts/deweb-upload.sh --dry-run   (simulates every upload against live X Layer state, no key, nothing sent;
#                                              prints the estimated OKB)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DEPLOYER=0x6eAC9821430aCa193a717a7C17D68f8033D46087
ACCOUNT=fengce-deployer
RPC=https://rpc.xlayer.tech
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
ANVIL=""
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

echo "== build"
(cd app && npm run build >/dev/null)
echo "   $(find app/dist -type f | wc -l) files, $(du -sh app/dist | cut -f1)"

if [[ $DRY == 1 ]]; then
  cp deployments/deweb-xlayer-196.json "$ROOT/.deweb-record.bak"
  trap 'cleanup; mv -f "$ROOT/.deweb-record.bak" "$ROOT/deployments/deweb-xlayer-196.json" 2>/dev/null || true' EXIT
  echo "== dry run: simulating the upload on live X Layer state (nothing is sent)"
  (cd contracts && forge script script/DeployDeWeb.s.sol --rpc-url $RPC --sender $DEPLOYER 2>&1) | grep -E "chunks uploaded|Estimated|name|circuit #|container|Error|revert" | sed 's/^/   /'
  echo "   deployer balance: $(cast balance $DEPLOYER --ether --rpc-url $RPC) OKB"
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
echo "== upload"
(cd contracts && forge script script/DeployDeWeb.s.sol --rpc-url $RPC --account $ACCOUNT --sender $DEPLOYER --password-file "$PWFILE" --broadcast --slow 2>&1) | grep -E "chunks uploaded|name|circuit #|container|Error|revert|ONCHAIN EXECUTION" | sed 's/^/   /'
cleanup
echo "== check every file on chain against the build"
(cd app && npx tsx scripts/deweb-check.mts)
echo "Done. Record: deployments/deweb-xlayer-196.json"
