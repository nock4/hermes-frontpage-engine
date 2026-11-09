"""Read-only exact review-turn reconciliation; never submit/retry/modify a turn.

The frontpage DB supplies ONLY the admitted id + input binding (a legacy CLI
viewer prints no admission id). The live owner's authenticated prompt.receipt
supplies authoritative execution state. No default-profile/config/auth reads.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys


def admitted_turn(home, session_id, prompt):
    # Do not instantiate SessionDB: that can migrate/write. No transcript scan.
    with sqlite3.connect((home / 'state.db').as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('SELECT admission_id, generation, payload_json FROM session_admissions '
                          'WHERE target_session_id=?', (session_id,)).fetchall()
    if len(rows) != 1:
        raise ValueError('exact review admission unknown or multiple turns; reconcile without retry')
    admission, generation, encoded = rows[0]
    payload = json.loads(encoded)
    if payload.get('text') != prompt or payload.get('api_text', prompt) != prompt or payload.get('attachments'):
        raise ValueError('review admitted input changed; never retry')
    return admission, generation


async def observe(session_id, prompt_path):
    # Explicit frontpage scope even if called from another profile's shell.
    home = (Path.home() / '.hermes/profiles/frontpage').resolve()
    os.environ['HERMES_HOME'] = str(home)
    # The shipped venv exposes hermes_cli via an editable finder, but some
    # gateway imports (hermes_yaml, etc.) still need the installed source root.
    import hermes_cli
    sys.path.insert(0, str(Path(hermes_cli.__file__).resolve().parent.parent))
    from hermes_cli.gateway_client import connect_gateway
    from hermes_cli.gateway_runtime import discover_gateway_endpoint
    prompt = Path(prompt_path).read_text()
    admission, generation = admitted_turn(home, session_id, prompt)
    discovered = discover_gateway_endpoint(home)
    if discovered.state != 'ready':
        raise ValueError('review owner unavailable; exact outcome unknown, no retry')
    async with connect_gateway(discovered.endpoint) as client:
        snapshot = await client.rpc('session.resume', session_id=session_id, omit_messages=True)
        receipt = await client.rpc('prompt.receipt', session_id=session_id,
                                   admission_id=admission, include_result=True)
        # Re-read current fences after the receipt: a subsequent generation or
        # queued input is not the terminal turn we selected. Never infer idle
        # from sessions.ended_at, or a disconnected/expired event replay.
        latest = await client.rpc('session.resume', session_id=session_id, omit_messages=True)
        if (snapshot['execution_generation'] != latest['execution_generation']
                or latest['execution_generation'] != generation
                or receipt.get('execution_generation') != generation
                or receipt.get('ref', {}).get('profile_id') != str(home)):
            raise ValueError('review generation/profile changed; no retry')
        # Retain only turn state and model output, never inventory/system prompt.
        value = receipt.get('result') or {}
        result_keys = ('failed', 'completed', 'partial', 'interrupted', 'failure_reason',
                       'error', 'final_response', 'messages', 'tools', 'tool_call_count',
                       'output_tokens', 'input_tokens', 'last_reasoning')
        receipt = {k: receipt.get(k) for k in ('admission_id', 'ref', 'status', 'outcome',
                                              'authority_epoch', 'execution_generation')}
        receipt['result'] = {k: value[k] for k in result_keys if k in value}
        return {'session_id': latest['session_id'], 'execution_generation': latest['execution_generation'],
                'running': latest['running'], 'pending': latest['pending'], 'prompts': latest['prompts'],
                'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(), 'receipt': receipt}


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(observe(*sys.argv[1:]))))
    except Exception:
        # Unknown stays closed. No traceback carrying transport headers/tickets.
        print('Exact review turn reconciliation unavailable; preserve original, no retry', file=sys.stderr)
        sys.exit(1)
