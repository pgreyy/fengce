#!/usr/bin/env bash
# Rebuilds the earlier Fengce site (commit f4388df, the build that is on TapeOut DeWeb as 6.2.180.tape since 24 Nov) as
# static pages under app/public/old/, served at /old/. Checks every built file against the SHA-256 recorded on chain
# at that commit (deployments/deweb-xlayer-196.json), then adds a noindex tag and a thin "archived" banner to each page.
# Links in that build are relative, so they stay inside /old/. Read-only on chain; needs network for npm ci.
#   scripts/archive-old.sh [work-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
COMMIT=f4388df
WORK=${1:-$(mktemp -d)}
git worktree add -q --detach "$WORK/old" $COMMIT
trap 'git -C "$ROOT" worktree remove --force "$WORK/old" 2>/dev/null || true' EXIT
(cd "$WORK/old/sdk" && npm ci --silent) && (cd "$WORK/old/app" && npm ci --silent && npx vite build >/dev/null)
git show $COMMIT:deployments/deweb-xlayer-196.json >"$WORK/record.json"
python3 - "$WORK/old/app/dist" "$WORK/record.json" "$ROOT/app/public/old" <<'PY'
import hashlib, json, os, shutil, sys
dist, record, out = sys.argv[1], sys.argv[2], sys.argv[3]
rec = json.load(open(record))["files"]
built = sorted(os.path.relpath(os.path.join(r, f), dist) for r, _, fs in os.walk(dist) for f in fs)
bad = [p for p in rec if p not in built or "0x" + hashlib.sha256(open(os.path.join(dist, p), "rb").read()).hexdigest() != rec[p]["sha256"]]
if bad or set(built) != set(rec):
    sys.exit(f"build differs from the on-chain record: {bad or sorted(set(built) ^ set(rec))}")
print(f"{len(built)} files identical to the on-chain record of 6.2.180.tape at {os.path.basename(record)}")
BANNER = ('<div role="note" style="position:relative;z-index:2147483647;margin:0;padding:8px 16px;background:#141414;color:#e9e9e4;'
          'font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;border-bottom:1px solid #333">'
          'Archived earlier version of Fengce. The current site is at '
          '<a href="https://getfengce.vercel.app/" style="color:#f0533f;text-decoration:underline">getfengce.vercel.app</a>.</div>')
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(dist, out)
for r, _, fs in os.walk(out):
    for f in fs:
        if f.endswith(".html"):
            p = os.path.join(r, f)
            h = open(p, encoding="utf-8").read()
            h = h.replace("<head>", '<head>\n    <meta name="robots" content="noindex, nofollow" />', 1)
            i = h.index(">", h.index("<body")) + 1
            open(p, "w", encoding="utf-8").write(h[:i] + BANNER + h[i:])
print(f"wrote {out}")
PY
