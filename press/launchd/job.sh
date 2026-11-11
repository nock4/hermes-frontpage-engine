#!/bin/zsh
# The daily press job, run by launchd (see com.nockgarden.frontpage-press.plist).
#   job.sh ENV_FILE
# Brings this checkout up to date with main, refreshes the bookmark list, then
# runs the press once. Every step is safe to repeat: the press builds at most
# one missing edition and pushes only what is new.
set -u
cd "${0:A:h}/../.." || exit 1
set -a; source "$1" || exit 1; set +a

branch=$(git rev-parse --abbrev-ref HEAD)
lock_before=$(git rev-parse HEAD:package-lock.json 2>/dev/null)
if git fetch -q origin; then
  if [[ "$branch" == main ]]; then
    git rebase -q --autostash origin/main || { git rebase --abort; echo "press: could not rebase onto origin/main, running the code already here"; }
  else
    # A shadow branch follows main so it always runs current code beside the live editions.
    git merge -q --no-edit origin/main || { git merge --abort; echo "press: could not merge origin/main, running the code already here"; }
  fi
else
  echo "press: git fetch failed, running the code already here"
fi
if [[ ! -d node_modules || "$lock_before" != "$(git rev-parse HEAD:package-lock.json 2>/dev/null)" ]]; then
  npm ci --no-audit --no-fund --silent || exit 1
fi

# No vault, no sources: stop here and say so, instead of building from a stale list.
if [[ ! -d "${PRESS_VAULT:-}" ]]; then
  node -e 'import("./press/lib/telegram.mjs").then((m) => m.tell(process.argv[1]))' \
    "Frontpage press did not run: vault not found at ${PRESS_VAULT:-(PRESS_VAULT is not set)}. Move the vault there or fix PRESS_VAULT in $1"
  exit 1
fi
node press/sync-candidates.mjs || echo "press: bookmark list not refreshed, using the last one"
exec npx tsx press/press.mjs run
