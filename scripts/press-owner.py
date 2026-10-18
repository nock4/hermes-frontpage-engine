#!/usr/bin/env python3
"""Single-host press ownership, independent of scheduler/agent success.

Kernel flock is authoritative: stale metadata never justifies stealing a live
lock. The lock descriptor is inherited by the child so killing this supervisor
alone cannot release ownership while the press still runs.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid


def read_json(file):
    try:
        return json.loads(file.read_text())
    except (OSError, ValueError):
        return None


def write_json(file, data):
    temp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(data, indent=2) + '\n')
    os.replace(temp, file)


def group_alive(pgid):
    rows = subprocess.check_output(['ps', '-axo', 'pgid=,stat='], text=True, timeout=5)
    return any(parts[0] == str(pgid) and not parts[1].startswith('Z')
               for row in rows.splitlines() if len(parts := row.split()) >= 2)


def stop_group(pgid, grace):
    if not group_alive(pgid):
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    time.sleep(grace)
    if group_alive(pgid):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def valid_owner(root, previous):
    if not previous or not previous.get('token') or os.environ.get('DFE_PRESS_OWNER_TOKEN') != previous['token']:
        return False
    # Require a real ancestor, not merely a reused live PID or stale capability.
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid='], text=True, timeout=5)
    parents = {int(a): int(b) for row in rows.splitlines() for a, b in [row.split()]}
    current = os.getppid()
    while current > 1 and current != previous.get('pid'):
        current = parents.get(current, 0)
    if current != previous.get('pid'):
        return False
    with open(root / 'owner.lock', 'a+') as probe:
        try:
            fcntl.flock(probe.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return False
        except BlockingIOError:
            return True


def main():
    parser = argparse.ArgumentParser()
    script_root = Path(__file__).resolve().parents[1]
    owner_root = script_root
    if (script_root / '.git').exists():
        common = subprocess.check_output(['git', '-C', str(script_root), 'rev-parse', '--git-common-dir'], text=True, timeout=10).strip()
        common_path = (script_root / common).resolve()
        owner_root = common_path.parent
    parser.add_argument('--state-dir', default=str(owner_root / 'tmp' / 'press-owner'))
    parser.add_argument('--timeout', type=float, default=6600)
    parser.add_argument('--kill-grace', type=float, default=5)
    parser.add_argument('--validate', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if (not command and not args.validate) or args.timeout <= 0 or args.kill_grace < 0:
        parser.error('A command and positive timeout are required')
    root = Path(args.state_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    previous = read_json(root / 'owner.json')
    authenticated = valid_owner(root, previous)
    if args.validate:
        return 0 if authenticated else 1
    if authenticated:
        return subprocess.call(command)
    lock = open(root / 'owner.lock', 'a+')
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('PRESS_OWNER_BUSY ' + json.dumps(previous), file=sys.stderr)
        return 75
    run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:10]
    run_dir = root / 'runs' / run_id
    run_dir.mkdir(parents=True)
    record = dict(run_id=run_id, pid=os.getpid(), token=uuid.uuid4().hex,
                  command=command, started_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  status='running', publication='unverified', previous_owner=previous,
                  evidence_dir=str(run_dir))
    # Don't accumulate old token/command trees in subsequent metadata.
    if previous:
        record['previous_owner'] = {k: previous.get(k) for k in ('pid', 'run_id', 'status', 'evidence_dir')}
    write_json(root / 'owner.json', record)
    write_json(run_dir / 'status.json', record)
    env = dict(os.environ, DFE_PRESS_OWNER_TOKEN=record['token'], DFE_PRESS_RUN_ID=run_id)
    child = None
    interrupted: list[int | None] = [None]
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda signum, frame: interrupted.__setitem__(0, signum))
    parent = os.getpid()
    guardian = os.fork()
    if guardian:
        # No command exists until the independent lock-holding guardian is born.
        def forward(signum, frame):
            try:
                os.kill(guardian, signum)
            except ProcessLookupError:
                pass
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, forward)
        _, status = os.waitpid(guardian, 0)
        return os.waitstatus_to_exitcode(status)
    os.setsid()
    code = 1
    try:
        if os.getppid() != parent or interrupted[0]:
            raise RuntimeError('Owner exited before command launch; no command started')
        child = subprocess.Popen(command, env=env, start_new_session=True, pass_fds=(lock.fileno(),))
        deadline = time.monotonic() + args.timeout
        while child.poll() is None:
            if os.getppid() != parent:
                interrupted[0] = signal.SIGTERM
                record['orphan_recovered'] = True
            if interrupted[0] or time.monotonic() >= deadline:
                code = 128 + interrupted[0] if interrupted[0] else 124
                stop_group(child.pid, args.kill_grace)
                child.wait()
                break
            time.sleep(0.05)
        else:
            code = child.returncode if child.returncode >= 0 else 128 - child.returncode
    except Exception as error:
        record['error'] = str(error)
    finally:
        # A parent exiting is not proof that npm/provider descendants exited.
        if child is not None:
            stop_group(child.pid, args.kill_grace)

        record.update(exit_code=code, status='command_completed' if code == 0 else 'failed',
                      finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        record.pop('token', None)
        write_json(run_dir / 'status.json', record)
        write_json(root / 'latest.json', record)
        write_json(root / 'owner.json', record)
        print('PRESS_EXECUTION_RESULT=' + json.dumps(record), flush=True)
        lock.close()
    return code


if __name__ == '__main__':
    sys.exit(main())
