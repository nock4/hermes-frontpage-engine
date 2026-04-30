#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT/.runtime"
PREVIEW_PID_FILE="$RUNTIME_DIR/preview.pid"
TUNNEL_PID_FILE="$RUNTIME_DIR/cloudflared.pid"

stop_pid_file() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      echo "Stopped PID $pid"
    fi
    rm -f "$pid_file"
  fi
}

stop_pid_file "$TUNNEL_PID_FILE"
stop_pid_file "$PREVIEW_PID_FILE"

echo "Done."
