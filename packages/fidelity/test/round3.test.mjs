// Verification review of 3b9dec8..b12da40: items W1 to W11 (W8 is in oracle.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KNOWN_ESCAPES, engineDecision, escapesOf, neutralDecision, opaqueForms, programWord, splitCommand, stripWrappers,
  translateGuardrails,
} from '../../../dist/packages/fidelity/src/index.js';
import { explains, rule, sandbox } from './fixture.mjs';

const lineOf = (t, id) => t.lines.find(l => l.entry === id);
const shell = command => ({ action: 'shell', command });
const RM = [rule('d', 'shell', 'rm *', 'deny'), rule('a', 'shell', '*', 'allow')];

// ---- W1: here-strings ------------------------------------------------------------------------------------------------

test('W1: a here-string is one operator and does not swallow the next lines', () => {
  assert.deepEqual(splitCommand('cat <<<a\nrm x'), ['cat <<<a', 'rm x']);
  assert.deepEqual(splitCommand('cat <<< a\nrm x'), ['cat <<< a', 'rm x']);
  assert.deepEqual(splitCommand('cat <<<a\nrm x\na\nrm y'), ['cat <<<a', 'rm x', 'a', 'rm y']);
  for (const c of ['cat <<<a\nrm x', 'cat <<< a\nrm x', 'cat <<<a\nrm x\na\nrm y']) assert.equal(neutralDecision(RM, shell(c)), 'deny', JSON.stringify(c));
});

/**
 * A differential test against real bash, built from the reviewer's fuzz2.mjs: a seeded generator makes command lines
 * around a harmless function `zz`. When the model neither marks a line opaque nor sees `zz` as a program word, bash
 * must not run `zz` either. Bounded: a fixed seed and count, in a temporary folder, with a minimal PATH.
 */
const BASH = '/bin/bash';
test('W1: the splitter never hides a command that bash runs (seeded differential against bash)', fs.existsSync(BASH) ? {} : { skip: `${BASH} is missing, so there is no bash to compare with.` }, () => {
  let seed = 20261028;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const toks = ['zz', 'zz', 'zz', 'echo', 'a', 'b', ' ', ' ', ' ', ';', '&&', '||', '|', '&', '\n', '\n', '\n', "'", '"', '\\', '$(', ')', '(', '`', '{', '}', '<<<', '<<<a', '<<< a', '<(', '>(', '>/dev/null', '2>&1', '<&-', '>&2', '&>/dev/null', 'time', 'command', 'nohup', 'X=1', 'for i in 1 2', 'do', 'done', 'while false', 'true', ':', '${a:-', '}', '$', '\\\n', '[[ a ]]', '-p', '--', 'x', 'builtin', '!', 'if true', 'then', 'fi', ';;', '|&', '>|f', '$[', ']', '${#a}', '$#', '$?', '$@', 'a=(', '(( 1 ))', '\\\\', '\\ ', "\\'", '\\"'];
  const fixed = ['cat <<<a\nzz', 'cat <<< a\nzz', 'cat <<<a\nzz\na\nzz', 'cat <<EOF\nx\nEOF\nzz', 'echo a\\\\\nzz', "'zz'", '"zz"', '\\zz'];
  const lines = [...fixed];
  for (let n = 0; n < 20000; n++) {
    const len = 2 + Math.floor(rnd() * 14);
    let s = '';
    for (let i = 0; i < len; i++) s += toks[Math.floor(rnd() * toks.length)];
    if (s.includes('zz')) lines.push(s);
  }
  const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bowerloom-bash-'));
  const missed = [];
  let ran = 0;
  try {
    for (const s of lines) {
      if (opaqueForms(s).length > 0) continue;
      if (splitCommand(s).some(p => programWord(p) === 'zz')) continue;
      ran++;
      const r = spawnSync(BASH, ['--norc', '--noprofile', '-c', `zz(){ echo ZZRAN; }\n${s}`], { cwd, input: '', encoding: 'utf8', timeout: 3000, env: { PATH: '/usr/bin:/bin' } });
      if ((r.stdout ?? '').includes('ZZRAN')) missed.push(s);
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  assert.ok(ran > 200, `only ${ran} lines reached bash`);
  assert.deepEqual(missed, []);
});

// ---- W2: wrapper options ------------------------------------------------------------------------------------------------

test('W2: a wrapper option outside the tables, --, combined short options, or a non-literal program is opaque', () => {
  for (const c of ['command -- rm x', 'command -p -- rm x', 'timeout -vk 1 5 rm x', 'nohup -- rm x', 'xargs -tn1 rm', 'xargs -n1 $C', 'xargs --bogus rm', 'nice -z rm x', 'timeout -- 5 rm x', 'builtin -x rm']) {
    assert.ok(opaqueForms(c).includes('wrapper-option'), `${JSON.stringify(c)} -> ${opaqueForms(c)}`);
    assert.notEqual(neutralDecision(RM, shell(c)), 'allow', c);
  }
});

test('W2: the tables hold the macOS xargs options and the long forms', () => {
  assert.equal(stripWrappers('xargs -J % rm %'), 'rm %');
  assert.equal(stripWrappers('xargs -R 2 -S 255 -I x rm x'), 'rm x');
  assert.equal(stripWrappers('xargs --max-args 1 rm'), 'rm');
  assert.equal(stripWrappers('xargs --max-args=1 --null rm'), 'rm');
  assert.equal(stripWrappers('xargs --delimiter , rm'), 'rm');
  assert.equal(stripWrappers('timeout --foreground -s KILL 5 rm x'), 'rm x');
  assert.equal(stripWrappers('nice --adjustment=5 rm x'), 'rm x');
  assert.equal(neutralDecision(RM, shell('echo x | xargs -J % rm %')), 'deny');
  assert.deepEqual(opaqueForms('xargs -n 1 -P 4 rm'), []);
});

// ---- W3: shells that read commands ------------------------------------------------------------------------------------

test('W3: a part whose program is a shell, source, or . is opaque', () => {
  for (const c of ['echo r | nice sh', 'echo r | (sh)', 'echo r | { sh; }', 'bash <<<"rm x"', 'bash < <(echo rm)', 'sh < file', 'source <(echo rm)', '. ./x.sh', 'sh -c "rm x"', 'echo r | /usr/bin/env bash']) {
    assert.ok(opaqueForms(c).includes('shell-input'), `${JSON.stringify(c)} -> ${opaqueForms(c)}`);
    assert.notEqual(neutralDecision(RM, shell(c)), 'allow', c);
  }
  assert.equal(neutralDecision(RM, shell('bash <<<"rm x"')), 'ask');
});

// ---- W4: words built at run time in the words a rule names ----------------------------------------------------------------

test('W4: a $, backtick, {, *, ?, [ or ~ in the words a deny names makes the line opaque for that program', () => {
  const rules = [rule('d', 'shell', 'git push *', 'deny'), rule('a', 'shell', '*', 'allow')];
  for (const c of ['git $(echo push) o main', 'git ${P:-push} o', 'git pu$X o', 'git push{,} o', 'git pus[h] o', 'git pu* o', 'git $P o', 'git `echo push` o', 'git ~ o', 'git pus? o']) {
    assert.equal(neutralDecision(rules, shell(c)), 'ask', c);
  }
  assert.equal(neutralDecision(rules, shell('git status $X')), 'allow', 'the words the rule names are plain');
  assert.equal(neutralDecision(rules, shell('ls $X')), 'allow', 'another program');
  assert.deepEqual(escapesOf('claude-code', shell('git $P o'), rules), ['runtime-word']);
  assert.match(KNOWN_ESCAPES['runtime-word'].text, /git \$\(echo push\)/);
  for (const c of ["trap 'rm x' EXIT", 'source ./x.sh', '. ./x.sh']) assert.notEqual(neutralDecision(RM, shell(c)), 'allow', c);
});

// ---- W5: no upgrade from a sandbox without scope ----------------------------------------------------------------------

test('W5: a sandbox does not upgrade a Claude Code path or web deny, or a Codex shell deny; the note names it', () => {
  const box = [sandbox()];
  const cc = translateGuardrails('claude-code', { rules: [rule('env', 'read', '.env', 'deny'), rule('w', 'web', 'evil.example', 'deny')], sandbox: box });
  assert.equal(lineOf(cc, 'env').result, 'translated');
  assert.match(lineOf(cc, 'env').reason, /sandbox box may cover it/);
  assert.match(lineOf(cc, 'env').reason, /step 5/);
  const cx = translateGuardrails('codex', { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: box });
  assert.equal(lineOf(cx, 'd').result, 'weakened');
  assert.match(lineOf(cx, 'd').reason, /sandbox box may cover it/);
});

// ---- W6: the vectors are the authority ------------------------------------------------------------------------------------

test('W6: each Claude Code deny line cites its vector; a form with no documented vector is weakened', () => {
  const rules = [
    rule('sh', 'shell', 'rm *', 'deny'), rule('rd', 'read', '.env', 'deny'), rule('ed', 'edit', 'docs/**', 'deny'),
    rule('mc', 'mcp', 'gh', 'deny'), rule('ma', 'mcp', '*', 'deny'), rule('ag', 'subagent', 'deployer', 'deny'),
    rule('sk', 'skill', 'release', 'deny'), rule('wb', 'web', 'evil.example', 'deny'), rule('wa', 'web', '*', 'deny'),
  ];
  const t = translateGuardrails('claude-code', { rules, sandbox: [] });
  assert.match(lineOf(t, 'sh').reason, /vector CC0?\d+/);
  assert.match(lineOf(t, 'rd').reason, /vector CC21/);
  assert.match(lineOf(t, 'ed').reason, /vector CC20/);
  assert.match(lineOf(t, 'mc').reason, /vector CC27/);
  for (const id of ['ma', 'ag', 'sk', 'wb', 'wa']) {
    assert.equal(lineOf(t, id).result, 'weakened', id);
    assert.match(lineOf(t, id).reason, /no documented vector/, id);
    assert.match(lineOf(t, id).reason, /step 5/, id);
  }
  assert.equal(lineOf(translateGuardrails('claude-code', { rules: [rule('ok', 'skill', 'notes', 'allow')], sandbox: [] }), 'ok').result, 'exact', 'an allow is not affected');
});

// ---- W7: program word case ------------------------------------------------------------------------------------------------

test('W7: a deny or ask compares the program word in any letter case', () => {
  for (const c of ['RM -rf x', 'Rm x', 'echo a; RM x']) assert.equal(neutralDecision(RM, shell(c)), 'deny', c);
  assert.equal(neutralDecision(RM, shell('eval RM x')), 'ask');
  assert.equal(neutralDecision(RM, shell('echo RM')), 'allow');
  assert.deepEqual(escapesOf('claude-code', shell('RM x'), RM), ['program-case']);
});

// ---- W9: programs that run another command ----------------------------------------------------------------------------------

test('W9: a program that runs another command is opaque, and the escape text says so in general', () => {
  for (const c of ['busybox rm x', 'setsid rm x', 'ionice rm x', 'flock /tmp/l rm x', 'watch rm x', 'chroot / rm x', 'script -c "rm x" /dev/null', 'ssh h rm x', 'strace rm x', 'parallel rm ::: x', 'doas rm x', 'su -c "rm x"', 'sudo rm x', 'env rm x', 'find . -exec rm {} +']) {
    assert.ok(opaqueForms(c).includes('runner'), `${JSON.stringify(c)} -> ${opaqueForms(c)}`);
    assert.equal(neutralDecision(RM, shell(c)), 'ask', c);
  }
  assert.match(KNOWN_ESCAPES.runner.text, /runs another command/);
  assert.deepEqual(escapesOf('opencode', shell('sudo rm x'), RM), ['sudo'], 'the most specific listed escape');
  assert.deepEqual(escapesOf('opencode', shell('setsid rm x'), RM), ['runner']);
});

// ---- W10: paths and hosts --------------------------------------------------------------------------------------------------

test('W10: a deny or ask asks when a request path cannot be resolved inside the project', () => {
  const rules = [rule('env', 'read', '.env', 'deny'), rule('src', 'read', 'src/**', 'allow')];
  for (const p of ['/etc/passwd', '../x', 'a/../../.env', '~/x']) assert.equal(neutralDecision(rules, { action: 'read', path: p }), 'ask', p);
  assert.equal(neutralDecision([rules[1]], { action: 'read', path: '/etc/passwd' }), 'default', 'an allow alone does not fail closed');
  assert.equal(neutralDecision([rule('e', 'edit', 'docs/**', 'deny')], { action: 'write', path: '/tmp/x' }), 'ask');
});

test('W10: hosts drop userinfo, a port, and a trailing dot, in the pattern and the request', () => {
  const deny = rule('d', 'web', 'evil.example', 'deny');
  for (const host of ['user@evil.example:8080', 'EVIL.example.:443', 'a.evil.example:80']) assert.equal(neutralDecision([deny], { action: 'web', host }), 'deny', host);
  assert.equal(neutralDecision([rule('d', 'web', 'evil.example.', 'deny')], { action: 'web', host: 'evil.example' }), 'deny');
});

// ---- W11: explaining a looser decision ----------------------------------------------------------------------------------

test('W11: a looser decision is explained by an escape only when the line lists it and the request uses it', () => {
  const line = { result: 'translated', reason: `x ${KNOWN_ESCAPES.wrapper.text}` };
  assert.equal(explains(line, ['wrapper']), true);
  assert.equal(explains(line, []), false, 'the request uses no escape');
  assert.equal(explains(line, ['wrapper', 'assignment']), false, 'an escape the request uses is not listed');
  assert.equal(explains({ result: 'translated', reason: 'x' }, ['wrapper']), false);
  assert.equal(explains({ result: 'weakened', reason: 'x' }, []), true);
});
