#!/usr/bin/env python3
"""Regressions for project isolation and restoration after disposal failure."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import proof_docker
import stack

spec = importlib.util.spec_from_file_location('fresh_start', Path(__file__).with_name('fresh-start.py'))
fresh_start = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fresh_start)
OBSERVATIONS = []
HOSTILE = {
    'COMPOSE_PROJECT_NAME': 'trellis-review-unrelated',
    'COMPOSE_FILE': '/does-not-exist/hostile-compose.yml',
    'COMPOSE_ENV_FILES': '/does-not-exist/hostile.env',
    'COMPOSE_PROFILES': 'hostile-profile',
    'COMPOSE_REMOVE_ORPHANS': '1',
    'COMPOSE_PROJECT_DIRECTORY': '/does-not-exist/hostile-project',
    'DOCKER_CONTEXT': 'trellis-review-unrelated-context',
    'DOCKER_HOST': 'tcp://127.0.0.1:1',
    'POSTGRES_PASSWORD': 'synthetic-hostile-password',
    'JWT_SECRET': 'synthetic-hostile-jwt',
    'ANON_KEY': 'synthetic-hostile-anon',
    'SERVICE_ROLE_KEY': 'synthetic-hostile-service',
    'PG_META_CRYPTO_KEY': 'synthetic-hostile-meta',
    'DASHBOARD_USERNAME': 'synthetic-hostile-user',
    'DASHBOARD_PASSWORD': 'synthetic-hostile-dashboard',
}


class LifecycleTests(unittest.TestCase):
    def assert_owned_call(self, command, kwargs, expected_project):
        self.assertEqual(command[:3], ['docker', '--context', 'desktop-linux'])
        self.assertEqual(command[command.index('-p') + 1], expected_project)
        self.assertTrue(not set(HOSTILE).intersection(kwargs['env']), 'An inherited override reached Docker.')
        self.assertEqual(command[command.index('--env-file') + 1], str(proof_docker.ROOT / '.private/stack.env'))
        self.assertEqual(command[command.index('-f') + 1], str(proof_docker.ROOT / 'infra/compose.json'))

    def test_hostile_environment_cannot_change_resolved_configuration(self):
        rows = []
        for project in (proof_docker.ORIGINAL_PROJECT, proof_docker.FRESH_PROJECT):
            baseline = proof_docker.compose_run(project, ['config', '--format', 'json'],
                                                check=True, capture_output=True, text=True, timeout=15)
            with patch.dict(os.environ, HOSTILE):
                altered = proof_docker.compose_run(project, ['config', '--format', 'json'],
                                                   check=True, capture_output=True, text=True, timeout=15)
            normal_configuration = json.loads(baseline.stdout)
            hostile_configuration = json.loads(altered.stdout)
            # Compare in memory. Never print the resolved credentials on assertion failure.
            self.assertTrue(normal_configuration == hostile_configuration,
                            'The hostile environment changed the resolved configuration.')
            self.assertEqual(hostile_configuration['name'], project)
            secrets = json.loads((proof_docker.ROOT / '.private/credentials.json').read_text())
            matches = [hostile_configuration['services'][service]['environment'][field] == secrets[key]
                       for service, field, key in [('db', 'POSTGRES_PASSWORD', 'POSTGRES_PASSWORD'),
                                                   ('meta', 'PG_META_DB_PASSWORD', 'POSTGRES_PASSWORD'),
                                                   ('studio', 'SUPABASE_SERVICE_KEY', 'SERVICE_ROLE_KEY'),
                                                   ('rest', 'PGRST_JWT_SECRET', 'JWT_SECRET')]]
            self.assertTrue(all(matches), 'Proof credentials differ from the resolved configuration.')
            rows.append({'project': project, 'configurationUnchanged': True, 'credentialEquality': True})
        OBSERVATIONS.append({'probe': 'hostile-environment', 'operation': 'read-only Compose config',
                             'results': rows, 'resourcesChanged': False, 'secretsPrinted': False})

    def test_all_original_lifecycle_actions_pin_project_and_environment(self):
        commands = []
        def run(command, **kwargs):
            self.assert_owned_call(command, kwargs, proof_docker.ORIGINAL_PROJECT)
            commands.append(command)
            return subprocess.CompletedProcess(command, 0)
        with patch.dict(os.environ, HOSTILE), patch.object(proof_docker.subprocess, 'run', side_effect=run):
            for action in ('start', 'stop', 'status', 'restart-database'):
                stack.perform(action)
        self.assertEqual(len(commands), 4)
        OBSERVATIONS.append({'probe': 'all-original-lifecycle-actions',
                             'actions': ['start', 'stop', 'status', 'restart-database'],
                             'project': proof_docker.ORIGINAL_PROJECT, 'realDockerLifecycleCommands': 0})

    def run_failure_case(self, failures):
        commands = []
        def run(command, **kwargs):
            project = command[command.index('-p') + 1]
            self.assert_owned_call(command, kwargs, project)
            action = 'up' if 'up' in command else 'down'
            stage = ('fresh-start' if action == 'up' else 'fresh-cleanup') if project == proof_docker.FRESH_PROJECT else (
                'original-restoration' if action == 'up' else 'original-stop')
            commands.append({'stage': stage, 'project': project, 'action': action})
            if stage in failures:
                raise subprocess.CalledProcessError(failures[stage], command)
            return subprocess.CompletedProcess(command, 0)
        with patch.dict(os.environ, HOSTILE), patch.object(proof_docker.subprocess, 'run', side_effect=run), patch.object(
                fresh_start, 'metadata_probe', return_value={'authenticatedMetadataStatus': 200, 'metadataBytes': 10}):
            result = fresh_start.run_fresh_test()
        return result, commands

    def test_restoration_runs_after_fresh_start_and_cleanup_fail(self):
        result, commands = self.run_failure_case({'fresh-start': 7, 'fresh-cleanup': 8})
        self.assertEqual([x['stage'] for x in commands],
                         ['original-stop', 'fresh-start', 'fresh-cleanup', 'original-restoration'])
        self.assertEqual([(x['stage'], x['exitCode']) for x in result['failures']],
                         [('fresh-start', 7), ('fresh-cleanup', 8)])
        self.assertTrue(result['restorationAttempted'])
        self.assertTrue(result['restorationSucceeded'])
        self.assertFalse(result['passed'])
        OBSERVATIONS.append({'probe': 'fresh-start-and-cleanup-fail', 'commands': commands,
                             'result': result, 'realDockerLifecycleCommands': 0})

    def test_restoration_failure_is_retained_with_both_prior_failures(self):
        result, commands = self.run_failure_case({'fresh-start': 7, 'fresh-cleanup': 8, 'original-restoration': 9})
        self.assertEqual([(x['stage'], x['exitCode']) for x in result['failures']],
                         [('fresh-start', 7), ('fresh-cleanup', 8), ('original-restoration', 9)])
        self.assertTrue(result['restorationAttempted'])
        self.assertFalse(result['restorationSucceeded'])
        self.assertFalse(result['passed'])
        OBSERVATIONS.append({'probe': 'all-three-failures-retained', 'commands': commands,
                             'result': result, 'realDockerLifecycleCommands': 0})

    def test_original_stop_failure_still_attempts_restoration(self):
        result, commands = self.run_failure_case({'original-stop': 6})
        self.assertEqual([x['stage'] for x in commands], ['original-stop', 'original-restoration'])
        self.assertTrue(result['restorationSucceeded'])
        self.assertFalse(result['passed'])

    def test_success_requires_fresh_disposal_and_original_restoration(self):
        result, commands = self.run_failure_case({})
        self.assertTrue(result['passed'])
        self.assertEqual(result['failures'], [])
        self.assertEqual([x['stage'] for x in commands],
                         ['original-stop', 'fresh-start', 'fresh-cleanup', 'original-restoration'])

    def test_nonproof_project_and_environment_injection_are_rejected(self):
        with self.assertRaises(ValueError):
            proof_docker.compose_command('trellis-review-unrelated')
        with self.assertRaises(ValueError):
            proof_docker.docker_run(['version'], env={'POSTGRES_PASSWORD': 'synthetic'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LifecycleTests))
    if args.evidence:
        args.evidence.write_text(json.dumps({'passed': result.wasSuccessful(), 'testCount': result.testsRun,
                                            'failureCount': len(result.failures), 'errorCount': len(result.errors),
                                            'probes': OBSERVATIONS}, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
