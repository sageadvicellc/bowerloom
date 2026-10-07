import test from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionError } from '../packages/contracts/src/index.js';
import { RecipeError } from '../packages/recipes/src/types.js';
import { BrokerError } from '../packages/broker/src/index.js';
import { exitCodeFor, newCommandRefusal, plainText, renderRefusal, reportFailure } from '../apps/cli/src/human.js';

const INIT_NEXT = 'bowerloom init plan --mode existing --target <directory> --name <name> --goal <goal>';
const GENERIC_FAILURE = 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.';
const text = (code: string, message: string, sentence: string, next: string): string => `Refused (${code}): ${message}\n${sentence}\nNext: ${next}\n`;

// The terminal text of every M1 refusal code. Each line is the contract a person reads.
const M1: ReadonlyArray<readonly [string, string, string]> = [
  ['USAGE', 'The command line did not match a Bowerloom command, so nothing was changed.', 'bowerloom help'],
  ['APPROVAL_DECLINED', 'You declined, so nothing was changed.', 'run the same command again to see the plan'],
  ['STALE_APPROVAL', 'The plan changed after you saw it, so nothing was applied.', 'run the same command again, without --approve, to see the new plan'],
  ['PROJECT_NOT_FOUND', 'Bowerloom looked in this folder and in every parent folder up to your home folder.', INIT_NEXT],
  ['PROJECT_ROOT_REFUSED', 'A whole disk or home folder is too broad to be a project.', 'cd <project-folder>'],
  ['PROJECT_IN_CLOUD_FOLDER', 'Cloud sync changes file times and moves files, which breaks the checks that keep a project safe.', 'mv <project-folder> ~/Projects/'],
  ['PROJECT_UNSAFE', 'Bowerloom will not trust a .bowerloom folder that other people or links can change.', 'ls -ld .bowerloom'],
  ['PROJECT_UNREADABLE', 'A folder on the way to the project could not be read, so Bowerloom cannot tell which project holds this folder.', 'ls -ld <folder>'],
  ['PROJECT_LOCKED', 'Two commands must not change one project at the same time, so nothing was changed.', 'bowerloom status'],
  ['PROJECT_LOCK_UNAVAILABLE', 'The lock uses a local port, and this computer would not give it out.', 'bowerloom status'],
  ['PROJECT_LOCK_SLOT_COLLISION', 'The lock uses a local port, and another program is listening on it.', 'lsof -nP -iTCP:<port> -sTCP:LISTEN'],
];

test('renderRefusal prints the fixed plain words of each M1 refusal code, with the code kept visible', () => {
  for (const [code, sentence, next] of M1) assert.equal(renderRefusal(code, 'The message.'), text(code, 'The message.', sentence, next), code);
});

test('renderRefusal gives approval and held words only to a refusal a new command raised', () => {
  assert.equal(renderRefusal('APPROVAL_REQUIRED', 'Approve it.', { raisedByNewCommand: true }),
    text('APPROVAL_REQUIRED', 'Approve it.', 'This change needs your approval before it is applied.', 'run the same command again with --approve <revision>'));
  assert.equal(renderRefusal('WORKERS_HELD', 'Held.', { raisedByNewCommand: true }),
    text('WORKERS_HELD', 'Held.', 'The project is prepared. No worker was started.', 'bowerloom status'));
  const plumbing = renderRefusal('APPROVAL_REQUIRED', 'Approve it.');
  assert.equal(plumbing, text('APPROVAL_REQUIRED', 'Approve it.', 'This command needs a current approval for the exact action before it runs.', 'bowerloom help advanced'));
  assert.equal(plumbing.includes('--approve'), false);
  assert.equal(renderRefusal('WORKERS_HELD', 'Held.'), text('WORKERS_HELD', 'Held.', 'Nothing more is known about this refusal beyond its code.', 'bowerloom help'));
});

test('renderRefusal names the port of a slot collision when the error carries one', () => {
  assert.equal(renderRefusal('PROJECT_LOCK_SLOT_COLLISION', 'Taken.', { port: 23456 }),
    text('PROJECT_LOCK_SLOT_COLLISION', 'Taken.', 'The lock uses a local port, and another program is listening on port 23456.', 'lsof -nP -iTCP:23456 -sTCP:LISTEN'));
  for (const port of [0, 65536, 1.5, -1, Number.NaN]) assert.match(renderRefusal('PROJECT_LOCK_SLOT_COLLISION', 'Taken.', { port }), /TCP:<port>/, String(port));
});

test('an unknown code gets the generic words', () => {
  assert.equal(renderRefusal('SOMETHING_ELSE', 'Odd.'), text('SOMETHING_ELSE', 'Odd.', 'Nothing more is known about this refusal beyond its code.', 'bowerloom help'));
});

test('plainText escapes C0, C1, DEL and bidi controls and keeps everything else', () => {
  assert.equal(plainText('a\x1b[31mred\x07\x00\t\r\nb'), 'a\\u001b[31mred\\u0007\\u0000\\u0009\\u000d\\u000ab');
  assert.equal(plainText('\x7f\x80\x9b\x9f'), '\\u007f\\u0080\\u009b\\u009f');
  assert.equal(plainText('\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069'), '\\u061c\\u200e\\u200f\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069');
  assert.equal(plainText('Café, 東京, emoji 🌿, quote " and slash \\ stay'), 'Café, 東京, emoji 🌿, quote " and slash \\ stay');
  assert.equal(plainText('line one\nline\x1b two', true), 'line one\nline\\u001b two', 'multiline keeps the newline only');
  assert.equal(plainText('a\r\nb', true), 'a\\u000d\nb');
});

test('renderRefusal escapes control bytes in the code and the message', () => {
  const out = renderRefusal('SCHEMA_INVALID', 'key \x1b]0;title\x07 \u202egnp.exe \x9b31m');
  assert.equal(out, text('SCHEMA_INVALID', 'key \\u001b]0;title\\u0007 \\u202egnp.exe \\u009b31m', 'Nothing more is known about this refusal beyond its code.', 'bowerloom help'));
  assert.doesNotMatch(out.replace(/\n/g, ''), /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
  assert.equal(renderRefusal('BAD\x1bCODE', 'm').startsWith('Refused (BAD\\u001bCODE): m\n'), true);
});

test('exitCodeFor: 0 done, 1 refused, 2 usage, 3 approval required, 4 held, and 3 and 4 only for new commands', () => {
  assert.equal(exitCodeFor(null), 0);
  assert.equal(exitCodeFor(new DefinitionError('PROJECT_LOCKED', 'x')), 1);
  assert.equal(exitCodeFor(new DefinitionError('USAGE', 'x')), 2);
  assert.equal(exitCodeFor(newCommandRefusal('APPROVAL_REQUIRED', 'x')), 3);
  assert.equal(exitCodeFor(newCommandRefusal('WORKERS_HELD', 'x')), 4);
  // Existing plumbing keeps exit 1 for its own APPROVAL_REQUIRED (recipes, broker, controlled tests).
  assert.equal(exitCodeFor(new RecipeError('APPROVAL_REQUIRED')), 1);
  assert.equal(exitCodeFor(new BrokerError('APPROVAL_REQUIRED', 'A current approval for the exact action is required.')), 1);
  assert.equal(exitCodeFor(Object.assign(new Error('APPROVAL_REQUIRED'), { code: 'APPROVAL_REQUIRED' })), 1);
  assert.equal(exitCodeFor(new DefinitionError('APPROVAL_REQUIRED', 'x')), 1, 'the code string alone never gives 3');
  assert.equal(exitCodeFor(new DefinitionError('WORKERS_HELD', 'x')), 1, 'the code string alone never gives 4');
  // The marker belongs to the one error object a new command raised: a copy, a child or a look-alike is not marked.
  const marked = newCommandRefusal('APPROVAL_REQUIRED', 'x');
  assert.equal(exitCodeFor({ ...marked, code: 'APPROVAL_REQUIRED' }), 1);
  assert.equal(exitCodeFor(Object.create(marked)), 1);
  for (const value of [undefined, 'APPROVAL_REQUIRED', 3, {}, { code: 'USAGE' }]) assert.equal(exitCodeFor(value), value !== null && typeof value === 'object' && 'code' in value ? 2 : 1, String(value));
});

test('newCommandRefusal accepts only the two gate codes', () => {
  assert.throws(() => newCommandRefusal('USAGE' as 'WORKERS_HELD', 'x'), TypeError);
  const error = newCommandRefusal('WORKERS_HELD', 'Held.');
  assert.ok(error instanceof DefinitionError); assert.equal(error.code, 'WORKERS_HELD'); assert.equal(error.message, 'Held.');
});

test('reportFailure on a pipe prints the JSON envelope, unchanged, with the right exit code', () => {
  assert.deepEqual(reportFailure(new DefinitionError('PROJECT_LOCKED', 'Busy.'), false), { text: '{"error":{"code":"PROJECT_LOCKED","message":"Busy."}}\n', exitCode: 1 });
  assert.deepEqual(reportFailure(newCommandRefusal('APPROVAL_REQUIRED', 'Approve.'), false), { text: '{"error":{"code":"APPROVAL_REQUIRED","message":"Approve."}}\n', exitCode: 3 });
  assert.deepEqual(reportFailure(newCommandRefusal('WORKERS_HELD', 'Held.'), false), { text: '{"error":{"code":"WORKERS_HELD","message":"Held."}}\n', exitCode: 4 });
  // The recipe case of the M1 review: exit 1, as at 231a951.
  assert.deepEqual(reportFailure(new RecipeError('APPROVAL_REQUIRED'), false), { text: `${JSON.stringify({ error: { code: 'APPROVAL_REQUIRED', message: GENERIC_FAILURE } })}\n`, exitCode: 1 });
  // JSON keeps the exact bytes of the message: escaping is JSON's own, no plain-text rewrite.
  const raw = 'key \x1b[31m\u202e';
  assert.equal(reportFailure(new DefinitionError('SCHEMA_INVALID', raw), false).text, `${JSON.stringify({ error: { code: 'SCHEMA_INVALID', message: raw } })}\n`);
  assert.deepEqual(reportFailure('a string', false), { text: `${JSON.stringify({ error: { code: 'IO_ERROR', message: GENERIC_FAILURE } })}\n`, exitCode: 1 });
  assert.equal(reportFailure(null, false).exitCode, 1, 'a thrown null is never exit 0');
  assert.equal(reportFailure(undefined, false).exitCode, 1);
});

test('reportFailure on a terminal prints plain words, with the right exit code', () => {
  assert.deepEqual(reportFailure(new DefinitionError('PROJECT_NOT_FOUND', 'No project.'), true), { text: renderRefusal('PROJECT_NOT_FOUND', 'No project.'), exitCode: 1 });
  assert.deepEqual(reportFailure(new DefinitionError('USAGE', 'Use it right.'), true), { text: renderRefusal('USAGE', 'Use it right.'), exitCode: 2 });
  const approval = reportFailure(newCommandRefusal('APPROVAL_REQUIRED', 'Approve.'), true);
  assert.equal(approval.exitCode, 3); assert.match(approval.text, /Next: run the same command again with --approve <revision>\n$/);
  assert.equal(reportFailure(newCommandRefusal('WORKERS_HELD', 'Held.'), true).exitCode, 4);
  // The recipe case: exit 1 and never the --approve hint, since `recipe run` takes no such flag.
  for (const error of [new RecipeError('APPROVAL_REQUIRED'), new BrokerError('APPROVAL_REQUIRED', 'm'), new DefinitionError('APPROVAL_REQUIRED', 'm')]) {
    const failure = reportFailure(error, true);
    assert.equal(failure.exitCode, 1, error.name); assert.equal(failure.text.includes('--approve'), false, error.name); assert.match(failure.text, /^Refused \(APPROVAL_REQUIRED\): /);
  }
  const port = reportFailure(Object.assign(new DefinitionError('PROJECT_LOCK_SLOT_COLLISION', 'Another program holds local port 23456.'), { port: 23456 }), true);
  assert.equal(port.exitCode, 1); assert.match(port.text, /listening on port 23456\.\nNext: lsof -nP -iTCP:23456 -sTCP:LISTEN\n$/);
  const escaped = reportFailure(new DefinitionError('SCHEMA_INVALID', 'key \x1b[31m'), true);
  assert.equal(escaped.text.includes('\x1b'), false); assert.match(escaped.text, /key \\u001b\[31m/);
  assert.deepEqual(reportFailure(new Error('raw \x1b detail'), true), { text: renderRefusal('IO_ERROR', GENERIC_FAILURE), exitCode: 1 });
});
