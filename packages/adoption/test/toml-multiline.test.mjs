// TOML 1.0 multi-line strings in the subset adoption reads: `"""` (basic) and `'''` (literal).
// Accepted forms, edge rules (trimming, quotes before the closer, escapes), hostile input, a fuzz run, a round trip, and a Codex agent file that adopts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { applyPortable, planPortable } from '../../../dist/packages/project-sync/src/index.js';
import { parseTomlSubset } from '../../../dist/packages/adoption/src/toml.js';
import { project } from './fixture.mjs';

const ok = text => { const r = parseTomlSubset(text); assert.equal(r.ok, true, `${JSON.stringify(text)} gave ${JSON.stringify(r)}`); return r.value; };
const no = (text, code = 'TOML_UNSUPPORTED') => { const r = parseTomlSubset(text); assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(text)}`); assert.equal(r.code, code); return r; };
const Q3 = '"'.repeat(3), S3 = "'".repeat(3);
const basic = body => `a = ${Q3}${body}${Q3}\n`;
const lit = body => `a = ${S3}${body}${S3}\n`;

// ---- accepted forms -----------------------------------------------------------------------------------------------------

test('a multi-line basic string: the line break after the opener is dropped, the rest is kept', () => {
  assert.deepEqual(ok(basic('\nline one\nline two')), { a: 'line one\nline two' });
  assert.deepEqual(ok(basic('line one\nline two\n')), { a: 'line one\nline two\n' });
  assert.deepEqual(ok(basic('\n\nsecond line kept')), { a: '\nsecond line kept' });
  assert.deepEqual(ok(basic('')), { a: '' });
  assert.deepEqual(ok(basic('\n')), { a: '' });
  assert.deepEqual(ok(basic('\r\n')), { a: '' });
});

test('a multi-line literal string: the same rules, and no escapes', () => {
  assert.deepEqual(ok(lit('\nline one\nline two')), { a: 'line one\nline two' });
  assert.deepEqual(ok(lit('')), { a: '' });
  assert.deepEqual(ok(lit('\\n \\t \\u00e9 \\ at the end of a line \\\nnext')), { a: '\\n \\t \\u00e9 \\ at the end of a line \\\nnext' });
  assert.deepEqual(ok(lit('C:\\Users\\name "quoted" \'\'two\'\'')), { a: 'C:\\Users\\name "quoted" \'\'two\'\'' });
});

test('a line break reads as a line feed, also when the file uses carriage return and line feed', () => {
  assert.deepEqual(ok(basic('\r\nx\r\ny\r\n')), { a: 'x\ny\n' });
  assert.deepEqual(ok(lit('\r\nx\r\ny\r\n')), { a: 'x\ny\n' });
  no(basic('x\ry'));
  no(lit('x\ry'));
  no(basic('x\r'));
});

test('one or two quotes may sit inside, and up to two more before the closer', () => {
  assert.deepEqual(ok(basic('say "hi" and ""bye""')), { a: 'say "hi" and ""bye""' });
  assert.deepEqual(ok('a = """"x"""\n'), { a: '"x' }, 'a quote at the start');
  assert.deepEqual(ok(`a = ${Q3}x""""\n`), { a: 'x"' }, 'a string that ends in one quote: x, then four quotes');
  assert.deepEqual(ok(`a = ${Q3}x""${Q3}\n`), { a: 'x""' }, 'a string that ends in two quotes');
  assert.deepEqual(ok(`a = ${Q3}${Q3}\n`), { a: '' }, 'an empty string');
  no(`a = ${Q3}${Q3}${Q3}\n`);
  assert.deepEqual(ok(`a = ${Q3}${'"'.repeat(5)}\n`), { a: '""' }, 'eight quotes: the opener, two quotes, the closer');
  assert.deepEqual(ok(`a = ${S3}x''${S3}\n`), { a: "x''" });
  assert.deepEqual(ok(`a = ${S3}x${"'".repeat(4)}\n`), { a: "x'" }, 'x, then four quotes: one is content');
  // Six or more quotes in a row are refused.
  no(`a = ${Q3}x${'"'.repeat(6)}\n`);
  no(`a = ${S3}x${"'".repeat(6)}\n`);
  no(`a = ${Q3}${'"'.repeat(6)}\n`);
});

test('escapes in a multi-line basic string are the escapes of the one-line form', () => {
  assert.deepEqual(ok(basic('tab\\there \\"quote\\" back\\\\slash \\u00e9 \\U0001F600 \\b\\f\\n\\r')), { a: 'tab\there "quote" back\\slash \u00e9 \u{1F600} \b\f\n\r' });
  assert.deepEqual(ok(basic('a\ttab and no escape')), { a: 'a\ttab and no escape' }, 'a literal tab is allowed');
  for (const bad of ['\\q', '\\u12', '\\U0011FFFF', '\\ud800', '\\udfff', '\\u{1F600}', '\\x41', '\\e', '\\ ', '\\']) no(basic(bad));
});

test('a backslash at the end of a line drops the line break and all white space up to the next visible character', () => {
  assert.deepEqual(ok(basic('The quick \\\n   brown \\  \n\n\t fox')), { a: 'The quick brown fox' });
  assert.deepEqual(ok(basic('The quick \\\r\n   brown')), { a: 'The quick brown' });
  assert.deepEqual(ok(basic('keep \\\\\nthis break')), { a: 'keep \\\nthis break' }, 'two backslashes are one backslash, not a line ending');
  assert.deepEqual(ok(basic('\\\n   leading')), { a: 'leading' }, 'right after the opener');
  assert.deepEqual(ok(basic('trailing \\\n   ')), { a: 'trailing ' }, 'up to the closer');
  assert.deepEqual(ok(basic('\\\n\n\n   \\\n  x')), { a: 'x' });
  no(basic('a \\ b'), 'TOML_UNSUPPORTED');
  no(basic('a \\\r b'));
  assert.deepEqual(ok(lit('a \\\n   b')), { a: 'a \\\n   b' }, 'a literal string keeps it');
});

test('only tab and line feed may be control characters', () => {
  for (const code of [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f, 0x7f]) {
    const c = String.fromCharCode(code);
    no(basic(`a${c}b`)); no(lit(`a${c}b`));
  }
  assert.deepEqual(ok(basic('a\tb')), { a: 'a\tb' });
  assert.deepEqual(ok(lit('a\tb')), { a: 'a\tb' });
});

test('text beyond ASCII is kept as it is, as in the one-line form', () => {
  const body = 'caf\u00e9 \u{1F600} \u202e\u2066 mark';
  assert.deepEqual(ok(basic(body)), { a: body });
  assert.deepEqual(ok('a = "' + body + '"\n'), { a: body }, 'the one-line form does the same');
});

test('a multi-line string works as a value anywhere: a key, a table, an array item, an inline table, and before more keys', () => {
  const v = ok([
    'name = "reviewer"',
    `developer_instructions = ${Q3}`, 'Read the diff.', 'Report "findings".', Q3,
    'tags = [', `  ${Q3}one${Q3},`, `  ${S3}two\\${S3}, # a comment`, ']',
    `inline = { x = ${S3}raw\\${S3}, y = ${Q3}line\\`, `  continues${Q3} }`.replace('\n', ''),
    '[table]', `note = ${Q3}`, `in a table${Q3} # trailing comment`, 'after = 1',
    '[[items]]', `text = ${S3}first${S3}`, '[[items]]', `text = ${S3}second${S3}`,
  ].join('\n') + '\n');
  assert.deepEqual(v.developer_instructions, 'Read the diff.\nReport "findings".\n');
  assert.deepEqual(v.tags, ['one', 'two\\']);
  assert.deepEqual(v.table, { note: 'in a table', after: 1 });
  assert.deepEqual(v.items, [{ text: 'first' }, { text: 'second' }]);
});

test('a multi-line string inside an inline table is read, on one line or over several', () => {
  assert.deepEqual(ok(`x = { a = ${Q3}\nl1\nl2${Q3}, b = 2 }\n`), { x: { a: 'l1\nl2', b: 2 } });
  assert.deepEqual(ok(`x = [ { a = ${S3}p${S3} }, { a = ${S3}q${S3} } ]\n`), { x: [{ a: 'p' }, { a: 'q' }] });
});

test('what follows the closer must be the end of the line, a comment, or a separator', () => {
  assert.deepEqual(ok(`${basic('x').trimEnd()} # fine\n`), { a: 'x' });
  no(`a = ${Q3}x${Q3} b\n`);
  no(`${Q3} = 1\n`, 'TOML_UNSUPPORTED');
  assert.deepEqual(ok('"" = 1\n'), { '': 1 }, 'an empty quoted key is still a key');
});

test('line numbers: a refusal after a multi-line string counts the lines inside it; an unterminated string names the line of its opener', () => {
  assert.equal(no(`a = ${Q3}\nl1\nl2\nl3${Q3}\nb = 0x1f\n`).line, 5);
  assert.equal(no(`a = 1\n\nb = ${Q3}never\nclosed\nat all\n`).line, 3);
  assert.equal(no(`a = 1\nb = ${S3}never\nclosed\n`).line, 2);
  assert.equal(no(`x = { a = ${Q3}never }\n`).line, 1);
  assert.equal(no(`x = [\n  ${S3}never\n`).line, 2);
});

// ---- hostile input ------------------------------------------------------------------------------------------------------

test('a string that is never closed is refused, at any length, with the line of its opener', () => {
  no(`a = ${Q3}`); no(`a = ${S3}`); no(`a = ${Q3}\n`); no(`a = ${Q3}x""`); no(`a = ${S3}x''`);
  no(`a = ${Q3}${'x\n'.repeat(100000)}`);
  assert.equal(no(`a = ${Q3}${'x\n'.repeat(100000)}`).line, 1);
});

test('long runs of quotes are refused quickly, and the runs that are valid are read exactly', () => {
  const start = Date.now();
  for (const n of [6, 7, 8, 9, 10, 100, 100000]) { no(`a = ${Q3}${'"'.repeat(n)}\n`); no(`a = ${S3}${"'".repeat(n)}\n`); }
  assert.ok(Date.now() - start < 2000, 'no slow path');
  assert.deepEqual(ok(`a = ${'"'.repeat(8)}\n`), { a: '""' });
  assert.deepEqual(ok(`a = ${'"'.repeat(6)}\n`), { a: '' });
  assert.deepEqual(ok(`a = ${'"'.repeat(7)}\n`), { a: '"' });
  assert.deepEqual(ok(`a = ${"'".repeat(8)}\n`), { a: "''" });
});

test('a very large body is read in linear time', () => {
  const line = 'x'.repeat(79) + '\n';
  const big = line.repeat(Math.ceil((5 * 1024 * 1024) / line.length));
  const start = Date.now();
  assert.equal(ok(basic(big)).a.length, big.length);
  assert.equal(ok(lit(big)).a.length, big.length);
  const escaped = '\\n'.repeat(1024 * 1024);
  assert.equal(ok(basic(escaped)).a.length, 1024 * 1024);
  assert.ok(Date.now() - start < 8000, `took ${Date.now() - start} ms`);
});

test('NUL, ESC, and DEL are refused; bidi marks are kept as the one-line form keeps them; surrogate and out-of-range escapes are refused', () => {
  no(basic('a\0b')); no(basic('a\x1bb')); no(basic('a\x7fb')); no(lit('a\0b')); no(lit('a\x1bb')); no(lit('a\x7fb'));
  assert.equal(ok(basic('a\u202eb')).a, 'a\u202eb');
  assert.equal(ok(basic('a\\u202eb')).a, 'a\u202eb');
  for (const bad of ['\\u{1F600}', '\\ud83d', '\\ud83d\\ude00', '\\U00110000', '\\UFFFFFFFF', '\\u00E', '\\U0000004']) no(basic(bad));
});

test('a refusal never repeats the text of the string', () => {
  const secretLike = 'sk-synthetic-0123456789abcdef';
  for (const text of [`a = ${Q3}${secretLike}\\q${Q3}\n`, `a = ${Q3}${secretLike}`, `a = ${S3}${secretLike}\0${S3}\n`, `a = ${Q3}${secretLike}${Q3}\na = 1\n`]) {
    const r = parseTomlSubset(text);
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(r).includes('synthetic'), false);
  }
});

test('a depth bomb that mixes in strings is refused as too deep, before it recurses', () => {
  const bomb = `a = ${'['.repeat(80)}${Q3}x${Q3}${']'.repeat(80)}\n`;
  no(bomb, 'TOML_TOO_DEEP');
  no(`a = ${'{ b = '.repeat(70)}${S3}x${S3}${' }'.repeat(70)}\n`, 'TOML_TOO_DEEP');
  assert.deepEqual(ok(`a = ${'['.repeat(10)}${Q3}x${Q3}${']'.repeat(10)}\n`), { a: [[[[[[[[[['x']]]]]]]]]] });
});

test('duplicate keys are still caught around a multi-line string', () => {
  no(`a = ${Q3}x${Q3}\na = ${S3}y${S3}\n`, 'TOML_DUPLICATE');
});

// ---- fuzz ---------------------------------------------------------------------------------------------------------------

function random(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

test('2,000 random documents: the parser never throws and never hangs; a result is a value or a coded refusal', () => {
  const pieces = ['a = ', 'b = ', '[t]\n', '[[u]]\n', Q3, S3, '"', "'", '""', "''", '\\', '\\n', '\\u00e9', '\\ud800', '\\\n', '\n', '\r\n', '\r', '\t', ' ', 'x', 'yz', '{', '}', '[', ']', ',', '=', '.', '#', '\0', '\x1b', '\u202e', '1', '0x1f', 'true', '\u{1F600}'];
  const rnd = random(42);
  const codes = new Set(['TOML_UNSUPPORTED', 'TOML_DUPLICATE', 'TOML_TOO_DEEP']);
  const start = Date.now();
  let accepted = 0;
  for (let n = 0; n < 2000; n += 1) {
    let text = '';
    const length = 1 + Math.floor(rnd() * 24);
    for (let i = 0; i < length; i += 1) text += pieces[Math.floor(rnd() * pieces.length)];
    const r = parseTomlSubset(text);
    if (r.ok) { accepted += 1; assert.equal(typeof r.value, 'object'); } else {
      assert.ok(codes.has(r.code), r.code);
      assert.ok(Number.isInteger(r.line) && r.line >= 1);
      assert.equal(JSON.stringify(r), JSON.stringify({ ok: false, code: r.code, line: r.line }), 'a refusal carries a code and a line only');
    }
  }
  assert.ok(accepted > 20, `the run should accept some documents (${accepted})`);
  assert.ok(Date.now() - start < 10000, `took ${Date.now() - start} ms`);
});

// ---- round trip: parse(serialise(v)) equals v ---------------------------------------------------------------------------

const hex = (code, width) => code.toString(16).padStart(width, '0');
/** The multi-line basic form: every character that needs it is escaped, and no run of three quotes survives. */
function asBasic(value) {
  let out = '';
  const chars = [...value];
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i], code = c.codePointAt(0);
    if (c === '\\') out += '\\\\';
    else if (c === '"') out += chars[i + 1] === '"' || i === chars.length - 1 || chars[i - 1] === '"' ? '\\"' : '"';
    else if (c === '\n') out += '\n';
    else if (c === '\t') out += '\t';
    else if (code < 0x20 || code === 0x7f) out += `\\u${hex(code, 4)}`;
    else out += c;
  }
  return `${Q3}\n${out}${Q3}`;
}
/** The multi-line literal form, for a value with no carriage return, no control character other than tab and line feed, and no three quotes in a row. */
function asLiteral(value) {
  return `${S3}\n${value}${S3}`;
}
const literalFits = value => !/[\0-\x08\x0b-\x1f\x7f]/.test(value) && !value.includes(S3) && !value.endsWith("'''") && !/'{3}/.test(`${value}`);

test('parse(serialise(v)) equals v for 1,500 random strings with line breaks, quotes, backslashes, and Unicode', () => {
  const alphabet = ['a', 'b', ' ', '\n', '\n', '\t', '"', '"', "'", "'", '\\', '\r', '\u00e9', '\u{1F600}', '\u202e', '\0', '\x1b', '#', '=', '[', '{'];
  const rnd = random(7);
  for (let n = 0; n < 1500; n += 1) {
    let v = '';
    const length = Math.floor(rnd() * 30);
    for (let i = 0; i < length; i += 1) v += alphabet[Math.floor(rnd() * alphabet.length)];
    const r1 = parseTomlSubset(`a = ${asBasic(v)}\n`);
    // A lone carriage return is written as an escape, so every value round-trips in the basic form.
    assert.equal(r1.ok, true, JSON.stringify([v, r1]));
    assert.equal(r1.value.a, v, JSON.stringify(v));
    if (literalFits(v) && !v.includes('\r')) {
      const r2 = parseTomlSubset(`a = ${asLiteral(v)}\n`);
      assert.equal(r2.ok, true, JSON.stringify([v, r2]));
      assert.equal(r2.value.a, v, JSON.stringify(v));
    }
  }
});

// ---- Codex agent files adopt --------------------------------------------------------------------------------------------

const AGENT = (name, body, extra = '') => `name = "${name}"\ndescription = "Reviews a change."\n${extra}developer_instructions = ${Q3}\n${body}${Q3}\n`;

test('a Codex agent file with developer_instructions in a multi-line string is adopted, with the body as written', async t => {
  const body = 'Read the diff.\nReport each finding with "evidence".\n\nStop after ten findings.\n';
  const p = project(t, {
    '.codex/agents/reviewer.toml': AGENT('reviewer', body),
    '.codex/agents/folder.toml': `name = "folder"\ndescription = "Folds lines."\ndeveloper_instructions = ${Q3}\\\n  Read the diff, \\\n  then report.\n${Q3}\n`,
    '.codex/agents/raw.toml': `name = "raw"\ndescription = "Keeps text raw."\ndeveloper_instructions = ${S3}\nUse C:\\work\\files and \\n as text.\n${S3}\n`,
  });
  const input = p.input({ engines: [{ id: 'codex' }] });
  const plan = planAdoption(input);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.unmapped.filter(u => u.path.startsWith('.codex/agents/')), [], 'nothing is left out');
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const bodies = Object.fromEntries(r.definition.entries.subagents.map(s => [s.id, s.body]));
  assert.deepEqual(bodies, {
    reviewer: body,
    folder: 'Read the diff, then report.\n',
    raw: 'Use C:\\work\\files and \\n as text.\n',
  });
});

test('round trip: adopt the Codex agent, install it to Codex, adopt again, and the bodies are equal', async t => {
  const body = 'Read the diff.\nReport each finding.\n\n  Indented line stays.\nEnd with "done".\n';
  const a = project(t, { '.codex/agents/reviewer.toml': AGENT('reviewer', body) });
  const first = a.input({ engines: [{ id: 'codex', version: '0.157.0' }] });
  const plan = planAdoption(first);
  await applyAdoption(first, plan.revision, plan.approvalsRequired);
  const one = loadDefinition(a.def);
  assert.equal(one.ok, true, JSON.stringify(one.problems));
  const fresh = path.join(a.base, 'fresh');
  fs.mkdirSync(fresh, { mode: 0o755 });
  const input = { projectDir: fresh, definitionFolder: a.def, stateDir: path.join(a.base, 'state', 'portable'), engines: [{ id: 'codex', version: '0.157.0' }], previewEngines: true };
  const install = planPortable(input);
  await applyPortable(input, install.revision);
  assert.equal(fs.existsSync(path.join(fresh, '.codex/agents/reviewer.toml')), true, 'the agent was written to Codex');
  const second = { projectDir: fresh, stateDir: path.join(a.base, 'state', 'again'), engines: [{ id: 'codex', version: '0.157.0' }] };
  const plan2 = planAdoption(second);
  assert.deepEqual(plan2.unmapped.filter(u => u.path.startsWith('.codex/agents/')), []);
  await applyAdoption(second, plan2.revision, plan2.approvalsRequired);
  const two = loadDefinition(path.join(fresh, '.bowerloom'));
  assert.equal(two.ok, true, JSON.stringify(two.problems));
  assert.equal(one.definition.entries.subagents[0].body, body);
  assert.equal(two.definition.entries.subagents[0].body, one.definition.entries.subagents[0].body);
});

test('a Codex agent file that never closes its string is listed with the reason and the line of the opener, and nothing is adopted from it', t => {
  const p = project(t, { '.codex/agents/broken.toml': `name = "broken"\ndescription = "Never closes."\ndeveloper_instructions = ${Q3}\nRead the diff.\n` });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  const left = plan.unmapped.find(u => u.path === '.codex/agents/broken.toml');
  assert.match(left.reason, /^Line 3 uses a TOML form outside the subset adoption reads \(TOML_UNSUPPORTED\)/);
  assert.doesNotMatch(left.reason, /multi-line strings/, 'the sentence no longer lists multi-line strings');
  assert.equal(plan.items.some(i => i.part === 'subagents'), false);
});

test('a secret-shaped value inside a multi-line body still refuses the file, and the plan never holds the value', t => {
  const token = 'sk-ant-' + 'synthetic0value0'.repeat(2);
  const p = project(t, { '.codex/agents/leaky.toml': AGENT('leaky', `Use the key ${token} when you call the service.\n`) });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  assert.match(plan.unmapped.find(u => u.path === '.codex/agents/leaky.toml').reason, /secret/);
  assert.equal(plan.items.some(i => i.part === 'subagents'), false);
  assert.equal(JSON.stringify(plan).includes(token), false);
});

test('a Codex agent file larger than 1 MiB is listed, not read, even when its body is one multi-line string', t => {
  const p = project(t, { '.codex/agents/huge.toml': AGENT('huge', 'x'.repeat(1024 * 1024 + 10) + '\n') });
  const plan = planAdoption(p.input({ engines: [{ id: 'codex' }] }));
  assert.match(plan.unmapped.find(u => u.path === '.codex/agents/huge.toml').reason, /1 MiB/);
  assert.equal(plan.items.some(i => i.part === 'subagents'), false);
});

// ---- CR LF files with comments ------------------------------------------------------------------------------------------------

test('a file with CR LF line endings reads as one with LF: a comment before CR LF is a comment', () => {
  assert.deepEqual(ok('# top\r\nname = "x"\r\n'), { name: 'x' });
  assert.deepEqual(ok('a = 1 # why\r\nb = 2\r\n'), { a: 1, b: 2 });
  assert.deepEqual(ok('# only a comment\r\n'), {});
  assert.deepEqual(ok('# last line has none\r\na = 1 # no line break at the end'), { a: 1 });
  assert.deepEqual(ok('args = [\r\n  "a", # one\r\n  "b", # two\r\n]\r\n'), { args: ['a', 'b'] });
  assert.deepEqual(ok(`a = ${Q3}\r\nline\r\n${Q3} # after a multi-line string\r\nb = ${S3}raw${S3} # and a literal\r\n`), { a: 'line\n', b: 'raw' });
  assert.deepEqual(ok('[t] # table\r\nx = 1\r\n[[u]] # array\r\ny = 2\r\n'), { t: { x: 1 }, u: [{ y: 2 }] });
  // A carriage return that does not begin CR LF is still refused, in a comment as anywhere.
  no('a = 1 # bad\rb = 2\n');
  no('# bad \r');
  no('a = 1 # \x00\r\n');
});

test('a Codex agent file saved with CR LF, with comments around a multi-line body, is adopted with LF line breaks', async t => {
  const crlf = text => text.replace(/\n/g, '\r\n');
  const p = project(t, {
    '.codex/agents/windows.toml': crlf(`# written on another system\nname = "windows"\ndescription = "Saved with CR LF." # a comment\ndeveloper_instructions = ${Q3}\nRead the diff.\nReport each finding.\n${Q3} # the end\n`),
  });
  const input = p.input({ engines: [{ id: 'codex' }] });
  const plan = planAdoption(input);
  assert.deepEqual(plan.unmapped.filter(u => u.path.startsWith('.codex/agents/')), [], 'nothing is left out');
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.definition.entries.subagents[0].body, 'Read the diff.\nReport each finding.\n');
});
