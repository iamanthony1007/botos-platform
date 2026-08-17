#!/usr/bin/env bash
# Supervised wrangler tail with zombie protection.
#
# Usage:  bash scripts/tail-supervisor.sh production /tmp/wtail.log
#         bash scripts/tail-supervisor.sh staging /tmp/wtail_stg.log
#
# Why the hard timeout exists: wrangler tail sessions expire after ~6 hours, and
# wrangler does NOT reliably exit when the session dies. Observed live on
# 2026-08-17: a tail outlived its expired session by 5 hours, capturing nothing,
# while the process stayed alive so the supervisor loop never cycled and no
# exit marker was written. Two production sends went uncaptured. The timeout
# (18000s, five hours, just under the session lifetime) force-kills each tail
# before its session can zombie, so the loop reconnects with a fresh session and
# every cycle boundary is a timestamped marker in the log.
#
# Requires CLOUDFLARE_ACCOUNT_ID in the environment. Run from sales-bot/.

set -u
ENVNAME="${1:-production}"
LOG="${2:-/tmp/wtail_supervised.log}"
if [ "$ENVNAME" = "staging" ]; then ENVFLAG="--env staging"; else ENVFLAG=""; fi

while true; do
  echo "=== (re)connecting $(date -u +%Y-%m-%dT%H:%M:%SZ) env=$ENVNAME ===" >> "$LOG"
  CI=true timeout 18000 node node_modules/wrangler/bin/wrangler.js tail $ENVFLAG --format pretty >> "$LOG" 2>&1
  echo "=== tail cycled $(date -u +%Y-%m-%dT%H:%M:%SZ) (exit or 5h timeout), restart in 2s ===" >> "$LOG"
  sleep 2
done
