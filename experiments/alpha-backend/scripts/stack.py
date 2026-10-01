#!/usr/bin/env python3
"""Bounded lifecycle operations for this proof's isolated Docker project."""
import argparse
import base64
import json
import shutil
import subprocess
import time
import urllib.request
from proof_docker import ROOT, ORIGINAL_PROJECT, compose_run


def studio_probe():
    secrets = json.loads((ROOT / '.private/credentials.json').read_text())
    token = base64.b64encode((secrets['DASHBOARD_USERNAME'] + ':' + secrets['DASHBOARD_PASSWORD']).encode()).decode()
    outcomes = {}
    for path in ['/project/default', '/api/platform/profile', '/api/platform/pg-meta/default/tables']:
        request = urllib.request.Request('http://127.0.0.1:56581' + path, headers={'Authorization': 'Basic ' + token})
        with urllib.request.urlopen(request, timeout=10) as response:
            outcomes[path] = {'status': response.status, 'bytes': len(response.read())}
    return outcomes


def perform(action):
    if action == 'start':
        if shutil.disk_usage(ROOT).free < 14 * 2**30:
            raise SystemExit('Refuse startup: preserve 12 GiB plus 2 GiB growth allowance.')
        started = time.monotonic()
        try:
            result = compose_run(ORIGINAL_PROJECT, ['up', '-d', '--wait', '--wait-timeout', '120'], timeout=150)
        except subprocess.TimeoutExpired:
            raise SystemExit('Docker did not finish within 150 seconds. No backend readiness claim is permitted.')
        if result.returncode:
            raise SystemExit(result.returncode)
        return {'startupSeconds': round(time.monotonic() - started, 3)}
    if action == 'stop':
        compose_run(ORIGINAL_PROJECT, ['down', '--timeout', '10'], check=True, timeout=45)
    elif action == 'status':
        compose_run(ORIGINAL_PROJECT, ['ps'], check=True, timeout=10)
    elif action == 'restart-database':
        compose_run(ORIGINAL_PROJECT, ['restart', '--timeout', '10', 'db'], check=True, timeout=30)
    elif action == 'studio':
        return studio_probe()
    else:
        raise ValueError('Unsupported proof action.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'status', 'studio', 'restart-database'])
    result = perform(parser.parse_args().action)
    if result is not None:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
