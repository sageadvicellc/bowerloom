// Synthetic guardrail fixtures for the fidelity tests. No private paths, no real rules.
import { ENGINE_IDS } from '../../../dist/packages/harness-definition/src/index.js';

export const NOW = new Date('2026-10-28T12:00:00Z');

/** A guardrail rule as the loader returns it. */
export const rule = (id, action, pattern, effect, extra = {}) =>
  ({ id, action, pattern, effect, strength: effect === 'allow' ? 'advisory' : 'enforced', privateBlocks: {}, ...extra });

export const sandbox = (extra = {}) => ({ id: 'box', strength: 'enforced', files: true, network: true, privateBlocks: {}, ...extra });

/** A guardrails-only source for every engine. */
export const source = (rules, extra = {}) => ({ rules, sandbox: [], engines: [...ENGINE_IDS], ...extra });

/** A rule set with every action and effect, used by the property tests. */
export const MIXED_RULES = [
  rule('no-push-main', 'shell', 'git push * main', 'deny'),
  rule('git-any', 'shell', 'git *', 'allow'),
  rule('ask-rm', 'shell', 'rm *', 'ask'),
  rule('allow-rm-i', 'shell', 'rm -i *', 'allow'),
  rule('no-curl', 'shell', 'curl *', 'deny'),
  rule('npm-test', 'shell', 'npm test *', 'allow'),
  rule('npm-run', 'shell', 'npm run:*', 'allow'),
  rule('no-version', 'shell', '* --version', 'deny'),
  rule('ask-docker', 'shell', 'docker *', 'ask'),
  rule('ls-glob', 'shell', 'ls*', 'allow'),
  rule('query', 'shell', 'echo a?b', 'deny'),
  rule('help-tail', 'shell', '* --help *', 'deny'),
  rule('no-env', 'read', '.env', 'deny'),
  rule('no-secrets', 'read', 'secrets/**', 'deny'),
  rule('read-src', 'read', 'src/**', 'allow'),
  rule('no-docs-edit', 'edit', 'docs/**', 'deny'),
  rule('ask-lock', 'write', '*.lock', 'ask'),
  rule('edit-md', 'edit', 'notes/*.md', 'allow'),
  rule('edit-src', 'edit', 'src/**', 'allow'),
  rule('no-evil', 'web', '*.evil.example', 'deny'),
  rule('web-ok', 'web', 'docs.example', 'allow'),
  rule('no-mcp-x', 'mcp', 'x', 'deny'),
  rule('ask-mcp', 'mcp', 'gh/create_issue', 'ask'),
  rule('mcp-read', 'mcp', 'gh/get', 'allow'),
  rule('no-agent', 'subagent', 'deployer', 'deny'),
  rule('agents-ok', 'subagent', 'review-*', 'allow'),
  rule('no-skill', 'skill', 'release', 'deny'),
  rule('skill-ok', 'skill', 'notes', 'allow'),
];

/** Requests that the property tests ask every engine about. */
export const SHELL_COMMANDS = [
  'git status', 'git push origin main', 'git push origin dev', 'git push', 'git log main', 'git', 'gitk',
  'rm x', 'rm -i x', 'rm -rf /x', 'rm', 'curl https://example.com', 'npm test', 'npm test --watch', 'npm run build',
  'npm run', 'npm --version', 'node --version', 'docker ps', 'ls', 'lsof', 'ls -la', 'echo a?b', 'echo axb', 'echo ab',
  'npm --help', 'npm --help x', 'cd /tmp && git push x main', 'git status && rm x', 'git status || rm -i y',
  'echo $(rm x)', 'echo `curl u`', 'git status; curl u', 'git status | grep x', '(rm x)', 'if true; then rm x; fi',
  'for f in a b; do rm -i $f; done', 'timeout 5 rm x', 'nohup git push o main', 'nice -n 5 curl u', 'FOO=bar rm x',
  'FOO=bar git status', 'sudo rm x', 'env rm x', "bash -c 'rm x'", '/bin/rm x', "git 'push' o main", 'git -C . push o main',
  'echo hi > out.txt', 'cat <<EOF', 'xargs rm', 'command rm x', 'git commit -m "a b"', 'npm test && npm run lint',
];
export const PATHS = [
  '.env', 'sub/.env', 'a/b/.env', 'secrets/k', 'x/secrets/k', 'secrets', 'src/a.ts', 'src/a/b.ts', 'vendor/src/a.ts',
  'docs/a.md', 'x/docs/a.md', 'docs', 'yarn.lock', 'a/yarn.lock', 'notes/a.md', 'notes/a/b.md', 'notes.md', 'README.md',
];
export const OTHER_REQUESTS = [
  { action: 'web', host: 'a.evil.example' }, { action: 'web', host: 'evil.example' }, { action: 'web', host: 'docs.example' },
  { action: 'web', host: 'other.example' }, { action: 'web', search: true },
  { action: 'mcp', server: 'x', tool: 'anything' }, { action: 'mcp', server: 'gh', tool: 'create_issue' },
  { action: 'mcp', server: 'gh', tool: 'get' }, { action: 'mcp', server: 'gh', tool: 'get_more' }, { action: 'mcp', server: 'gh_x', tool: 'y' },
  { action: 'subagent', name: 'deployer' }, { action: 'subagent', name: 'review-a' }, { action: 'subagent', name: 'other' },
  { action: 'skill', name: 'release' }, { action: 'skill', name: 'notes' }, { action: 'skill', name: 'other' },
];

export function allRequests() {
  return [
    ...SHELL_COMMANDS.map(command => ({ action: 'shell', command })),
    ...PATHS.flatMap(path => [{ action: 'read', path }, { action: 'edit', path }, { action: 'write', path }]),
    ...OTHER_REQUESTS,
  ];
}

/** A seeded generator, so a property failure can be replayed. */
export function random(seed) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, pick: list => list[Math.floor(next() * list.length)] };
}
