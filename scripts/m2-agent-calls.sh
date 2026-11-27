#!/usr/bin/env bash
# Prints the two OKX Agentic Wallet calls for the Milestone 2 agent demo, from deployments/m2-demo-xlayer-196.json
# (written by scripts/m2-onchain.sh with AGENT set). The agentic wallet sends them to AgentExecutorV3 with
# `onchainos wallet contract-call`; the Safe pays, FengceGuardV3 decides:
#   1. pay 0.3 USDT0 back to the Safe owner        -> allowed (0.3 of the agent's 0.5 USDT0 daily cap)
#   2. pay 0.3 USDT0 again                         -> refused, recorded as Denied with FengceRefused(AGENT_CAP = 6)
# Usage: scripts/m2-agent-calls.sh [deployments/m2-demo-xlayer-196.json]
set -euo pipefail
cd "$(dirname "$0")/.."
F=${1:-deployments/m2-demo-xlayer-196.json}
get() { python3 -c "import json,sys;print(json.load(open('$F'))['$1'])"; }
EXEC=$(get agentExecutor); SAFE=$(get safe); OWNER=$(get owner); AGENT=$(get agent)
USDT0=0x779Ded0c9e1022225f8E0630b35a9b54bE713736
PAY=$(cast calldata "transfer(address,uint256)" "$OWNER" 300000)
CALL=$(cast calldata "execute(address,address,uint256,bytes)" "$SAFE" $USDT0 0 "$PAY")
echo "Agent key:        $AGENT (must be the agentic wallet that sends these)"
echo "AgentExecutorV3:  $EXEC"
echo "Safe:             $SAFE"
echo
echo "Both calls are the same (0.3 USDT0 each); the first is allowed, the second is refused (AGENT_CAP)."
echo "Run this twice from the agentic wallet (it returns 'confirming' first; re-run with --force after you confirm):"
echo
echo "onchainos wallet contract-call --chain xlayer --to $EXEC --input-data $CALL --from $AGENT"
