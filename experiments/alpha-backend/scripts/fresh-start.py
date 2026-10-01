#!/usr/bin/env python3
"""Test disposable synthetic volumes and always attempt original-profile restoration."""
import base64
import json
import shutil
import subprocess
import time
import urllib.request
from proof_docker import ROOT, ORIGINAL_PROJECT, FRESH_PROJECT, compose_run, docker_run, require_lifecycle_intent

UP = ['up', '-d', '--wait', '--wait-timeout', '120']


def metadata_probe():
    secret = json.loads((ROOT / '.private/credentials.json').read_text())
    token = base64.b64encode((secret['DASHBOARD_USERNAME'] + ':' + secret['DASHBOARD_PASSWORD']).encode()).decode()
    request = urllib.request.Request('http://127.0.0.1:56581/api/platform/pg-meta/default/tables',
                                     headers={'Authorization': 'Basic ' + token})
    with urllib.request.urlopen(request, timeout=10) as response:
        return {'authenticatedMetadataStatus': response.status, 'metadataBytes': len(response.read())}


def record_failure(result, stage, error):
    # Do not retain command output, exception text, or credential-bearing arguments.
    failure = {'stage': stage, 'type': type(error).__name__}
    if isinstance(error, subprocess.CalledProcessError):
        failure['exitCode'] = error.returncode
    if isinstance(error, subprocess.TimeoutExpired):
        failure['timeoutSeconds'] = error.timeout
    result['failures'].append(failure)


def run_fresh_test():
    result = {'observedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'scope': FRESH_PROJECT, 'freshVolumes': True, 'passed': False,
              'failures': [], 'restorationAttempted': False, 'restorationSucceeded': False}
    stage = 'original-stop'
    original_stop_attempted = False
    fresh_start_attempted = False
    try:
        original_stop_attempted = True
        compose_run(ORIGINAL_PROJECT, ['down', '--timeout', '10'], check=True, timeout=45)
        stage = 'fresh-start'
        fresh_start_attempted = True
        started = time.monotonic()
        compose_run(FRESH_PROJECT, UP, check=True, timeout=150)
        result['startupSeconds'] = round(time.monotonic() - started, 3)
        stage = 'metadata-probe'
        result.update(metadata_probe())
    except BaseException as error:
        record_failure(result, stage, error)
    finally:
        try:
            if fresh_start_attempted:
                # Only this script's disposable synthetic profile receives --volumes.
                compose_run(FRESH_PROJECT, ['down', '--volumes', '--timeout', '10'], check=True, timeout=45)
        except BaseException as error:
            record_failure(result, 'fresh-cleanup', error)
        finally:
            if original_stop_attempted:
                result['restorationAttempted'] = True
                try:
                    compose_run(ORIGINAL_PROJECT, UP, check=True, timeout=150)
                    result['restorationSucceeded'] = True
                except BaseException as error:
                    record_failure(result, 'original-restoration', error)
    result['passed'] = (result.get('authenticatedMetadataStatus') == 200 and
                        result['restorationSucceeded'] and not result['failures'])
    return result


def main():
    require_lifecycle_intent()
    if shutil.disk_usage(ROOT).free < 14 * 2**30:
        raise SystemExit('Refuse fresh startup: preserve the disk reserve.')
    volumes = docker_run(['volume', 'ls', '--filter', 'name=' + FRESH_PROJECT + '_', '--format', '{{.Name}}'],
                         check=True, capture_output=True, text=True, timeout=10)
    if volumes.stdout.strip():
        raise SystemExit('Fresh proof volumes already exist. Inspect them before a new fresh-volume test.')
    result = run_fresh_test()
    (ROOT / 'fresh-start-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2), flush=True)
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
