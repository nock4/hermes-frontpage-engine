#!/usr/bin/env bash
set -Eeuo pipefail

# Data-collection wrapper for the Daily Frontpage self-healing cron agent.
# It runs the normal press script, but never exits non-zero: failures are handed
# to the LLM cron agent as context so it can inspect artifacts, patch, commit,
# push, rerun the press path, and report the final proof.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if ! python3 "$REPO/scripts/press-owner.py" --validate; then
  exec python3 "$REPO/scripts/press-owner.py" -- bash "$0" "$@"
fi
BASE_SCRIPT="$REPO/scripts/cron/daily-frontpage-cron.sh"
RUN_ID="${DFE_PRESS_RUN_ID:-$(date '+%Y%m%d-%H%M%S')-$$}"
WRAPPER_LOG_DIR="$REPO/tmp/self-healing-cron"
WRAPPER_LOG="$WRAPPER_LOG_DIR/daily-frontpage-self-healing-$RUN_ID.log"
mkdir -p "$WRAPPER_LOG_DIR"

cd "$REPO"

# Explicit one-use operator request lets the EXISTING scheduler exercise proof
# and delivery on an already-published candidate without paying for a new plate.
# Claim under the shared lock; retain the request as evidence, never eval it.
if [[ "$#" == 0 && -f "$REPO/tmp/next-cron-proof-only" ]]; then
  claimed="$WRAPPER_LOG_DIR/proof-request-$RUN_ID.txt"
  mv "$REPO/tmp/next-cron-proof-only" "$claimed"
  proof_checkpoint="$(<"$claimed")"
  if [[ -z "$proof_checkpoint" ]]; then
    echo "PRESS_RUN_STATUS=failed: empty proof-only request; generation refused"
    exit 2
  fi
  set -- --proof-only "$proof_checkpoint"
  echo "EXECUTION_MODE=proof-only; no new generation authorized"
fi

echo "SELF_HEALING_CRON_CONTEXT_BEGIN"
echo "run_id=$RUN_ID"
echo "repo=$REPO"
echo "base_script=$BASE_SCRIPT"
echo "wrapper_log=$WRAPPER_LOG"
echo "started_at=$(date '+%Y-%m-%dT%H:%M:%S%z')"
echo "git_head=$(git rev-parse --short HEAD 2>/dev/null || true)"
echo "git_status_before<<EOF_STATUS"
git status --short 2>/dev/null || true
echo "EOF_STATUS"
echo "SELF_HEALING_CRON_CONTEXT_END"
echo
# Cron-owned script work completes before the agent starts. Agent terminal jobs,
# in contrast, are killed by cron cleanup when its turn/iteration budget ends.
printf '%s\n' \
  'PRESS_PROCESS_OWNERSHIP_CONTRACT_BEGIN' \
  'The scheduler-owned initial press has completed before this agent starts.' \
  'Any repair rerun launched by terminal is owned by THIS cron agent, not a durable detached service. Cron cleanup kills it when the agent ends, including on max_iterations_reached.' \
  'Do not finish with a press still active. Wait for its explicit exit and final artifacts; a process wait timeout is not completion. Do not rely on async notifications in cron.' \
  'Reserve monitoring/proof budget before launching each rerun. Batch bounded waits instead of spending one model turn on every short poll. Use foreground terminal windows of at most 600 seconds; larger requested timeouts are promoted to background, not longer synchronous waits.' \
  'Keep the existing limit of 3 repair/rerun cycles per cron session. Additional tool turns are for completing and verifying those cycles, never extra repair cycles.' \
  'If the remaining agent budget cannot own another complete rerun, preserve the run and report a blocked handoff BEFORE launching it. Do not recursively schedule a replacement or report an unfinished process as durable.' \
  'Scheduler status ok is not publication proof: require the final inner summary and normal remote, media, screenshot and adversarial gates.' \
  'PRESS_PROCESS_OWNERSHIP_CONTRACT_END'
echo

set +e
bash "$BASE_SCRIPT" "$@" > "$WRAPPER_LOG" 2>&1
code=$?
set -e

if [[ "$code" -eq 0 ]]; then
  echo "PRESS_RUN_STATUS=ok"
else
  echo "PRESS_RUN_STATUS=failed"
fi

echo "PRESS_RUN_EXIT_CODE=$code"
echo "PRESS_RUN_LOG=$WRAPPER_LOG"
echo "PUBLICATION_STATUS=unverified (agent must read exact checkpoint and proof; script exit is not publication)"

echo "PRESS_RUN_LAST_160_LINES_BEGIN"
tail -160 "$WRAPPER_LOG" || true
echo "PRESS_RUN_LAST_160_LINES_END"

latest_cron_log="$REPO/tmp/cron-logs/daily-frontpage-$RUN_ID.log"
checkpoint="$(node -e 'const fs=require("fs"); try { const lines=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(x=>x.trim().startsWith("\"checkpoint_path\":")); const line=lines.at(-1); if(line) console.log(JSON.parse(line.slice(line.indexOf(":")+1).trim().replace(/,$/,""))) } catch {}' "$latest_cron_log")"
latest_run_dir="$(node -e 'const fs=require("fs"); try { console.log(JSON.parse(fs.readFileSync(process.argv[1])).latest_run_dir || "") } catch {}' "$checkpoint")"
latest_fix_prompt="${DFE_REPORT_CACHE_DIR:-/Users/nickgeorge-studio/.hermes/profiles/frontpage/cache}/documents/daily-frontpage-fix-goal-$RUN_ID.md"
echo "PRESS_CHECKPOINT=$checkpoint"

echo "LATEST_CRON_LOG=$latest_cron_log"
echo "LATEST_RUN_DIR=$latest_run_dir"
echo "LATEST_FIX_PROMPT=$latest_fix_prompt"

if [[ -n "$latest_cron_log" ]]; then
  echo "PRESS_DOCTOR_JSON_BEGIN"
  npm run press:doctor -- --log "$latest_cron_log" --json 2>&1 || true
  echo "PRESS_DOCTOR_JSON_END"
fi

echo "PRESS_STABILITY_AUDIT_BEGIN"
npm run press:stability -- --limit 28 2>&1 || true
echo "PRESS_STABILITY_AUDIT_JSON_BEGIN"
npm run press:stability -- --limit 28 --json 2>&1 || true
echo "PRESS_STABILITY_AUDIT_JSON_END"
echo "PRESS_STABILITY_AUDIT_END"

# Always return success so the LLM cron agent receives this context and can act.
exit 0
