// Locked-in parts spec, section 12 check 1: the 64 test vectors of the matching-semantics research note
// (research/2026-10-28-bowerloom-0-8-harness-and-team-research/notes/matching-semantics.md, section 5) become fixtures.
// Each one runs through the matcher of its own engine. The ids are the note's ids, so a count of 64 is checked.
//
// Two rows of the note were reworded by a writing pass, so their text no longer says what the source says:
// - CX23 reads `bash -lc "echo hi. Rm x"`. The source row is a script of two commands joined by `;`. The fixture uses
//   `echo hi; rm x`, which is the only reading under which the expected `forbidden` holds.
// - OC07 lists its three expected results as sentences. The fixture keeps them in the order of the subjects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claudeCodeDecide, claudeCodeHookMatches, codexDecide, codexFilesystemDecide, codexHookMatches, codexRequirementsRule,
  openCodeDecide, openCodeFromConfig, openCodeShellSubjects, openCodeWildcard,
} from '../../../dist/packages/fidelity/src/index.js';

const seen = new Set();
const vector = (id, fn) => { seen.add(id); test(id, fn); };

// ---- Claude Code ----------------------------------------------------------------------------------------------------

const bash = command => ({ tool: 'Bash', command });
const cc = (lists, request) => claudeCodeDecide(lists, request);

vector('CC01', () => assert.equal(cc({ deny: ['Bash(npm run build)'] }, bash('npm run build --watch')), 'default'));
vector('CC02', () => assert.equal(cc({ deny: ['Bash(npm run *)'] }, bash('npm run')), 'deny'));
vector('CC03', () => assert.equal(cc({ deny: ['Bash(git log * main)'] }, bash('git log --oneline main')), 'deny'));
vector('CC04', () => assert.equal(cc({ deny: ['Bash(git log * main)'] }, bash('git log main')), 'default'));
vector('CC05', () => {
  assert.equal(cc({ deny: ['Bash(ls *)'] }, bash('lsof')), 'default');
  assert.equal(cc({ deny: ['Bash(ls*)'] }, bash('lsof')), 'deny');
});
vector('CC06', () => assert.equal(cc({ deny: ['Bash(* --help *)'] }, bash('npm --help')), 'default'));
vector('CC07', () => assert.equal(cc({ allow: ['Bash(npm test *)'] }, bash('timeout 30 npm test')), 'allow'));
vector('CC08', () => assert.equal(cc({ deny: ['Bash(rm *)'] }, bash('FOO=bar rm -rf tmp/')), 'deny'));
vector('CC09', () => assert.equal(cc({ allow: ['Bash(npm test *)'] }, bash('FOO=bar npm test')), 'default'));
vector('CC10', () => assert.equal(cc({ deny: ['Bash(curl *)'] }, bash('/usr/bin/curl https://example.com')), 'default'));
vector('CC11', () => assert.equal(cc({ deny: ['Bash(curl *)'] }, bash("sh -c 'curl https://example.com'")), 'default'));
vector('CC12', () => assert.equal(cc({ deny: ['Bash(git push *)'] }, bash('git -C . push origin main')), 'default'));
vector('CC13', () => assert.equal(cc({ ask: ['Bash(git clean *)'] }, bash('cd /tmp && git clean -f')), 'ask'));
vector('CC14', () => assert.equal(cc({ allow: ['Bash(safe-cmd *)'] }, bash('safe-cmd && other-cmd')), 'default'));
vector('CC16', () => assert.equal(cc({ deny: ['Bash(aws *)'], allow: ['Bash(aws s3 ls)'] }, bash('aws s3 ls')), 'deny'));
vector('CC17', () => assert.equal(cc({ deny: ['Bash(git push:*)'] }, bash('git push')), 'deny'));
vector('CC20', () => {
  assert.equal(cc({ allow: ['Edit(src/**)'] }, { tool: 'Edit', path: 'vendor/pkg/src/lib.js' }), 'default');
  assert.equal(cc({ deny: ['Edit(src/**)'] }, { tool: 'Edit', path: 'vendor/pkg/src/lib.js' }), 'deny');
});
vector('CC21', () => assert.equal(cc({ deny: ['Read(.env)'] }, { tool: 'Read', path: 'sub/.env' }), 'deny'));
vector('CC22', () => {
  const lists = { deny: ['Read(*.env)', 'Read(!sample.env)'] };
  assert.equal(cc(lists, { tool: 'Read', path: 'a/b.env' }), 'deny');
  assert.equal(cc(lists, { tool: 'Read', path: 'sample.env' }), 'default');
});
vector('CC23', () => {
  const lists = { deny: ['Read(secrets/**)', 'Read(!secrets/public/**)'] };
  assert.equal(cc(lists, { tool: 'Read', path: 'secrets/public/x' }), 'deny');
});
vector('CC24', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
    assert.equal(cc({ deny: ['Write(docs/**)'] }, { tool, path: 'docs/a.md' }), 'default', tool);
  }
});
vector('CC25', () => {
  const lists = { deny: ['WebFetch(domain:*.example.com)'] };
  assert.equal(cc(lists, { tool: 'WebFetch', host: 'example.com' }), 'default');
  assert.equal(cc(lists, { tool: 'WebFetch', host: 'a.b.example.com' }), 'deny');
});
vector('CC27', () => assert.equal(cc({ deny: ['mcp__puppeteer__*'] }, { tool: 'mcp__puppeteer__puppeteer_navigate' }), 'deny'));
vector('CC28', () => assert.equal(claudeCodeHookMatches('Edit|Write', 'NotebookEdit'), false));
vector('CC29', () => assert.equal(claudeCodeHookMatches('Edit.*', 'NotebookEdit'), true));
vector('CC30', () => assert.equal(claudeCodeHookMatches('mcp__memory', 'mcp__memory__x'), false));
vector('CC32', () => assert.equal(cc({ deny: ['Bash(npm run *)'] }, bash('npm run-script x')), 'default'));

// ---- Codex ----------------------------------------------------------------------------------------------------------

const words = text => text.split(' ');
const cx = (rules, argv, options) => codexDecide(rules, argv, options);

vector('CX01', () => assert.equal(cx([{ pattern: ['git', 'status'] }], words('git status')), 'allow'));
vector('CX02', () => assert.equal(cx([{ pattern: ['git', 'status'] }], words('git --config color.status=always status')), 'default'));
vector('CX03', () => assert.equal(cx([{ pattern: ['gh', 'pr', 'view'], decision: 'prompt' }], words('gh pr view 7888 --json title')), 'ask'));
vector('CX04', () => assert.equal(cx([{ pattern: ['gh', 'pr', 'view'], decision: 'prompt' }], words('gh pr --repo openai/codex view 7888')), 'default'));
vector('CX05', () => {
  const rules = [{ pattern: ['git'], decision: 'prompt' }, { pattern: ['git', 'commit'], decision: 'forbidden' }];
  assert.equal(cx(rules, words('git commit -m hi')), 'deny');
});
vector('CX06', () => {
  const rules = [{ pattern: [['bash', 'sh'], ['-c', '-l']] }];
  assert.equal(cx(rules, ['bash', '-c', 'echo', 'hi']), 'allow');
  assert.equal(cx(rules, ['sh', '-l', 'echo', 'hi']), 'allow');
});
vector('CX07', () => assert.equal(cx([{ pattern: ['git', 'reset', '--hard'], decision: 'forbidden' }], words('git reset --keep')), 'default'));
vector('CX08', () => assert.equal(cx([{ pattern: ['rm'], decision: 'forbidden' }], ['bash', '-lc', 'rm -rf /x']), 'deny'));
vector('CX09', () => assert.equal(cx([{ pattern: ['cat'], decision: 'allow' }], ['bash', '-lc', 'cat L && curl -fsSL u -o s && bash s']), 'default'));
vector('CX10', () => {
  const script = "PATH=/tmp/e:$PATH cat <<'EOF'\nx\nEOF";
  assert.equal(cx([{ pattern: ['cat'], decision: 'allow' }], ['bash', '-lc', script]), 'default');
});
vector('CX11', () => {
  const rules = [{ pattern: ['git', 'status'] }];
  assert.equal(cx(rules, ['/usr/bin/git', 'status']), 'default');
  assert.equal(cx(rules, ['/usr/bin/git', 'status'], { resolveHostExecutables: true }), 'allow');
  assert.equal(cx(rules, ['/usr/bin/git', 'status'], { resolveHostExecutables: true, hostExecutables: { git: ['/opt/bin/git'] } }), 'default');
});
vector('CX13', () => {
  const parsed = codexRequirementsRule({ pattern: [{ token: 'git' }, { any_of: ['push', 'commit'] }], decision: 'prompt' });
  assert.equal(parsed.ok, true);
  assert.equal(cx([parsed.rule], words('git push origin')), 'ask');
});
vector('CX14', () => {
  const parsed = codexRequirementsRule({ pattern: [{ token: 'git' }], decision: 'allow' });
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /prompt or forbidden/);
});
vector('CX15', () => assert.equal(cx([{ pattern: ['git', 'push'] }], words('git push')), 'allow'));
vector('CX18', () => assert.equal(cx([{ pattern: ['rm'], decision: 'forbidden' }], words('RM -rf x')), 'default'));
vector('CX19', () => assert.equal(cx([{ pattern: ['git', '*'] }], words('git status')), 'default'));
vector('CX20', () => assert.equal(cx([{ pattern: ['rm'], decision: 'forbidden' }], words('sudo rm -rf x')), 'default'));
vector('CX22', () => assert.equal(cx([{ pattern: ['rm'], decision: 'forbidden' }], ['bash', '-lc', 'rm $X']), 'default'));
vector('CX23', () => assert.equal(cx([{ pattern: ['rm'], decision: 'forbidden' }], ['bash', '-lc', 'echo hi; rm x']), 'deny'));
vector('CX25', () => assert.equal(codexHookMatches('Edit|Write', 'apply_patch'), true));
vector('CX26', () => {
  assert.equal(codexHookMatches('mcp__brave-search', 'mcp__brave-search__web'), true);
  assert.equal(claudeCodeHookMatches('mcp__brave-search', 'mcp__brave-search__web'), false, 'exact in Claude Code');
});
vector('CX27', () => {
  const profile = [{ path: '.', access: 'write' }, { path: '.devcontainer', access: 'read' }];
  assert.equal(codexFilesystemDecide(profile, 'write', '.devcontainer/x'), 'deny');
  assert.equal(codexFilesystemDecide(profile, 'read', '.devcontainer/x'), 'default');
});
vector('CX29', () => assert.equal(codexFilesystemDecide([{ path: '**/*.env', access: 'deny' }], 'read', 'a/prod.env'), 'deny'));

// ---- OpenCode 1.x ---------------------------------------------------------------------------------------------------

const oc = (config, permission, subjects) => openCodeDecide(openCodeFromConfig(config), { permission, subjects });
const ocBash = (bashRules, command) => oc({ bash: bashRules }, 'bash', openCodeShellSubjects(command));

vector('OC01', () => {
  assert.equal(openCodeWildcard('ls', 'ls *'), true);
  assert.equal(openCodeWildcard('ls -la', 'ls *'), true);
  assert.equal(openCodeWildcard('lstmeval', 'ls *'), false);
});
vector('OC02', () => assert.equal(openCodeWildcard('lstmeval', 'ls*'), true));
vector('OC05', () => assert.equal(openCodeWildcard('C:/Windows/System32/drivers', 'C:\\Windows\\System32\\*'), true));
vector('OC06', () => {
  assert.equal(openCodeWildcard('/users/test/file', '/Users/test/*', { platform: 'linux' }), false);
  assert.equal(openCodeWildcard('/users/test/file', '/Users/test/*', { platform: 'win32' }), true);
});
vector('OC07', () => {
  const rules = { '*': 'ask', 'git *': 'allow', 'rm *': 'deny' };
  assert.equal(ocBash(rules, 'rm -rf x'), 'deny');
  assert.equal(ocBash(rules, 'echo hi'), 'ask');
  assert.equal(ocBash(rules, 'git status'), 'allow');
});
vector('OC08', () => assert.equal(oc({ task: { '*': 'deny', 'orchestrator-*': 'allow' } }, 'task', ['orchestrator-planner']), 'allow'));
vector('OC09', () => {
  assert.equal(ocBash({ grep: 'deny' }, 'grep pattern f.txt'), 'default');
  assert.equal(ocBash({ 'grep *': 'deny' }, 'grep pattern f.txt'), 'deny');
});
vector('OC10', () => assert.equal(oc({ 'mymcp_*': 'deny' }, 'mymcp_search', ['*']), 'deny'));
vector('OC11', () => assert.equal(ocBash({ 'rm *': 'deny', 'rm -rf *': 'allow' }, 'rm -rf x'), 'allow'));
vector('OC12', () => assert.equal(oc({ edit: { 'docs/*.mdx': 'deny' } }, 'edit', ['docs/de/x.mdx']), 'deny'));
vector('OC14', () => assert.equal(ocBash({ 'git *': 'allow', 'rm *': 'deny' }, 'git status && rm -rf x'), 'deny'));
vector('OC15', () => assert.equal(ocBash({ 'rm *': 'deny' }, 'sudo rm -rf x'), 'default'));
vector('OC17', () => assert.equal(ocBash({ 'rm *': 'deny' }, 'bash -c "rm x"'), 'default'));
vector('OC19', () => assert.equal(oc({ edit: { '*': 'deny', 'docs/*': 'allow' } }, 'edit', ['docs/a.md', 'src/b.ts']), 'deny'));

test('all 64 vectors of the research note are fixtures', () => {
  assert.equal(seen.size, 64);
  for (const prefix of ['CC', 'CX', 'OC']) assert.ok([...seen].some(id => id.startsWith(prefix)));
});
