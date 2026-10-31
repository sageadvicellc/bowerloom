import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DefinitionError } from '../packages/contracts/src/index.js';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { ADOPTION_REFUSAL_CODES } from '../packages/adoption/src/index.js';
import { HARNESS_STATE_REFUSAL_CODES, PORTABLE_REFUSAL_CODES } from '../packages/project-sync/src/index.js';

// Step 5 of 0.8, lane C: plain words for every refusal code of the harness commands. The three exported code lists are the
// source of truth, so a code added to any of them fails here until it has an entry in REFUSALS (apps/cli/src/human.ts) and a
// row in the errors reference.
const GENERIC = 'Nothing more is known about this refusal beyond its code.';
const CODES: readonly string[] = [...ADOPTION_REFUSAL_CODES, ...PORTABLE_REFUSAL_CODES, ...HARNESS_STATE_REFUSAL_CODES];
const VERBS = ['status', 'adopt', 'install', 'accept', 'merge', 'drift', 'remove', 'recover'];
const humanSource = readFileSync(new URL('../../apps/cli/src/human.ts', import.meta.url), 'utf8');
const errorsPage = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');
const stripTicks = (value: string): string => value.replace(/`/g, '');
/** The sentence and the next step of a code, read back from the terminal text. */
function wordsOf(code: string, detail: Parameters<typeof renderRefusal>[2] = {}): { sentence: string; next: string; text: string } {
  const text = renderRefusal(code, 'The message.', detail);
  const lines = text.split('\n');
  assert.equal(lines.length, 4, `${code}: Refused line, sentence, Next line, and a final newline`);
  assert.equal(lines[0], `Refused (${code}): The message.`, code);
  assert.ok(lines[2]!.startsWith('Next: '), code);
  return { sentence: lines[1]!, next: lines[2]!.slice('Next: '.length), text };
}

test('the three code lists are not empty and hold the codes added since the blueprint', () => {
  assert.ok(ADOPTION_REFUSAL_CODES.length >= 23, String(ADOPTION_REFUSAL_CODES.length));
  assert.ok(PORTABLE_REFUSAL_CODES.length >= 27, String(PORTABLE_REFUSAL_CODES.length));
  assert.deepEqual([...HARNESS_STATE_REFUSAL_CODES].sort(), ['HARNESS_APPROVAL_STALE', 'HARNESS_STATE_TWO_RECORDS']);
  for (const code of ['ADOPTION_MERGE_NOTHING', 'ADOPTION_INSTRUCTIONS_TOO_LARGE']) assert.ok((ADOPTION_REFUSAL_CODES as readonly string[]).includes(code), code);
  assert.ok((PORTABLE_REFUSAL_CODES as readonly string[]).includes('PORTABLE_MODE_UNSAFE'));
  assert.equal(new Set(CODES).size, CODES.length, 'no code sits in two lists');
});

test('every adoption, install, and harness state code has its own words and a next step, never the generic ones', () => {
  for (const code of CODES) {
    const { sentence, next, text } = wordsOf(code);
    assert.notEqual(sentence, GENERIC, code);
    assert.doesNotMatch(text, /Next: bowerloom help\n$/, code);
    assert.match(sentence, /^[A-Z].*[.]$/, code);
    assert.ok(next.length > 0, code);
  }
});

test('the words follow the house style: plain, no should or may, no contractions, no line break inside a value', () => {
  for (const code of CODES) {
    const { sentence, next } = wordsOf(code);
    for (const [name, value] of [['sentence', sentence], ['next', next]] as const) {
      assert.doesNotMatch(value, /\b(?:should|may|might)\b/i, `${code} ${name}`);
      assert.doesNotMatch(value, /\w['’]\w/, `${code} ${name}: a contraction or a possessive`);
      assert.doesNotMatch(value, /[\n\r]/, `${code} ${name}`);
    }
  }
});

test('REFUSALS holds an entry for each code of the three lists and for no other adoption, install, or harness state code', () => {
  const keys = [...humanSource.matchAll(/^ {2}((?:ADOPTION|PORTABLE|HARNESS)_[A-Z0-9_]+): \{ sentence:/gm)].map(m => m[1]!);
  assert.equal(new Set(keys).size, keys.length, 'no key twice');
  assert.deepEqual([...keys].sort(), [...CODES].sort());
});

test('a next step that names a bowerloom harness command names one that exists', () => {
  let named = 0;
  for (const code of CODES) {
    const { next } = wordsOf(code);
    for (const m of next.matchAll(/bowerloom (harness|help harness)\b(?: ([a-z]+))?/g)) {
      if (m[1] === 'help harness') continue;
      named += 1;
      assert.ok(VERBS.includes(m[2] ?? ''), `${code}: ${m[0]}`);
    }
  }
  assert.ok(named > 20, String(named));
});

test('the next steps that the blueprint names are the ones printed', () => {
  const steps: ReadonlyArray<readonly [string, string]> = [
    ['ADOPTION_DEFINED', 'bowerloom harness install'],
    ['ADOPTION_CHOICE_INVALID', 'bowerloom harness adopt'],
    ['ADOPTION_CHOICE_REQUIRED', '--pick'],
    ['ADOPTION_CHOICE_REQUIRED', '--rename'],
    ['ADOPTION_DEFINITION_INVALID', 'bowerloom harness adopt --json'],
    ['ADOPTION_PARTIAL', 'bowerloom harness recover --adoption'],
    ['ADOPTION_RECOVERY_REQUIRED', 'bowerloom harness recover --adoption'],
    ['ADOPTION_RECOVER_NOTHING', 'bowerloom harness status'],
    ['ADOPTION_APPROVAL_REQUIRED', '--confirm'],
    ['ADOPTION_ACKNOWLEDGEMENT_REQUIRED', '--acknowledge'],
    ['ADOPTION_MERGE_NOTHING', 'bowerloom harness status'],
    ['ADOPTION_INSTRUCTIONS_TOO_LARGE', 'bowerloom harness merge'],
    ['ADOPTION_USAGE', 'bowerloom help harness'],
    ['PORTABLE_USAGE', 'bowerloom help harness'],
    ['PORTABLE_DEFINITION_INVALID', 'bowerloom harness status'],
    ['PORTABLE_MERGE_NOT_BUILT', 'bowerloom harness merge'],
    ['PORTABLE_MANAGED_COPY', 'bowerloom harness adopt'],
    ['PORTABLE_MANAGED_COPY', 'remove the 0.7 prompt'],
    ['PORTABLE_FIDELITY', 'bowerloom harness accept <line-key>'],
    ['PORTABLE_DRIFT', 'bowerloom harness drift'],
    ['PORTABLE_RECOVERY_REQUIRED', 'bowerloom harness recover'],
    ['PORTABLE_PARTIAL', 'bowerloom harness recover'],
    ['PORTABLE_LOCK_LOST', 'bowerloom harness recover'],
    ['PORTABLE_NOTHING_PROJECTED', 'bowerloom harness status'],
    ['PORTABLE_RECOVER_NOTHING', 'bowerloom harness drift'],
    ['PORTABLE_STATE_INVALID', 'bowerloom harness recover'],
    ['PORTABLE_MODE_UNSAFE', '--restore-mode'],
    ['PORTABLE_MODE_UNSAFE', '--record-mode'],
    ['HARNESS_APPROVAL_STALE', 'bowerloom harness accept <line-key>'],
  ];
  for (const [code, part] of steps) assert.ok(wordsOf(code).next.includes(part), `${code}: ${part}`);
});

test('the words say what the code refuses (spot checks against the messages)', () => {
  assert.match(wordsOf('PORTABLE_MODE_UNSAFE').sentence, /group or others write/);
  assert.match(wordsOf('ADOPTION_MERGE_NOTHING').sentence, /CLAUDE\.md/);
  assert.match(wordsOf('ADOPTION_INSTRUCTIONS_TOO_LARGE').sentence, /32 KiB/);
  assert.match(wordsOf('PORTABLE_INSTRUCTIONS_TOO_LARGE').sentence, /32 KiB/);
  assert.match(wordsOf('ADOPTION_OPENCODE_VERSION').sentence, /1\.18\.30/);
  assert.match(wordsOf('ADOPTION_DSH_TAG').sentence, /0\.2\.2-alpha\.2/);
  assert.match(wordsOf('HARNESS_STATE_TWO_RECORDS').sentence, /Two private records/);
  assert.match(wordsOf('HARNESS_APPROVAL_STALE').sentence, /changed, or is gone/);
});

test('the two partial codes take the partial words and the next step that the error carries', () => {
  for (const [code, next] of [['ADOPTION_PARTIAL', 'Run bowerloom harness recover --adoption.'], ['PORTABLE_PARTIAL', 'Run bowerloom harness recover.']] as const) {
    assert.equal(renderRefusal(code, 'Left over: a.', { hint: 'partial', next }), `Refused (${code}): Left over: a.\nThe run stopped part way; the message lists what was written.\nNext: ${next}\n`, code);
    // Without the hint, the code still has its own words and the recover command.
    assert.match(wordsOf(code).next, /^bowerloom harness recover/, code);
    // On a pipe, the envelope carries partial: true and the next step.
    const error = Object.assign(new DefinitionError(code, 'Left over: a.'), { hint: 'partial', next });
    const json = JSON.parse(reportFailure(error, false).text) as { error: { code: string; next?: string; partial?: boolean } };
    assert.deepEqual(json.error, { code, message: 'Left over: a.', next, partial: true });
    assert.equal(reportFailure(error, true).text, renderRefusal(code, 'Left over: a.', { hint: 'partial', next }), code);
  }
});

test('a pipe keeps the JSON envelope of each code, and a terminal gets the words', () => {
  for (const code of CODES) {
    const error = new DefinitionError(code, 'The message.');
    assert.equal(reportFailure(error, false).text, `${JSON.stringify({ error: { code, message: 'The message.' } })}\n`, code);
    assert.equal(reportFailure(error, true).text, renderRefusal(code, 'The message.'), code);
    assert.equal(reportFailure(error, true).exitCode, 1, code);
  }
});

test('an error that carries its own next step keeps the sentence of its code', () => {
  assert.equal(renderRefusal('PORTABLE_DRIFT', 'm', { next: 'bowerloom harness drift --check' }), `Refused (PORTABLE_DRIFT): m\n${wordsOf('PORTABLE_DRIFT').sentence}\nNext: bowerloom harness drift --check\n`);
});

test('every code has a row in the errors reference that says what the terminal says', () => {
  const lines = errorsPage.split('\n');
  for (const code of CODES) {
    const { sentence, next } = wordsOf(code);
    const rows = lines.filter(l => l.startsWith(`| \`${code}\` |`));
    assert.equal(rows.length, 1, `${code}: one row`);
    const cells = stripTicks(rows[0]!).split(' | ');
    assert.equal(cells.length, 3, code);
    assert.equal(cells[1], sentence, `${code}: meaning`);
    assert.equal(cells[2]!.replace(/ \|$/, ''), next, `${code}: next action`);
  }
});

test('the errors reference ticks every placeholder in a harness row', () => {
  for (const code of CODES) {
    const row = errorsPage.split('\n').find(l => l.startsWith(`| \`${code}\` |`))!;
    assert.doesNotMatch(row.replace(/`[^`]*`/g, ''), /[<>]/, code);
  }
});
