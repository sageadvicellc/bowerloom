// Synthetic definition folders for the harness-definition tests. No private paths, no real rules, no real secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FORMAT = 'bowerloom/harness/v1beta1';

export function harness(extra = {}) {
  return JSON.stringify({
    format: FORMAT,
    id: 'demo',
    description: 'A demo harness.',
    engines: [{ id: 'claude-code' }, { id: 'codex' }],
    parts: {},
    ...extra,
  }, null, 2) + '\n';
}

export const skill = (name, description = 'Reviews a change.', extra = '', body = `Body of ${name}.\n`) =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}`;

export const agent = (name, extra = '', body = 'Read the files and report.\n') =>
  `---\nname: ${name}\ndescription: A read-only reader.\n${extra}---\n\n${body}`;

export const json = value => JSON.stringify(value, null, 2) + '\n';

export const FULL_PARTS = {
  'system-prompt': 'instructions/AGENTS.md',
  memory: 'instructions/AGENTS.md',
  'tool-guidance': ['instructions/AGENTS.md#Tool guidance', 'skills/review'],
  skills: 'skills/',
  subagents: 'agents/',
  guardrails: 'guardrails.json',
  scripts: 'scripts/',
  plugins: 'sources.json',
  hooks: 'hooks.json',
  mcp: 'mcp.json',
};

/** Every part, one or more entries each. */
export function fullFiles(overrides = {}) {
  return {
    'harness.json': harness({ parts: FULL_PARTS }),
    'instructions/AGENTS.md': '# Demo\n\nStanding fact: the demo uses npm.\n\n## Tool guidance\n\nSearch before you read.\n',
    'skills/review/SKILL.md': skill('review', 'Reviews a change.', 'license: MIT\nmetadata:\n  owner: demo\n'),
    'skills/review/references/notes.md': 'Review notes.\n',
    'skills/deploy/SKILL.md': skill('deploy', 'Deploys the demo.'),
    'agents/reader.md': agent('reader', [
      'model:',
      '  claude-code: model-a',
      '  codex: model-b',
      'tools:',
      '  - read',
      '  - search',
      '  - "mcp:github"',
      'skills:',
      '  - review',
      'x-claude-code:',
      '  color: blue',
      '  permissionMode: plan',
      '',
    ].join('\n')),
    'agents/writer.md': agent('writer', 'engines:\n  - codex\nx-codex:\n  sandbox_mode: workspace-write\n  nested:\n    depth: 0.5\n'),
    'guardrails.json': json({
      rules: [
        { id: 'no-push-main', action: 'shell', pattern: 'git push * main', effect: 'deny', strength: 'enforced' },
        { id: 'git-any', action: 'shell', pattern: 'git *', effect: 'allow', strength: 'advisory' },
        { id: 'ask-rm', action: 'shell', pattern: 'rm *', effect: 'ask', strength: 'enforced', engines: ['claude-code'], 'x-claude-code': { note: 'kept' } },
      ],
      sandbox: { files: true, network: true },
    }),
    'hooks.json': json({
      hooks: [
        { id: 'lint-on-edit', event: 'PostToolUse', matcher: 'Edit', command: '${PROJECT_DIR}/scripts/lint.sh', timeout: 30000, strength: 'advisory' },
        { id: 'codex-only', event: 'PreToolUse', matcher: 'Bash', command: 'true', strength: 'enforced', engines: ['codex'] },
      ],
    }),
    'mcp.json': json({
      servers: [
        { name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'example-github-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', LOG_LEVEL: 'info' } },
        { name: 'docs', transport: 'http', url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}', 'X-Key': { keychain: 'docs-api' } }, engines: ['claude-code'] },
      ],
    }),
    'scripts/lint.sh': '#!/bin/sh\nexit 0\n',
    'sources.json': json({ sources: [{ name: 'review-kit', marketplace: 'example-market', version: '1.2.0', items: [{ part: 'skills', id: 'review' }] }] }),
    'engines/codex/config-extra.toml': '[features]\nweb_search = true\n',
    ...overrides,
  };
}

const made = [];

/** Writes files under a new temporary layer folder and returns the path of its `.bowerloom` folder. */
export function makeDefinition(files, name = 'layer') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-hd-'));
  made.push(root);
  const dir = path.join(root, name, '.bowerloom');
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const at = path.join(dir, rel);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, content);
  }
  return dir;
}

export function cleanup() {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
}

export function codes(result) {
  return result.ok ? [] : result.problems.map(p => p.code);
}
