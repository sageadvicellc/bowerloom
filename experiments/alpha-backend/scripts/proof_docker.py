"""Docker commands restricted to this local proof's owned profiles."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_PROJECT = 'trellis-alpha-proof'
FRESH_PROJECT = 'trellis-alpha-proof-fresh'
DOCKER_CONTEXT = 'desktop-linux'
ACKNOWLEDGMENT = ORIGINAL_PROJECT + '@' + DOCKER_CONTEXT


def require_lifecycle_intent():
    if os.environ.get('TRELLIS_PROOF_TARGET') != ACKNOWLEDGMENT:
        raise SystemExit(
            'This experiment controls the fixed local trellis-alpha-proof project. '
            'Read PACKAGE.md. Set TRELLIS_PROOF_TARGET=trellis-alpha-proof@desktop-linux '
            'only when you intend to operate that project from this checkout.')


def docker_environment():
    """Keep process basics, but exclude Docker, Compose, and credential overrides."""
    return {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL') if key in os.environ}


def docker_command(arguments):
    return ['docker', '--context', DOCKER_CONTEXT, *arguments]


def docker_run(arguments, **kwargs):
    if 'env' in kwargs:
        raise ValueError('The proof controls the Docker environment.')
    return subprocess.run(docker_command(arguments), env=docker_environment(), **kwargs)


def compose_command(project):
    if project not in (ORIGINAL_PROJECT, FRESH_PROJECT):
        raise ValueError('The Compose project is outside this proof.')
    return ['compose', '-p', project, '--project-directory', str(ROOT / 'infra'),
            '--env-file', str(ROOT / '.private/stack.env'), '-f', str(ROOT / 'infra/compose.json')]


def compose_run(project, arguments, **kwargs):
    if not arguments or arguments[0] not in ('config', 'ps'):
        require_lifecycle_intent()
    return docker_run([*compose_command(project), *arguments], **kwargs)
