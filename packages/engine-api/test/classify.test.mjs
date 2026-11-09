// Every code-like literal in the golden file is classified, and each is classified once. A literal that is none of the three kinds fails here, so a new code
// in the base cannot slip past the contract unseen.
//  1. A contract refusal: it is in one of the tables of the contract (src/refusals.ts).
//  2. An open package code: it starts with the prefix of a package the engine passes through, and it is not in a table of the contract. The contract fixes the format of
//     these, not the list.
//  3. A named known non-code: it is in the list below, with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_CALL_REFUSAL_CODES, ENGINE_CODE_FORMAT, ENGINE_MAIN_ANSWER_REFUSAL_CODES, ENGINE_MAIN_REFUSAL_CODES, ENGINE_REFUSAL_STEPS, NAMED_OUTCOMES, engineRefusalCodes, readerRefusalCodes,
} from '../../../dist/packages/engine-api/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const golden = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'engine-api', 'golden', 'base-d4c8a478.json'), 'utf8'));

/** The prefixes of the packages whose codes the engine passes through. */
const PACKAGE_PREFIXES = ['ADOPTION_', 'PORTABLE_', 'SAVE_', 'EDIT_', 'VERSION_', 'NOTES_', 'BUNDLE_'];

/** Literals that are not refusal codes, by group, each with its reason. */
const KNOWN_NON_CODES = [
  { why: 'the name of an environment variable, written in a sample text', names: ['LOG_LEVEL', 'NODE_OPTIONS'] },
  { why: 'a made-up key, region or name inside a sample text of the sample engine', names: ['ORDERS_KEY', 'YARD_REGION', 'FILES_SERVER_CACHE_DIRECTORY_FOR_THE_WEEKLY_REPORT_PROJECT_AND_ITS_DRAFTS'] },
  { why: 'a Node error code that the worker host reads to tell why a thread stopped; it never reaches the window', names: ['ERR_MODULE_NOT_FOUND', 'ERR_WORKER_INIT_FAILED', 'ERR_WORKER_OUT_OF_MEMORY', 'ERR_WORKER_PATH', 'MODULE_NOT_FOUND'] },
  { why: 'the mark a held-bundle worker refuses with; main maps it to UNKNOWN_BUNDLE before it answers (main/engine-bundle.ts), so the window never sees it', names: ['UNKNOWN_BUNDLE_HELD'] },
  { why: 'a problem code of a definition file, shown inside the words of a path as "(SECRET_VALUE)"; it is not a refusal code', names: ['SECRET_VALUE'] },
];
const nonCodes = new Set(KNOWN_NON_CODES.flatMap(g => g.names));

const contractCodes = () => new Set([...engineRefusalCodes(), ...readerRefusalCodes(), ...ENGINE_REFUSAL_STEPS]);
const isOpenPackageCode = (code, contract) => !contract.has(code) && PACKAGE_PREFIXES.some(p => code.startsWith(p));

/** The kinds a code has. A code is well classified when this holds exactly one. */
function kindsOf(code, contract = contractCodes()) {
  const kinds = [];
  if (contract.has(code)) kinds.push('contract refusal');
  if (isOpenPackageCode(code, contract)) kinds.push('open package code');
  if (nonCodes.has(code)) kinds.push('known non-code');
  return kinds;
}

test('every code literal of the golden file is exactly one of: contract refusal, open package code, known non-code', () => {
  const contract = contractCodes();
  assert.ok(golden.codeLiterals.length > 80);
  const bad = golden.codeLiterals.filter(code => kindsOf(code, contract).length !== 1).map(code => `${code}: ${kindsOf(code, contract).join(' and ') || 'none'}`);
  assert.deepEqual(bad, []);
});

test('a literal of no kind fails the check, and so does one of two kinds', () => {
  const contract = contractCodes();
  assert.deepEqual(kindsOf('BRAND_NEW_CODE', contract), []);
  assert.deepEqual(kindsOf('SAVE_BRAND_NEW', contract), ['open package code']);
  assert.deepEqual(kindsOf('NOT_THE_FOLDER_SHOWN', contract), ['contract refusal']);
  assert.deepEqual(kindsOf('NOTES_NOT_CHOSEN', contract), ['contract refusal'], 'a code of a table is not also an open package code');
  const crowded = new Set([...contract, 'LOG_LEVEL']);
  assert.deepEqual(kindsOf('LOG_LEVEL', crowded), ['contract refusal', 'known non-code']);
});

test('the list of known non-codes holds only literals the golden file has, each once, and none that a table or a package prefix already claims', () => {
  const literals = new Set(golden.codeLiterals);
  const all = KNOWN_NON_CODES.flatMap(g => g.names);
  assert.equal(new Set(all).size, all.length, 'no name twice');
  const contract = contractCodes();
  for (const name of all) {
    assert.ok(literals.has(name), `${name} is in the golden file`);
    assert.ok(!contract.has(name), `${name} is not in a table`);
    assert.ok(!PACKAGE_PREFIXES.some(p => name.startsWith(p)), `${name} has no package prefix`);
  }
  for (const group of KNOWN_NON_CODES) assert.ok(group.why.length > 20, 'each group has a reason');
});

test('every code the contract names as a main answer or a step is in the golden file, in the code format', () => {
  const literals = new Set(golden.codeLiterals);
  for (const code of [...ENGINE_MAIN_ANSWER_REFUSAL_CODES, ...ENGINE_REFUSAL_STEPS]) {
    assert.ok(literals.has(code), `${code} is a literal of the base`);
    assert.match(code, ENGINE_CODE_FORMAT);
  }
});

test('the new table shares no code with an older table, and no step is also a code', () => {
  const older = new Set([...ENGINE_CALL_REFUSAL_CODES, ...NAMED_OUTCOMES, ...ENGINE_MAIN_REFUSAL_CODES, ...readerRefusalCodes()]);
  for (const code of ENGINE_MAIN_ANSWER_REFUSAL_CODES) assert.ok(!older.has(code), `${code} is in two tables`);
  for (const code of ENGINE_REFUSAL_STEPS) assert.ok(!engineRefusalCodes().has(code) && !readerRefusalCodes().has(code), `${code} is a step, not a code`);
});
