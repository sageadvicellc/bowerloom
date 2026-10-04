#!/usr/bin/env python3
"""Relocation and acknowledgment tests without Docker lifecycle operations."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('packaged_proof_docker', ROOT / 'scripts/proof_docker.py')
proof_docker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof_docker)


class PackageTests(unittest.TestCase):
    def test_manifest_matches_reviewed_imports(self):
        manifest = json.loads((ROOT / 'import-manifest.json').read_text())
        self.assertEqual(len(manifest['files']), 19)
        modified = []
        for entry in manifest['files']:
            actual = hashlib.sha256((ROOT / entry['path']).read_bytes()).hexdigest()
            self.assertEqual(actual, entry['packagedSha256'], entry['path'])
            if actual != entry['reviewedSha256']:
                modified.append(entry['path'])
        self.assertEqual(sorted(modified), ['scripts/fresh-start.py', 'scripts/prepare.py', 'scripts/proof_docker.py'])

    def test_source_package_excludes_private_and_runtime_material(self):
        forbidden_parts = {'.private', 'node_modules'}
        for path in ROOT.rglob('*'):
            self.assertTrue(not forbidden_parts.intersection(path.relative_to(ROOT).parts), 'Private material entered the package.')
            if path.is_file():
                self.assertFalse(path.name.endswith(('-result.json', '.log', '.png', '.jpg')), path.name)

    def test_lifecycle_requires_exact_target_before_subprocess(self):
        for supplied in (None, 'yes', 'trellis-review-unrelated@desktop-linux'):
            with patch.dict(os.environ, clear=False), patch.object(proof_docker.subprocess, 'run') as run:
                os.environ.pop('TRELLIS_PROOF_TARGET', None)
                if supplied is not None:
                    os.environ['TRELLIS_PROOF_TARGET'] = supplied
                for operation in ('up', 'down', 'restart'):
                    with self.assertRaises(SystemExit):
                        proof_docker.compose_run(proof_docker.ORIGINAL_PROJECT, [operation])
                run.assert_not_called()

    def test_exact_acknowledgment_keeps_the_pinned_target(self):
        with patch.dict(os.environ, {'TRELLIS_PROOF_TARGET': proof_docker.ACKNOWLEDGMENT,
                                     'COMPOSE_PROJECT_NAME': 'trellis-review-unrelated'}), patch.object(
                proof_docker.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            proof_docker.compose_run(proof_docker.ORIGINAL_PROJECT, ['down'])
        command = run.call_args.args[0]
        self.assertEqual(command[:3], ['docker', '--context', 'desktop-linux'])
        self.assertEqual(command[command.index('-p') + 1], 'trellis-alpha-proof')
        self.assertNotIn('COMPOSE_PROJECT_NAME', run.call_args.kwargs['env'])

    def test_relocated_source_rejects_preparation_and_fresh_start_without_ack(self):
        with tempfile.TemporaryDirectory(prefix='trellis-package-') as temporary:
            relocated = Path(temporary) / 'backend'
            shutil.copytree(ROOT, relocated, ignore=shutil.ignore_patterns('__pycache__'))
            environment = dict(os.environ)
            environment.pop('TRELLIS_PROOF_TARGET', None)
            for script, arguments in (('prepare.py', []), ('fresh-start.py', []),
                                      ('stack.py', ['start']), ('stack.py', ['stop']),
                                      ('stack.py', ['restart-database'])):
                result = subprocess.run([sys.executable, str(relocated / 'scripts' / script), *arguments],
                                        env=environment, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Set TRELLIS_PROOF_TARGET=', result.stderr)
                self.assertFalse((relocated / '.private').exists())
                self.assertFalse((relocated / 'fresh-start-result.json').exists())

    def test_reviewed_regressions_in_relocated_copy_with_synthetic_credentials(self):
        with tempfile.TemporaryDirectory(prefix='trellis-package-') as temporary:
            relocated = Path(temporary) / 'backend'
            shutil.copytree(ROOT, relocated, ignore=shutil.ignore_patterns('__pycache__'))
            private = relocated / '.private'
            private.mkdir(mode=0o700)
            keys = ('POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY',
                    'PG_META_CRYPTO_KEY', 'DASHBOARD_USERNAME', 'DASHBOARD_PASSWORD')
            synthetic = {key: 'synthetic-package-test-' + key.lower() for key in keys}
            (private / 'credentials.json').write_text(json.dumps(synthetic))
            (private / 'stack.env').write_text(''.join(key + '=' + value + '\n' for key, value in synthetic.items()))
            environment = {**os.environ, 'TRELLIS_PROOF_TARGET': proof_docker.ACKNOWLEDGMENT}
            result = subprocess.run([sys.executable, str(relocated / 'scripts/test_lifecycle.py')],
                                    env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, 'The relocated lifecycle regressions failed. No captured output is printed.')
            self.assertIn('Ran 7 tests', result.stderr)
            self.assertIn('OK', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
