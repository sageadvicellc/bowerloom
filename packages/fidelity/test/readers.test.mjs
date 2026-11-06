// The readers under the matchers: command splitting, wrapper and assignment stripping, the Codex script split, path
// patterns, and the per-engine pattern conversions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codexPrefix, codexScriptCommands, openCodePathPatterns, pathMatches, pathPatternProblem, patternProblem, splitCommand,
  stripAssignments, stripWrappers, translateGuardrails,
} from '../../../dist/packages/fidelity/src/index.js';
import { rule } from './fixture.mjs';

test('splitCommand splits at operators outside quotes and adds nested commands', () => {
  assert.deepEqual(splitCommand('a && b || c; d | e |& f & g'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(splitCommand('echo "a && b" \'c; d\''), ['echo "a && b" \'c; d\'']);
  assert.deepEqual(splitCommand('echo $(rm x && curl u) end'), ['echo $(rm x && curl u) end', 'rm x', 'curl u']);
  assert.deepEqual(splitCommand('echo `rm x`'), ['echo `rm x`', 'rm x']);
  assert.deepEqual(splitCommand('diff <(sort a) <(sort b)'), ['diff <(sort a) <(sort b)', 'sort a', 'sort b']);
  assert.deepEqual(splitCommand('echo "$(rm x)"'), ['echo "$(rm x)"', 'rm x']);
  assert.deepEqual(splitCommand('(cd x && rm y)'), ['cd x', 'rm y']);
  assert.deepEqual(splitCommand('if true; then rm x; else rm -i y; fi'), ['true', 'rm x', 'rm -i y']);
  assert.deepEqual(splitCommand('for f in a b; do rm $f; done'), ['rm $f']);
  assert.deepEqual(splitCommand('ls 2>&1 >out'), ['ls 2>&1 >out']);
  assert.deepEqual(splitCommand('a \\\n&& b'), ['a', 'b'], 'a backslash-newline joins');
  assert.deepEqual(splitCommand(''), []);
});

test('splitCommand skips a here-document body and keeps a here-string', () => {
  assert.deepEqual(splitCommand("cat <<'EOF'\nrm -rf /\nEOF\nrm x"), ["cat <<'EOF'", 'rm x']);
  assert.deepEqual(splitCommand('cat <<< "a; b"'), ['cat <<< "a; b"']);
  assert.deepEqual(splitCommand('cat <<EOF'), ['cat <<EOF']);
});

test('stripWrappers removes the wrappers Claude Code strips, with their options', () => {
  assert.equal(stripWrappers('timeout 30 npm test'), 'npm test');
  assert.equal(stripWrappers('timeout -s KILL 5 rm x'), 'rm x');
  assert.equal(stripWrappers('nice -n 5 nohup rm x'), 'rm x');
  assert.equal(stripWrappers('stdbuf -oL time -p make'), 'make');
  assert.equal(stripWrappers('xargs rm'), 'rm');
  assert.equal(stripWrappers('xargs -I {} rm {}'), 'rm {}', 'ruling R4: options are stripped before a literal program');
  assert.equal(stripWrappers('xargs -I {} rm {}', { options: false }), 'xargs -I {} rm {}', 'Claude Code strips bare xargs only');
  assert.equal(stripWrappers('command -v rm'), 'command -v rm');
  assert.equal(stripWrappers('nohup'), 'nohup');
  assert.equal(stripWrappers('sudo rm x'), 'sudo rm x');
});

test('stripAssignments removes leading NAME=value words only', () => {
  assert.equal(stripAssignments('FOO=bar A_1=x rm -rf tmp/'), 'rm -rf tmp/');
  assert.equal(stripAssignments('rm FOO=bar'), 'rm FOO=bar');
  assert.equal(stripAssignments('FOO=bar'), 'FOO=bar');
});

test('codexScriptCommands splits plain-word scripts only', () => {
  assert.deepEqual(codexScriptCommands('git status && rm -rf x'), [['git', 'status'], ['rm', '-rf', 'x']]);
  assert.deepEqual(codexScriptCommands('git commit -m "a b"'), [['git', 'commit', '-m', 'a b']]);
  for (const script of ['rm $X', 'echo $(rm x)', 'ls > out', 'FOO=1 rm x', 'if true; then rm x; fi', 'rm *.tmp', 'a &&', 'a & b', 'echo "$HOME"', "echo 'x"]) {
    assert.equal(codexScriptCommands(script), null, script);
  }
});

test('codexPrefix keeps the longest literal prefix and says when it covers more', () => {
  assert.deepEqual(codexPrefix('git push * main'), { tokens: ['git', 'push'], same: false });
  assert.deepEqual(codexPrefix('git push *'), { tokens: ['git', 'push'], same: true });
  assert.deepEqual(codexPrefix('npm run:*'), { tokens: ['npm', 'run'], same: true });
  assert.deepEqual(codexPrefix('git push'), { tokens: ['git', 'push'], same: false });
  assert.deepEqual(codexPrefix('git pu*'), { tokens: ['git'], same: false });
  assert.deepEqual(codexPrefix('echo $HOME *'), { tokens: ['echo'], same: false });
  assert.equal(codexPrefix('* --version'), null);
  assert.equal(codexPrefix('"quoted" x'), null);
});

test('path patterns follow the neutral depth rules', () => {
  assert.equal(pathMatches('.env', 'a/b/.env', 'anchored'), true, 'a bare name matches at any depth');
  assert.equal(pathMatches('src/**', 'vendor/src/a', 'anchored'), false);
  assert.equal(pathMatches('src/**', 'vendor/src/a', 'any-depth'), true);
  assert.equal(pathMatches('src/**', 'src', 'anchored'), false, 'src/** names what is inside src');
  assert.equal(pathMatches('docs/*.md', 'docs/a/b.md', 'anchored'), false, '* stays in one folder');
  assert.equal(pathMatches('docs/*', 'docs/a/b.md', 'anchored'), true, 'a matched folder covers what is below it');
  assert.equal(pathMatches('a/**/b', 'a/b', 'anchored'), true);
  assert.equal(pathMatches('a/**/b', 'a/x/y/b/c', 'anchored'), true);
  assert.equal(pathMatches('build/', 'build', 'anchored'), false);
  assert.equal(pathMatches('build/', 'build/x', 'anchored'), true);
  assert.equal(pathMatches('./x', 'y/x', 'any-depth'), false, './ pins a pattern to the root');
  for (const p of ['/etc/x', '~/x', '!x', 'a/../b', 'a?', 'a[b]', '{a,b}', '', 'a//b', './']) assert.notEqual(pathPatternProblem(p), null, p);
  assert.equal(pathPatternProblem('./src/**'), null);
});

test('patternProblem checks each action language', () => {
  assert.equal(patternProblem(rule('a', 'mcp', 'gh/get_*', 'deny')), null);
  assert.equal(patternProblem(rule('a', 'mcp', '*', 'deny')), null);
  assert.notEqual(patternProblem(rule('a', 'mcp', '*/x', 'deny')), null);
  assert.notEqual(patternProblem(rule('a', 'mcp', 'gh/', 'deny')), null);
  assert.notEqual(patternProblem(rule('a', 'web', 'https://x', 'deny')), null);
  assert.notEqual(patternProblem(rule('a', 'skill', 'a b', 'deny')), null);
  assert.notEqual(patternProblem(rule('a', 'shell', '  ', 'deny')), null);
});

test('openCodePathPatterns covers what the neutral pattern covers', () => {
  assert.deepEqual(openCodePathPatterns('src/**', 'allow'), { patterns: ['src/*'], wider: false });
  assert.deepEqual(openCodePathPatterns('src/**', 'deny'), { patterns: ['src/*', '*/src/*'], wider: false });
  assert.deepEqual(openCodePathPatterns('.env', 'allow'), { patterns: ['.env', '*/.env', '.env/*', '*/.env/*'], wider: false });
  assert.deepEqual(openCodePathPatterns('a/**/b', 'allow'), { patterns: ['a/b', 'a/b/*', 'a/*/b', 'a/*/b/*'], wider: false });
  assert.equal(openCodePathPatterns('docs/*.md', 'deny').wider, true);
  assert.deepEqual(openCodePathPatterns('build/', 'allow'), { patterns: ['build/*', '*/build/*'], wider: false });
});

test('Codex keeps a read-only entry below a literal deny from reopening reads', () => {
  const t = translateGuardrails('codex', { rules: [rule('r', 'read', 'docs/**', 'deny'), rule('e', 'edit', 'docs/a/**', 'deny')], sandbox: [] });
  assert.deepEqual(t.form.filesystem.filter(e => !e.path.includes('*')), [{ path: 'docs', access: 'deny' }, { path: 'docs/a', access: 'deny' }]);
});

test('private blocks reach only their own engine', () => {
  const r = rule('d', 'shell', 'rm *', 'deny', { privateBlocks: { codex: { justification: 'kept' } } });
  assert.deepEqual(translateGuardrails('codex', { rules: [r], sandbox: [] }).privateBlocks, { d: { justification: 'kept' } });
  assert.deepEqual(translateGuardrails('claude-code', { rules: [r], sandbox: [] }).privateBlocks, {});
  const absent = rule('v', 'shell', '* --version', 'deny', { privateBlocks: { codex: { k: 1 } } });
  const t = translateGuardrails('codex', { rules: [absent], sandbox: [] });
  assert.deepEqual(t.privateBlocks, {}, 'an absent entry carries nothing');
  assert.deepEqual(t.excludedPrivateBlocks.map(e => e.entry), ['v']);
});

test('an engine filter keeps a rule out of the other engines', () => {
  const r = rule('only-cc', 'shell', 'rm *', 'deny', { engines: ['claude-code'] });
  assert.equal(translateGuardrails('codex', { rules: [r], sandbox: [] }).lines.length, 0);
  assert.equal(translateGuardrails('claude-code', { rules: [r], sandbox: [] }).lines.length, 1);
});
