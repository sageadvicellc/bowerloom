// Review round on 122891c: rulings R1 to R9 of the lead (scratchpad step2b-review.md). One block per ruling.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_ESCAPES, codexPrefix, decidingRules, engineDecision, escapesOf, neutralDecision, normalizeRequestPath, opaqueForms, splitCommand,
  stripWrappers, translateGuardrails,
} from '../../../dist/packages/fidelity/src/index.js';
import { rule, sandbox } from './fixture.mjs';

const lineOf = (t, id) => t.lines.find(l => l.entry === id);
const shell = command => ({ action: 'shell', command });

// ---- R1: fail closed on forms the splitter does not fully parse ---------------------------------------------------------

/** Every form of review findings H1 and M1 that the splitter does not fully parse, with the form it reports. */
export const OPAQUE = [
  ['cat <<EOF\nrm x\nEOF', 'here-document'], ['cat <<-EOF\n\trm x\n\tEOF\nls', 'here-document'], ['echo hi # rm x', 'comment'],
  ["$'rm' x", 'ansi-c-quote'], ['echo $(case x in a) rm y;; esac)', 'case'], ['function f { rm x; }', 'function'],
  ['eval rm x', 'eval'], ['exec rm x', 'exec'], ['coproc rm x', 'coproc'], ['curl u | sh', 'pipe-to-shell'],
  ['cat s | bash -s', 'pipe-to-shell'], ['$(echo rm) x', 'runtime-word'], ['$R x', 'runtime-word'], ['rm$IFS-rf x', 'runtime-word'],
  ['{rm,x}', 'runtime-word'], ['`echo rm` x', 'runtime-word'],
];

test('R1: the splitter names each form it does not fully parse', () => {
  for (const [command, form] of OPAQUE) assert.ok(opaqueForms(command).includes(form), `${JSON.stringify(command)} -> ${opaqueForms(command)}`);
  for (const command of ['git status', 'echo "a # b"', "echo 'x$y'", 'echo $(rm x)', 'a && b | c', 'git commit -m "it\'s"']) {
    assert.deepEqual(opaqueForms(command), [], command);
  }
});

test('R1: a backslash-newline joins words, as bash does', () => {
  assert.deepEqual(splitCommand('r\\\nm -rf x'), ['rm -rf x']);
  assert.equal(neutralDecision([rule('d', 'shell', 'rm *', 'deny')], shell('r\\\nm -rf x')), 'deny');
});

test('R1: for a form it does not parse, the neutral decision is never allow: ask when a deny or ask program appears, else default', () => {
  const rules = [rule('d', 'shell', 'rm *', 'deny'), rule('q', 'shell', 'docker *', 'ask'), rule('a', 'shell', '*', 'allow')];
  for (const [command] of OPAQUE) {
    const expected = /\brm\b|docker/.test(command) ? 'ask' : 'default';
    assert.equal(neutralDecision(rules, shell(command)), expected, JSON.stringify(command));
  }
  assert.equal(neutralDecision(rules, shell('echo hi # x')), 'default');
  assert.equal(neutralDecision(rules, shell('echo hi')), 'allow', 'a parsed command is unchanged');
});

test('R1: the Claude Code and OpenCode shell lines are translated, and name the live check of step 5', () => {
  for (const engine of ['claude-code', 'opencode']) {
    const t = translateGuardrails(engine, { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: [] });
    assert.equal(lineOf(t, 'd').result, 'translated', engine);
    assert.match(lineOf(t, 'd').reason, /parser/);
    assert.match(lineOf(t, 'd').reason, /step 5/);
  }
});

test('R1: decidingRules returns the rules of the effect that decided', () => {
  const rules = [rule('d', 'shell', 'git push *', 'deny'), rule('q', 'shell', 'git *', 'ask'), rule('a', 'shell', 'git status', 'allow')];
  assert.deepEqual(decidingRules(rules, shell('git push x')).map(r => r.id), ['d']);
  assert.deepEqual(decidingRules(rules, shell('git log')).map(r => r.id), ['q']);
  assert.deepEqual(decidingRules([rules[2]], shell('git status')).map(r => r.id), ['a']);
  assert.deepEqual(decidingRules(rules, shell('ls')), []);
  assert.deepEqual(decidingRules(rules, shell('eval git push')).map(r => r.id), ['d', 'q'], 'fail closed: the rules whose program appears');
});

// ---- R2: whitespace ------------------------------------------------------------------------------------------------------

test('R2: the neutral model reads runs of whitespace as one space', () => {
  const rules = [rule('d', 'shell', 'git push *', 'deny')];
  for (const c of ['git  push o', 'git\tpush o', '  git push   o  ']) assert.equal(neutralDecision(rules, shell(c)), 'deny', JSON.stringify(c));
  assert.equal(neutralDecision(rules, shell('echo "git  push"')), 'default', 'quoted text keeps its spaces');
});

test('R2: an OpenCode deny or ask turns each literal space into *, and says it blocks more', () => {
  const t = translateGuardrails('opencode', { rules: [rule('d', 'shell', 'git push * main', 'deny'), rule('a', 'shell', 'git status', 'allow')], sandbox: [] });
  const bash = t.form.permission.find(k => k.key === 'bash').rules;
  assert.ok(bash.some(r => r.pattern === 'git*push*main' && r.action === 'deny'), JSON.stringify(bash));
  assert.ok(bash.some(r => r.pattern === 'git status' && r.action === 'allow'), 'an allow keeps its spaces');
  assert.match(lineOf(t, 'd').reason, /blocks more/);
  assert.equal(engineDecision(t.form, shell('git  push\to main')), 'deny');
});

test('R2: Claude Code lists whitespace as a known escape', () => {
  assert.ok(KNOWN_ESCAPES.whitespace.engines.includes('claude-code'));
  assert.deepEqual(escapesOf('claude-code', shell('git  push x')), ['whitespace']);
  assert.ok(lineOf(translateGuardrails('claude-code', { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: [] }), 'd').reason.includes(KNOWN_ESCAPES.whitespace.text));
});

// ---- R3: path and web denies with and without a sandbox ------------------------------------------------------------------

test('R3: a path or web deny is translated unless a carried sandbox covers it', () => {
  const read = rule('env', 'read', '.env', 'deny'), web = rule('evil', 'web', 'evil.example', 'deny');
  for (const engine of ['claude-code', 'opencode']) {
    const t = translateGuardrails(engine, { rules: [read, web], sandbox: [] });
    for (const id of ['env', 'evil']) {
      // Review item W6: a Claude Code web deny has a form with no documented vector, so it is weakened.
      assert.equal(lineOf(t, id).result, engine === 'claude-code' && id === 'evil' ? 'weakened' : 'translated', `${engine} ${id}`);
      assert.match(lineOf(t, id).reason, /shell command can still reach/);
    }
  }
  // Review item W5: a sandbox requirement has no scope, so it never upgrades the line; the note names it.
  const files = translateGuardrails('claude-code', { rules: [read, web], sandbox: [sandbox({ files: true, network: false })] });
  assert.equal(lineOf(files, 'env').result, 'translated');
  assert.match(lineOf(files, 'env').reason, /sandbox box may cover it/);
  assert.doesNotMatch(lineOf(files, 'evil').reason, /sandbox box/, 'the sandbox does not cover the network');
  const oc = translateGuardrails('opencode', { rules: [read], sandbox: [sandbox()] });
  assert.equal(lineOf(oc, 'env').result, 'translated', 'OpenCode carries no sandbox');
});

// ---- R4: more known escapes, and wrapper options ----------------------------------------------------------------------------

test('R4: every form of finding M1 is a known escape, Claude Code included where it applies', () => {
  for (const id of ['wrapper-options', 'eval-exec', 'find-exec', 'pipe-to-shell', 'here-document', 'coproc', 'subcommand-flags', 'runtime-word']) {
    assert.ok(KNOWN_ESCAPES[id], id);
    assert.ok(KNOWN_ESCAPES[id].engines.includes('claude-code'), id);
  }
  for (const engine of ['claude-code', 'codex', 'opencode']) {
    const reason = lineOf(translateGuardrails(engine, { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: [] }), 'd').reason;
    for (const id of Object.keys(KNOWN_ESCAPES)) if (KNOWN_ESCAPES[id].kind === 'shell' && KNOWN_ESCAPES[id].engines.includes(engine)) assert.ok(reason.includes(KNOWN_ESCAPES[id].text), `${engine} ${id}`);
  }
});

test('R4: command -p and xargs with options are stripped when the program word is literal', () => {
  assert.equal(stripWrappers('command -p rm x'), 'rm x');
  assert.equal(stripWrappers('xargs -0 rm'), 'rm');
  assert.equal(stripWrappers('xargs -I{} rm {}'), 'rm {}');
  assert.equal(stripWrappers('xargs -I {} rm {}'), 'rm {}');
  assert.equal(stripWrappers('xargs -n 1 -P 4 rm'), 'rm');
  assert.equal(stripWrappers('xargs -0 $CMD'), 'xargs -0 $CMD', 'a program built at run time is not stripped');
  assert.equal(stripWrappers('command -v rm'), 'command -v rm');
  assert.equal(neutralDecision([rule('d', 'shell', 'rm *', 'deny')], shell('find . | xargs -0 rm')), 'deny');
  assert.deepEqual(escapesOf('claude-code', shell('xargs -0 rm x')), ['wrapper-options']);
});

// ---- R5: path case, path form, and web subdomains -----------------------------------------------------------------------

test('R5: a deny or ask path matches in any letter case; an allow does not', () => {
  const rules = [rule('env', 'read', '.env', 'deny'), rule('pem', 'read', '*.pem', 'ask'), rule('src', 'read', 'src/**', 'allow')];
  assert.equal(neutralDecision(rules, { action: 'read', path: '.ENV' }), 'deny');
  assert.equal(neutralDecision(rules, { action: 'read', path: 'a/.Env' }), 'deny');
  assert.equal(neutralDecision(rules, { action: 'read', path: 'k/a.PEM' }), 'ask');
  assert.equal(neutralDecision(rules, { action: 'read', path: 'SRC/a.ts' }), 'default');
  assert.deepEqual(escapesOf('opencode', { action: 'read', path: '.ENV' }, rules), ['path-case']);
});

test('R5: request paths are normalized for //, ./, and ..', () => {
  assert.equal(normalizeRequestPath('config//prod.yml'), 'config/prod.yml');
  assert.equal(normalizeRequestPath('./config/./prod.yml'), 'config/prod.yml');
  assert.equal(normalizeRequestPath('x/../config/prod.yml'), 'config/prod.yml');
  assert.equal(normalizeRequestPath('docs/../../etc/passwd'), null, 'outside the project');
  const rules = [rule('d', 'read', 'config/prod.yml', 'deny'), rule('a', 'read', 'docs/**', 'allow')];
  for (const path of ['config//prod.yml', 'config/./prod.yml', 'x/../config/prod.yml']) assert.equal(neutralDecision(rules, { action: 'read', path }), 'deny', path);
  assert.equal(neutralDecision(rules, { action: 'read', path: 'docs/../../etc/passwd' }), 'ask', 'review item W10: a deny makes it fail closed');
  assert.deepEqual(escapesOf('claude-code', { action: 'read', path: 'config//prod.yml' }, rules), ['path-form']);
});

test('R5: a web deny covers subdomains and a trailing dot, in the model and in every form that carries web rules', () => {
  const deny = rule('evil', 'web', 'evil.example', 'deny');
  for (const host of ['evil.example', 'a.evil.example', 'evil.example.', 'a.b.evil.example.']) {
    assert.equal(neutralDecision([deny], { action: 'web', host }), 'deny', host);
    for (const engine of ['claude-code', 'opencode']) {
      const t = translateGuardrails(engine, { rules: [deny], sandbox: [] });
      assert.equal(engineDecision(t.form, { action: 'web', host }), 'deny', `${engine} ${host}`);
    }
  }
  assert.equal(neutralDecision([deny], { action: 'web', host: 'notevil.example' }), 'default');
  assert.equal(neutralDecision([rule('ok', 'web', 'docs.example', 'allow')], { action: 'web', host: 'a.docs.example' }), 'default', 'an allow is not widened');
});

// ---- R6: Claude Code read deny ------------------------------------------------------------------------------------------

test('R6: a Claude Code read deny writes Read, Edit, and Write', () => {
  const t = translateGuardrails('claude-code', { rules: [rule('env', 'read', '.env', 'deny')], sandbox: [] });
  assert.deepEqual(t.form.permissions.deny, ['Read(.env)', 'Edit(.env)', 'Write(.env)']);
  assert.equal(engineDecision(t.form, { action: 'write', path: 'a/.env' }), 'deny');
});

// ---- R8: explicit engine defaults ---------------------------------------------------------------------------------------

test('R8: every engine form carries its default decision, and OpenCode gets an explicit ask default first', () => {
  const forms = Object.fromEntries(['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'].map(e => [e, translateGuardrails(e, { rules: [], sandbox: [] }).form]));
  for (const [engine, form] of Object.entries(forms)) {
    assert.ok(['deny', 'ask', 'default', 'allow'].includes(form.defaults.decision), engine);
    assert.ok(form.defaults.reason.length > 0, engine);
  }
  assert.deepEqual(forms.opencode.permission[0], { key: '*', rules: [{ pattern: '*', action: 'ask' }] });
  assert.equal(forms.opencode.defaults.decision, 'ask');
  assert.equal(forms.opencode.defaults.written, true);
  assert.equal(engineDecision(forms.opencode, shell('ls')), 'ask');
  assert.equal(forms.pi.defaults.decision, 'allow');
  assert.equal(forms.pi.defaults.written, false);
  const allow = translateGuardrails('opencode', { rules: [rule('a', 'shell', 'git *', 'allow')], sandbox: [] });
  assert.equal(engineDecision(allow.form, shell('git status')), 'allow', 'a later rule still wins over the default');
});

// ---- R9: OpenCode read-like tools ---------------------------------------------------------------------------------------

test('R9: an OpenCode read deny or ask also covers grep, glob, and list, and says it blocks more', () => {
  const t = translateGuardrails('opencode', { rules: [rule('env', 'read', '.env', 'deny')], sandbox: [] });
  for (const key of ['grep', 'glob', 'list']) {
    assert.deepEqual(t.form.permission.find(k => k.key === key)?.rules, [{ pattern: '*', action: 'deny' }], key);
  }
  assert.match(lineOf(t, 'env').reason, /grep, glob, and list/);
  assert.equal(lineOf(t, 'env').result, 'translated');
});

// ---- C1 with R1: here-documents ------------------------------------------------------------------------------------------

test('C1: the rest of a here-document opening line is read, terminators follow <<- tabs, and an unquoted body is scanned', () => {
  assert.deepEqual(splitCommand('cat <<EOF | sh\nbody\nEOF'), ['cat <<EOF', 'sh']);
  assert.deepEqual(splitCommand('cat <<-EOF\n\tbody\n\tEOF\nrm x'), ['cat <<-EOF', 'rm x']);
  assert.deepEqual(splitCommand('cat <<EOF\nEOFX\nEOF\nrm x'), ['cat <<EOF', 'rm x'], 'a terminator is a whole line');
  assert.deepEqual(splitCommand('cat <<EOF\n$(rm a) `rm b` ${X}\nEOF'), ['cat <<EOF', 'rm a', 'rm b']);
  assert.deepEqual(splitCommand("cat <<'EOF'\n$(rm a)\nEOF"), ["cat <<'EOF'"], 'a quoted delimiter keeps the body as text');
});

// ---- R11 (C2): line continuation ------------------------------------------------------------------------------------------

test('R11: two backslashes and a newline are an escaped backslash and a real line break', () => {
  assert.deepEqual(splitCommand('echo a\\\\\nrm -rf x'), ['echo a\\\\', 'rm -rf x']);
  assert.equal(neutralDecision([rule('d', 'shell', 'rm *', 'deny'), rule('a', 'shell', 'echo *', 'allow')], shell('echo a\\\\\nrm -rf x')), 'deny');
  assert.deepEqual(splitCommand('echo a\\\nrm -rf x'), ['echo arm -rf x'], 'one unescaped backslash continues the line');
});

// ---- C3: path input contract ----------------------------------------------------------------------------------------------

test('C3: a request path that leaves the project, or is absolute, never matches an allow', () => {
  const allow = [rule('a', 'read', 'src/**', 'allow')];
  for (const path of ['src/../.git/config', '/src/a', '/etc/passwd', '~/src/a', 'src/../../x']) {
    assert.equal(neutralDecision(allow, { action: 'read', path }), 'default', path);
  }
  assert.equal(normalizeRequestPath('/etc/passwd'), null);
  assert.equal(neutralDecision(allow, { action: 'read', path: 'src/./a' }), 'allow');
});

// ---- R12 (C4): OpenCode allow with a slash ------------------------------------------------------------------------------

test('R12: an OpenCode shell allow whose pattern holds a slash is absent', () => {
  const t = translateGuardrails('opencode', { rules: [rule('a', 'shell', 'rm a/b', 'allow'), rule('b', 'shell', 'ls *', 'allow')], sandbox: [] });
  assert.equal(lineOf(t, 'a').result, 'absent');
  assert.match(lineOf(t, 'a').reason, /backslash/);
  assert.equal(lineOf(t, 'b').result, 'translated');
});

// ---- R13 (C5): Codex prefix and NAME=value ------------------------------------------------------------------------------

test('R13: the Codex literal prefix stops at a NAME=value word', () => {
  assert.equal(codexPrefix('NODE_ENV=production npm run *'), null);
  assert.deepEqual(codexPrefix('npm run X=1 *'), { tokens: ['npm', 'run'], same: false });
  const t = translateGuardrails('codex', { rules: [rule('d', 'shell', 'NODE_ENV=production npm run *', 'deny')], sandbox: [] });
  assert.equal(lineOf(t, 'd').result, 'absent');
});

// ---- R14 (C6): Codex shell escapes weaken the rule ------------------------------------------------------------------------

test('R14: a Codex shell deny or ask is weakened, unless a carried sandbox bounds it', () => {
  const d = rule('d', 'shell', 'rm *', 'deny');
  const bare = translateGuardrails('codex', { rules: [d], sandbox: [] });
  assert.equal(lineOf(bare, 'd').result, 'weakened');
  assert.match(lineOf(bare, 'd').reason, /glob/);
  const boxed = translateGuardrails('codex', { rules: [d], sandbox: [sandbox()] });
  assert.equal(lineOf(boxed, 'd').result, 'weakened', 'review item W5');
  assert.match(lineOf(boxed, 'd').reason, /sandbox box may cover it/);
});

// ---- R15 (C7, C8) -------------------------------------------------------------------------------------------------------

test('R15: an MCP allow that could reach another server is absent in OpenCode and Claude Code', () => {
  const allow = rule('a', 'mcp', 'x/*', 'allow');
  for (const [engine, other] of [['opencode', { action: 'mcp', server: 'x_y', tool: 'z' }], ['claude-code', { action: 'mcp', server: 'x__y', tool: 'z' }]]) {
    const t = translateGuardrails(engine, { rules: [allow], sandbox: [] });
    assert.equal(lineOf(t, 'a').result, 'absent', engine);
    assert.notEqual(engineDecision(t.form, other), 'allow', engine);
  }
});

test('R15: deny beats ask, and ask beats allow, for edit, web, and mcp rules too, whatever the order', () => {
  const sets = [
    [rule('a', 'edit', 'src/**', 'allow'), rule('q', 'edit', 'src/gen/**', 'ask'), rule('d', 'edit', 'src/gen/lock', 'deny')],
    [rule('a', 'web', '*', 'allow'), rule('q', 'web', 'b.example', 'ask'), rule('d', 'web', 'x.b.example', 'deny')],
    [rule('a', 'mcp', 'gh', 'allow'), rule('q', 'mcp', 'gh/create_*', 'ask'), rule('d', 'mcp', 'gh/create_repo', 'deny')],
  ];
  const requests = [
    [{ action: 'edit', path: 'src/gen/lock' }, { action: 'edit', path: 'src/gen/a' }, { action: 'edit', path: 'src/a' }],
    [{ action: 'web', host: 'x.b.example' }, { action: 'web', host: 'b.example' }, { action: 'web', host: 'c.example' }],
    [{ action: 'mcp', server: 'gh', tool: 'create_repo' }, { action: 'mcp', server: 'gh', tool: 'create_issue' }, { action: 'mcp', server: 'gh', tool: 'get' }],
  ];
  sets.forEach((rules, i) => {
    for (const order of [rules, [...rules].reverse()]) {
      assert.deepEqual(requests[i].map(r => neutralDecision(order, r)), ['deny', 'ask', 'allow'], JSON.stringify(order.map(r => r.id)));
    }
  });
});

test('R15: host matching ignores letter case and a trailing dot, in the model and in Claude Code', () => {
  const deny = rule('d', 'web', 'evil.example', 'deny'), allow = rule('a', 'web', 'docs.example', 'allow');
  for (const host of ['EVIL.example', 'a.Evil.Example.', 'evil.example.']) assert.equal(neutralDecision([deny], { action: 'web', host }), 'deny', host);
  assert.equal(neutralDecision([allow], { action: 'web', host: 'Docs.Example.' }), 'allow');
  const t = translateGuardrails('claude-code', { rules: [deny], sandbox: [] });
  assert.equal(engineDecision(t.form, { action: 'web', host: 'A.EVIL.example' }), 'deny');
});

// ---- R16 (C9): private blocks of lines that write nothing ----------------------------------------------------------------

test('R16: a line that writes nothing carries no private block, and the block is reported as excluded', () => {
  const a = rule('a', 'shell', 'git *', 'allow', { privateBlocks: { codex: { note: 1 } } });
  const t = translateGuardrails('codex', { rules: [a], sandbox: [] });
  assert.equal(t.written.length, 0);
  assert.deepEqual(t.privateBlocks, {});
  assert.deepEqual(t.excludedPrivateBlocks.map(e => e.entry), ['a']);
  assert.match(t.excludedPrivateBlocks[0].reason, /writes nothing/);
});

// ---- R17 (C10) -------------------------------------------------------------------------------------------------------------

test('R17: an OpenCode path rule that starts with $HOME is absent; a Codex edit deny is weakened; Claude Code redirects are not credited', () => {
  const oc = translateGuardrails('opencode', { rules: [rule('h', 'read', '$HOME/x', 'allow'), rule('k', 'edit', '$HOME/y', 'deny')], sandbox: [] });
  assert.equal(lineOf(oc, 'h').result, 'absent');
  assert.equal(lineOf(oc, 'k').result, 'absent');
  // Live check g8 covered one literal deny entry. A change rule writes a read-only entry for a literal path and glob deny
  // entries for any other path, and no live check covered either, so both stay weakened and name the form.
  const cx = translateGuardrails('codex', { rules: [rule('e', 'edit', 'docs/**', 'deny'), rule('w', 'write', 'src/*.lock', 'deny'), rule('r', 'read', '.env', 'deny')], sandbox: [] });
  assert.equal(lineOf(cx, 'e').result, 'weakened');
  assert.match(lineOf(cx, 'e').reason, /docs = read/);
  assert.match(lineOf(cx, 'e').reason, /Live check g8 of step 5 found a file under a literal deny entry unchanged after a patch turn, but no live check covered a read-only entry/);
  assert.equal(lineOf(cx, 'w').result, 'weakened');
  assert.equal(cx.form.filesystem.filter(f => f.path.includes('src/*.lock')).every(f => f.access === 'deny'), true);
  assert.match(lineOf(cx, 'w').reason, /no live check covered a glob entry/);
  assert.doesNotMatch(lineOf(cx, 'w').reason, /until the live check of step 5 confirms it/);
  assert.equal(lineOf(cx, 'r').result, 'translated');
  assert.doesNotMatch(lineOf(cx, 'r').reason, /apply_patch/);
  const cc = translateGuardrails('claude-code', { rules: [rule('r', 'read', '.env', 'deny')], sandbox: [] });
  assert.match(lineOf(cc, 'r').reason, /redirect/);
  assert.equal(engineDecision(cc.form, shell('echo x > .env')), 'default', 'a redirect to the denied path is not blocked by the model');
});

// ---- Follow-up ruling 4: path allows ----------------------------------------------------------------------------------------

test('follow-up 4: a path allow that an engine can reach through .. or other letter case is weakened', () => {
  for (const engine of ['claude-code', 'opencode']) {
    for (const r of [rule('a', 'read', 'src/**', 'allow'), rule('b', 'edit', 'src/**', 'allow', { strength: 'enforced' }), rule('c', 'write', 'notes/**', 'allow')]) {
      const t = translateGuardrails(engine, { rules: [r], sandbox: [] });
      assert.equal(lineOf(t, r.id).result, 'weakened', `${engine} ${r.id}`);
      assert.match(lineOf(t, r.id).reason, /\.\./);
      assert.match(lineOf(t, r.id).reason, /letter case/);
    }
    // The engine really reaches outside the rule through ..
    const t = translateGuardrails(engine, { rules: [rule('a', 'read', 'src/**', 'allow')], sandbox: [] });
    assert.equal(engineDecision(t.form, { action: 'read', path: 'src/../.git/config' }), 'allow', engine);
    assert.equal(neutralDecision([rule('a', 'read', 'src/**', 'allow')], { action: 'read', path: 'src/../.git/config' }), 'default');
  }
  // A path deny is not weakened by this; Codex writes no allow at all.
  assert.equal(lineOf(translateGuardrails('claude-code', { rules: [rule('d', 'read', '.env', 'deny')], sandbox: [sandbox()] }), 'd').result, 'translated');
  assert.equal(lineOf(translateGuardrails('codex', { rules: [rule('a', 'read', 'src/**', 'allow')], sandbox: [] }), 'a').result, 'translated');
});
