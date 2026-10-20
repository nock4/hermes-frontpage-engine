#!/usr/bin/env python3
"""Frontpage-only no-agent watchdog: no model or generation process.
All operational invocations enter here (flock + 150s child deadline).
Scheduling still depends on the host and the Hermes scheduler/gateway.
"""
import fcntl
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PROFILE = Path.home() / '.hermes/profiles/frontpage'
STATE = PROFILE / 'delivery'


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'watchdog.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        env = dict(os.environ)
        env['HERMES_HOME'] = str(PROFILE)
        env['PATH'] = '/Users/nickgeorge-studio/Projects/hermes/hermes-agent/venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
        try:
            return subprocess.run(['/opt/homebrew/bin/node', str(ROOT / 'scripts/delivery-watchdog.mjs'), *sys.argv[1:]], cwd=ROOT, env=env, timeout=150).returncode
        except subprocess.TimeoutExpired:
            # A pending receipt deliberately remains ambiguous; never resend it blindly.
            print('Delivery watchdog exceeded 150s. Inspect pending receipt before retry.', file=sys.stderr)
            return 1


if __name__ == '__main__':
    sys.exit(main())
