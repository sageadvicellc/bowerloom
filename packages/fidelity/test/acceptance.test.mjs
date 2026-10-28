// Locked-in parts spec, section 12: checks 1, 2, 9, and 12, and the fidelity rule of section 2 as a property: a
// projection is never more permissive than its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_IDS, appliesTo, entryHash } from '../../../dist/packages/harness-definition/src/index.js';
import {
  DECISIONS, KNOWN_ESCAPES, NOT_WRITTEN, engineDecision, escapesOf, judgeGuardrails, morePermissive, neutralDecision, projectGuardrails,
  translateGuardrails,
} from '../../../dist/packages/fidelity/src/index.js';
import { MIXED_RULES, NOW, allRequests, random, rule, sandbox, source } from './fixture.mjs';

const lineOf = (translation, id) => translation.lines.find(l => l.entry === id);
const approval = (entry, engine, result, extra = {}) => ({
  part: 'guardrails', entry: entry.id, engine, result, entryHash: entryHash(entry), who: 'Test Person', when: '2026-10-28T10:00:00Z', reason: 'Synthetic test approval.', ...extra,
});

// ---- The neutral model --------------------------------------------------------------------------------------------------

test('the neutral precedence is fixed: deny beats ask, and ask beats allow, whatever the order', () => {
  const rules = [rule('a', 'shell', 'git *', 'allow'), rule('b', 'shell', 'git push *', 'ask'), rule('c', 'shell', 'git push * main', 'deny')];
  for (const order of [rules, [...rules].reverse(), [rules[1], rules[2], rules[0]]]) {
    assert.equal(neutralDecision(order, { action: 'shell', command: 'git push o main' }), 'deny');
    assert.equal(neutralDecision(order, { action: 'shell', command: 'git push o dev' }), 'ask');
    assert.equal(neutralDecision(order, { action: 'shell', command: 'git status' }), 'allow');
    assert.equal(neutralDecision(order, { action: 'shell', command: 'ls' }), 'default');
  }
});

test('decisions are ordered from strict to permissive', () => {
  assert.deepEqual(DECISIONS, ['deny', 'ask', 'default', 'allow']);
  assert.equal(morePermissive('allow', 'default'), true);
  assert.equal(morePermissive('default', 'ask'), true);
  assert.equal(morePermissive('ask', 'deny'), true);
  assert.equal(morePermissive('deny', 'deny'), false);
  assert.equal(morePermissive('ask', 'allow'), false);
});

test('a read deny also blocks an edit of the same path, as in Claude Code', () => {
  const rules = [rule('no-env', 'read', '.env', 'deny')];
  assert.equal(neutralDecision(rules, { action: 'edit', path: 'a/.env' }), 'deny');
  assert.equal(neutralDecision(rules, { action: 'write', path: '.env' }), 'deny');
});

test('a pattern outside the neutral language is absent in every engine and never written', () => {
  for (const r of [rule('abs', 'read', '/etc/passwd', 'deny'), rule('neg', 'read', '!x', 'deny'), rule('up', 'edit', '../x/**', 'deny'),
    rule('cls', 'read', 'a[bc]', 'deny'), rule('url', 'web', 'https://x.example/a', 'deny'), rule('mcp', 'mcp', 'a/b/c', 'deny')]) {
    for (const engine of ENGINE_IDS) {
      const t = translateGuardrails(engine, { rules: [r], sandbox: [] });
      assert.equal(lineOf(t, r.id).result, 'absent', `${r.id} ${engine}`);
      assert.match(lineOf(t, r.id).reason, /neutral/);
      assert.equal(t.written.length, 0, `${r.id} ${engine}`);
    }
  }
});

// ---- Check 1: Codex ---------------------------------------------------------------------------------------------------

test('check 1: deny `git push * main` with allow `git *` gives a forbidden `git push` rule and no Codex allow rule', () => {
  const t = translateGuardrails('codex', { rules: [rule('no-push-main', 'shell', 'git push * main', 'deny'), rule('git-any', 'shell', 'git *', 'allow')], sandbox: [] });
  assert.deepEqual(t.form.prefixRules.map(r => ({ pattern: r.pattern, decision: r.decision })), [{ pattern: ['git', 'push'], decision: 'forbidden' }]);
  assert.equal(t.form.prefixRules.some(r => r.decision === 'allow'), false);
  const deny = lineOf(t, 'no-push-main');
  assert.equal(deny.result, 'translated');
  assert.match(deny.reason, /git push/);
  assert.match(deny.reason, /blocks more/);
  const allow = lineOf(t, 'git-any');
  assert.equal(allow.result, 'translated');
  assert.match(allow.reason, /no Codex allow rule/);
  assert.equal(engineDecision(t.form, { action: 'shell', command: 'git push origin dev' }), 'deny');
  assert.equal(engineDecision(t.form, { action: 'shell', command: 'git status' }), 'default');
});

test('check 1: a neutral allow never produces a Codex allow rule (property, 500 random rule sets)', () => {
  const r = random(7);
  const words = ['git', 'npm', 'run', 'push', 'main', '*', '--x', 'rm', 'a?b', ':*'];
  for (let i = 0; i < 500; i++) {
    const rules = Array.from({ length: 1 + Math.floor(r.next() * 6) }, (_, j) => {
      const pattern = Array.from({ length: 1 + Math.floor(r.next() * 4) }, () => r.pick(words)).join(' ');
      return rule(`r${j}`, 'shell', pattern, r.pick(['allow', 'ask', 'deny']));
    });
    const t = translateGuardrails('codex', { rules, sandbox: [] });
    assert.equal(t.form.prefixRules.some(p => p.decision === 'allow'), false, JSON.stringify(rules.map(x => [x.pattern, x.effect])));
  }
});

test('check 1: a deny or ask with no literal prefix is absent in Codex and refused without an approval', () => {
  const deny = rule('no-version', 'shell', '* --version', 'deny');
  const t = translateGuardrails('codex', { rules: [deny], sandbox: [] });
  assert.equal(lineOf(t, 'no-version').result, 'absent');
  assert.equal(t.form.prefixRules.length, 0);
  const src = source([deny], { engines: ['codex'] });
  const refused = projectGuardrails(src, [], { now: NOW });
  assert.equal(refused.verdict.ok, false);
  assert.deepEqual(refused.verdict.refused.map(l => [l.entry, l.engine, l.result]), [['no-version', 'codex', 'absent']]);
  const approved = projectGuardrails(src, [approval(deny, 'codex', 'absent')], { now: NOW });
  assert.equal(approved.verdict.ok, true, JSON.stringify(approved.verdict.problems));
  assert.equal(approved.verdict.approved.length, 1);
  // An approval of a changed entry no longer applies (definition spec, decision 10).
  const changed = { ...deny, pattern: '* --help' };
  assert.equal(projectGuardrails(source([changed], { engines: ['codex'] }), [approval(deny, 'codex', 'absent')], { now: NOW }).verdict.ok, false);
});

test('check 1: Codex has no rule target for read-only web, skill, or subagent rules, so they are absent', () => {
  for (const r of [rule('w', 'web', 'evil.example', 'deny'), rule('s', 'skill', 'x', 'deny'), rule('a', 'subagent', 'x', 'deny')]) {
    const t = translateGuardrails('codex', { rules: [r], sandbox: [] });
    assert.equal(lineOf(t, r.id).result, 'absent', r.id);
  }
});

// ---- Check 2: every neutral field is projected or listed ----------------------------------------------------------------

function randomRules(r, n) {
  const shell = ['git *', 'git push * main', 'rm *', '* --version', 'npm run:*', 'ls*', 'echo a?b', 'curl * x *', 'make'];
  const paths = ['.env', 'src/**', 'docs/*.md', '**/*.pem', 'a/**/b', 'build/', '*', 'x/*'];
  const names = { web: ['*', 'evil.example', '*.evil.example'], mcp: ['x', 'x/*', 'gh/get', '*', 'a_b/c', 'x/get_*'], subagent: ['a', 'rev-*', '*'], skill: ['a', 'b*'] };
  const blocks = [{}, { codex: { justification: 'kept' } }, { 'claude-code': { note: 1 }, opencode: { note: 2 } }];
  return Array.from({ length: n }, (_, i) => {
    const action = r.pick(['shell', 'shell', 'read', 'edit', 'write', 'web', 'mcp', 'subagent', 'skill']);
    const pattern = action === 'shell' ? r.pick(shell) : ['read', 'edit', 'write'].includes(action) ? r.pick(paths) : r.pick(names[action]);
    const effect = r.pick(['allow', 'ask', 'deny']);
    const engines = r.next() < 0.2 ? [r.pick(ENGINE_IDS)] : undefined;
    return rule(`r${i}`, action, pattern, effect, { strength: effect === 'allow' ? r.pick(['advisory', 'enforced']) : 'enforced', privateBlocks: r.pick(blocks), ...(engines ? { engines } : {}) });
  });
}

test('check 2: every rule and sandbox field is projected or listed in the loss report (property, 300 random sets)', () => {
  const r = random(11);
  for (let i = 0; i < 300; i++) {
    const rules = randomRules(r, 1 + Math.floor(r.next() * 8));
    const box = r.next() < 0.5 ? [sandbox({ files: r.next() < 0.5, network: true, privateBlocks: r.pick([{}, { codex: { k: 1 } }]) })] : [];
    const src = source(rules, { sandbox: box });
    const projected = projectGuardrails(src, [], { now: NOW });
    // The contract builds the expected set itself, so a missing line or an unknown line is a problem.
    assert.deepEqual(projected.verdict.problems, [], JSON.stringify(rules));
    for (const engine of ENGINE_IDS) {
      const t = projected.translations[engine];
      for (const entry of [...rules, ...box]) {
        const lines = t.lines.filter(l => l.entry === entry.id);
        if (!appliesTo(entry, engine)) { assert.equal(lines.length, 0); continue; }
        assert.equal(lines.length, 1, `${entry.id} ${engine}`);
        const [line] = lines;
        assert.ok(line.reason.trim() !== '', `${entry.id} ${engine} has a reason`);
        const written = t.written.filter(w => w.source === entry.id);
        if (line.result === 'absent') assert.equal(written.length, 0, `${entry.id} ${engine} absent but written`);
        else if (line.result === 'translated' && line.reason.includes(NOT_WRITTEN)) assert.equal(written.length, 0);
        else assert.ok(written.length > 0, `${entry.id} ${engine} ${line.result} but nothing written: ${line.reason}`);
        const block = entry.privateBlocks[engine];
        if (line.result !== 'absent' && block !== undefined) assert.deepEqual(t.privateBlocks[entry.id], block);
        else assert.equal(t.privateBlocks[entry.id], undefined);
      }
      // Nothing is written that no entry asked for.
      for (const w of t.written) assert.ok([...rules, ...box].some(e => e.id === w.source), `${engine} wrote ${w.source}`);
    }
  }
});

test('check 2: the sandbox requirement has a line in every engine, with the results of the capability matrix', () => {
  const t = Object.fromEntries(ENGINE_IDS.map(e => [e, translateGuardrails(e, { rules: [], sandbox: [sandbox()] })]));
  assert.deepEqual(Object.fromEntries(ENGINE_IDS.map(e => [e, lineOf(t[e], 'box').result])), {
    'claude-code': 'exact', codex: 'exact', opencode: 'absent', pi: 'absent', 'deepseek-harness': 'translated',
  });
  assert.deepEqual(t['claude-code'].form.sandbox, { files: true, network: true });
  assert.equal(t.opencode.written.length, 0);
});

// ---- The fidelity rule as a property ------------------------------------------------------------------------------------

/**
 * Returns a message for each request where the engine decides more permissively than the neutral source, and the loss
 * report does not explain it: no rule that matches the request is `weakened` or `absent`, and the request is not a known
 * escape that the report lists for that engine.
 */
function unexplained(rules, engine, requests) {
  const own = rules.filter(r => appliesTo(r, engine));
  const t = translateGuardrails(engine, { rules: own, sandbox: [] });
  const out = [];
  for (const request of requests) {
    const neutral = neutralDecision(own, request);
    const projected = engineDecision(t.form, request);
    if (!morePermissive(projected, neutral)) continue;
    const matching = own.filter(r => neutralDecision([r], request) !== 'default');
    const lost = matching.some(r => ['weakened', 'absent'].includes(lineOf(t, r.id).result));
    const escapes = escapesOf(engine, request);
    const listed = escapes.length > 0 && matching.some(r => escapes.every(e => lineOf(t, r.id).reason.includes(KNOWN_ESCAPES[e].text)));
    if (!lost && !listed) out.push(`${engine} ${JSON.stringify(request)}: ${projected} is more permissive than ${neutral}`);
  }
  return out;
}

test('fidelity rule: no engine decides more permissively than the source, except where the report says so (fixture set)', () => {
  for (const engine of ENGINE_IDS) assert.deepEqual(unexplained(MIXED_RULES, engine, allRequests()), [], engine);
});

test('fidelity rule: the same holds for 200 random rule sets', () => {
  const r = random(23);
  const requests = allRequests();
  for (let i = 0; i < 200; i++) {
    const rules = randomRules(r, 1 + Math.floor(r.next() * 10));
    for (const engine of ENGINE_IDS) assert.deepEqual(unexplained(rules, engine, requests), [], JSON.stringify(rules.map(x => [x.action, x.pattern, x.effect])));
  }
});

test('fidelity rule: where Claude Code carries every matching rule exactly, its decision equals the neutral one', () => {
  const t = translateGuardrails('claude-code', { rules: MIXED_RULES, sandbox: [] });
  let compared = 0;
  for (const request of allRequests()) {
    const matching = MIXED_RULES.filter(r => neutralDecision([r], request) !== 'default');
    if (matching.some(r => lineOf(t, r.id).result !== 'exact')) continue;
    assert.equal(engineDecision(t.form, request), neutralDecision(MIXED_RULES, request), JSON.stringify(request));
    compared++;
  }
  assert.ok(compared > 100, `compared ${compared}`);
  const notExact = t.lines.filter(l => l.result !== 'exact').map(l => [l.entry, l.result]);
  assert.deepEqual(notExact, [['no-mcp-x', 'translated'], ['agents-ok', 'absent']]);
});

test('every guardrail loss line lists the escapes known in every engine (spec 8.3 rule 6)', () => {
  for (const engine of ENGINE_IDS) {
    const t = translateGuardrails(engine, { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: [] });
    for (const id of ['sudo', 'env', 'shell-c', 'absolute-path']) assert.ok(lineOf(t, 'd').reason.includes(KNOWN_ESCAPES[id].text), `${engine} ${id}`);
  }
  const oc = translateGuardrails('opencode', { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: [] });
  assert.ok(lineOf(oc, 'd').reason.includes(KNOWN_ESCAPES.wrapper.text));
  const cx = translateGuardrails('codex', { rules: [rule('d', 'shell', 'rm *', 'deny')], sandbox: [] });
  assert.ok(lineOf(cx, 'd').reason.includes(KNOWN_ESCAPES['unsplit-script'].text));
});

// ---- Tighten, then refuse -------------------------------------------------------------------------------------------------

test('an engine that cannot express a deny exactly tightens it and says what it blocks extra', () => {
  const oc = translateGuardrails('opencode', { rules: [rule('q', 'shell', 'echo a?b', 'deny'), rule('md', 'edit', 'notes/*.md', 'deny')], sandbox: [] });
  assert.equal(lineOf(oc, 'q').result, 'translated');
  assert.match(lineOf(oc, 'q').reason, /blocks more/);
  assert.equal(lineOf(oc, 'md').result, 'translated');
  assert.match(lineOf(oc, 'md').reason, /blocks more/);
  const web = translateGuardrails('opencode', { rules: [rule('w', 'web', 'evil.example', 'deny')], sandbox: [] });
  assert.equal(lineOf(web, 'w').result, 'translated');
  assert.equal(engineDecision(web.form, { action: 'web', host: 'fine.example' }), 'deny');
});

test('an engine that cannot express an allow exactly does not widen it: the allow is absent', () => {
  const oc = translateGuardrails('opencode', { rules: [rule('q', 'shell', 'echo a?b', 'allow', { strength: 'enforced' }), rule('md', 'edit', 'notes/*.md', 'allow'), rule('tail', 'shell', '* --help *', 'allow')], sandbox: [] });
  for (const id of ['q', 'md', 'tail']) assert.equal(lineOf(oc, id).result, 'absent', id);
  assert.equal(oc.written.length, 0);
  const q = rule('q', 'shell', 'echo a?b', 'allow', { strength: 'enforced' });
  const verdict = judgeGuardrails(source([q], { engines: ['opencode'] }), oc.lines.filter(l => l.entry === 'q'), [], { now: NOW });
  assert.equal(verdict.ok, false, 'an enforced allow that is absent is refused');
});

// ---- Check 9: OpenCode last match wins ------------------------------------------------------------------------------------

/** Rules that OpenCode carries without tightening: no `?`, no multi-wildcard tail, no segment glob in a path. */
const OPENCODE_EXACT = MIXED_RULES.filter(r => !['query', 'help-tail', 'ask-lock', 'edit-md', 'no-evil', 'web-ok', 'ask-mcp'].includes(r.id));

test('check 9: OpenCode rules, read as last match wins, give the fixed-precedence decision for every fixture command', () => {
  const t = translateGuardrails('opencode', { rules: OPENCODE_EXACT, sandbox: [] });
  let compared = 0;
  for (const request of allRequests()) {
    if (escapesOf('opencode', request).length) continue;
    assert.equal(engineDecision(t.form, request), neutralDecision(OPENCODE_EXACT, request), JSON.stringify(request));
    compared++;
  }
  assert.ok(compared > 100, `compared ${compared}`);
});

test('check 9: each key is written allow first, then ask, then deny, whatever the source order', () => {
  const forward = translateGuardrails('opencode', { rules: OPENCODE_EXACT, sandbox: [] }).form;
  const reversed = translateGuardrails('opencode', { rules: [...OPENCODE_EXACT].reverse(), sandbox: [] }).form;
  assert.deepEqual(forward.permission.map(k => k.key), reversed.permission.map(k => k.key));
  const rank = { allow: 0, ask: 1, deny: 2 };
  for (const key of forward.permission) {
    const ranks = key.rules.map(x => rank[x.action]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), key.key);
    assert.equal(new Set(key.rules.map(x => x.pattern)).size, key.rules.length, `${key.key} has one action per pattern`);
  }
  for (const request of allRequests()) assert.equal(engineDecision(forward, request), engineDecision(reversed, request));
});

test('check 9: OpenCode 1.x webfetch and websearch carry one action only', () => {
  const t = translateGuardrails('opencode', { rules: [rule('a', 'web', '*', 'allow'), rule('d', 'web', 'evil.example', 'deny')], sandbox: [] });
  for (const key of t.form.permission.filter(k => k.key === 'webfetch' || k.key === 'websearch')) {
    assert.deepEqual(key.rules.map(x => x.pattern), ['*'], key.key);
  }
  assert.equal(engineDecision(t.form, { action: 'web', host: 'fine.example' }), 'deny');
});

// ---- Check 12: Pi and DeepSeek Harness ----------------------------------------------------------------------------------

test('check 12: a harness for pi or deepseek-harness with an enforced guardrail is refused without a recorded approval', () => {
  const deny = rule('no-rm', 'shell', 'rm *', 'deny');
  const allow = rule('git-any', 'shell', 'git *', 'allow');
  for (const engine of ['pi', 'deepseek-harness']) {
    const refused = projectGuardrails(source([deny, allow], { engines: [engine] }), [], { now: NOW });
    assert.equal(refused.verdict.ok, false, engine);
    assert.deepEqual(refused.verdict.refused.map(l => [l.entry, l.result]), [['no-rm', 'absent']], engine);
    assert.equal(refused.translations[engine].written.length, 0);
    const approved = projectGuardrails(source([deny, allow], { engines: [engine] }), [approval(deny, engine, 'absent')], { now: NOW });
    assert.equal(approved.verdict.ok, true, `${engine}: ${JSON.stringify(approved.verdict.problems)}`);
    // An approval for the other engine, or for `weakened`, does not cover it.
    const other = engine === 'pi' ? 'deepseek-harness' : 'pi';
    assert.equal(projectGuardrails(source([deny], { engines: [engine, other] }), [approval(deny, other, 'absent')], { now: NOW }).verdict.ok, false);
    assert.equal(projectGuardrails(source([deny], { engines: [engine] }), [approval(deny, engine, 'weakened')], { now: NOW }).verdict.ok, false);
  }
});

test('check 12: an advisory allow alone passes for pi, and a sandbox requirement is refused for pi', () => {
  assert.equal(projectGuardrails(source([rule('git-any', 'shell', 'git *', 'allow')], { engines: ['pi'] }), [], { now: NOW }).verdict.ok, true);
  const box = projectGuardrails(source([], { sandbox: [sandbox()], engines: ['pi'] }), [], { now: NOW });
  assert.equal(box.verdict.ok, false);
  assert.deepEqual(box.verdict.refused.map(l => [l.entry, l.result]), [['box', 'absent']]);
});

test('an OpenCode harness that requires a sandbox is refused and never labelled sandboxed (spec 8.3 rule 11)', () => {
  const p = projectGuardrails(source([], { sandbox: [sandbox()], engines: ['opencode'] }), [], { now: NOW });
  assert.equal(p.verdict.ok, false);
  assert.equal(p.translations.opencode.form.sandbox, undefined);
});
