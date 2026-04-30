#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/.runtime"
PREVIEW_PORT="${PREVIEW_PORT:-4174}"
PREVIEW_HOST="127.0.0.1"
PREVIEW_LOG="$RUNTIME_DIR/preview.log"
TUNNEL_LOG="$RUNTIME_DIR/cloudflared.log"
PREVIEW_PID_FILE="$RUNTIME_DIR/preview.pid"
TUNNEL_PID_FILE="$RUNTIME_DIR/cloudflared.pid"

if [ "${ALLOW_PUBLIC_TUNNEL:-}" != "1" ]; then
  cat <<EOF >&2
Refusing to open a public preview tunnel without explicit opt-in.

This script exposes your local preview server on a public trycloudflare URL.
If you really want that, rerun with:
  ALLOW_PUBLIC_TUNNEL=1 $ROOT/scripts/start-preview-tunnel.sh
EOF
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
cd "$ROOT"

kill_if_running() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

kill_if_running "$PREVIEW_PID_FILE"
kill_if_running "$TUNNEL_PID_FILE"

npm run validate:editions
npm run build >/dev/null

nohup npm run preview -- --host "$PREVIEW_HOST" --port "$PREVIEW_PORT" >"$PREVIEW_LOG" 2>&1 &
echo $! > "$PREVIEW_PID_FILE"

for _ in $(seq 1 20); do
  if curl -fsS "http://$PREVIEW_HOST:$PREVIEW_PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://$PREVIEW_HOST:$PREVIEW_PORT" >/dev/null 2>&1; then
  echo "Preview server failed to start. See $PREVIEW_LOG"
  exit 1
fi

: > "$TUNNEL_LOG"
nohup cloudflared tunnel --url "http://$PREVIEW_HOST:$PREVIEW_PORT" --logfile "$TUNNEL_LOG" > /dev/null 2>&1 &
echo $! > "$TUNNEL_PID_FILE"

TUNNEL_URL=""
for _ in $(seq 1 30); do
  if grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" >/dev/null 2>&1; then
    TUNNEL_URL="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n 1)"
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "Tunnel URL not found yet. See $TUNNEL_LOG"
  exit 1
fi

cat <<EOF
Preview server: http://$PREVIEW_HOST:$PREVIEW_PORT
Public tunnel: $TUNNEL_URL
Warning: anyone with this URL can reach your local preview until you stop the tunnel.
Preview log: $PREVIEW_LOG
Tunnel log: $TUNNEL_LOG
Stop both: $ROOT/scripts/stop-preview-tunnel.sh
EOF
