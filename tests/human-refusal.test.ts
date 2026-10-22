import test from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionError } from '../packages/contracts/src/index.js';
import { RecipeError } from '../packages/recipes/src/types.js';
import { BrokerError } from '../packages/broker/src/index.js';
import { exitCodeFor, newCommandJson, newCommandRefusal, plainText, renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { SYNC_REFUSAL_CODES, partialRefusal, syncError } from '../packages/project-sync/src/refusal.js';
import type { SyncCode } from '../packages/project-sync/src/refusal.js';
import { AUTHORING_REFUSAL_CODES } from '../packages/project-authoring/src/index.js';
import { readFileSync } from 'node:fs';
import { CONFIG_REFUSAL_CODES } from '../packages/project-config/src/index.js';

// Review finding 5: the next step for a folder with no project is the up command, not plumbing.
const INIT_NEXT = 'bowerloom up --team <name> --goal <goal>';
const GENERIC_FAILURE = 'The command failed. Review the relevant local files and operation records before another action. This error supplies no registered-work stop result.';
const text = (code: string, message: string, sentence: string, next: string): string => `Refused (${code}): ${message}\n${sentence}\nNext: ${next}\n`;

// The terminal text of every M1 refusal code. Each line is the contract a person reads.
const M1: ReadonlyArray<readonly [string, string, string]> = [
  ['USAGE', 'Nothing was changed.', 'bowerloom help'],
  ['APPROVAL_DECLINED', 'Bowerloom applies a plan only when you answer y.', 'run the same command again to see the plan'],
  ['STALE_APPROVAL', 'The plan changed after you saw it, so nothing was applied.', 'run the same command again, without --approve, to see the new plan'],
  ['PROJECT_NOT_FOUND', 'Bowerloom looked in this folder and in every parent folder up to your home folder.', INIT_NEXT],
  ['PROJECT_ROOT_REFUSED', 'A whole disk or home folder is too broad to be a project.', 'cd <project-folder>'],
  ['PROJECT_IN_CLOUD_FOLDER', 'Cloud sync changes file times and moves files, which breaks the checks that keep a project safe.', 'mv <project-folder> ~/Projects/'],
  ['PROJECT_UNSAFE', 'Bowerloom will not trust a .bowerloom folder that other people or links can change.', 'ls -ld .bowerloom'],
  ['PROJECT_UNREADABLE', 'A folder on the way to the project could not be read, so Bowerloom cannot tell which project holds this folder.', 'ls -ld <folder>'],
  ['PROJECT_LOCKED', 'Two commands must not change one project at the same time, so nothing was changed.', 'bowerloom status'],
  ['PROJECT_LOCK_UNAVAILABLE', 'The lock uses a local port, and this computer would not give it out.', 'bowerloom status'],
  ['PROJECT_LOCK_SLOT_COLLISION', 'The lock uses a local port. Another program listens on it, or another Bowerloom command is too busy to answer.', 'lsof -nP -iTCP:<port> -sTCP:LISTEN'],
  // Spec 03, the store foundation: the store and the project config.
  ['STORE_NOT_FOUND', 'The first --global create or skills add makes the store.', 'bowerloom skill create <name> --global'],
  ['STORE_INVALID', 'If ~/.bowerloom holds no store.json that Bowerloom wrote, Bowerloom does not use it and never takes over the folder.', 'bowerloom store status'],
  ['STORE_UNSAFE', 'Bowerloom will not trust a store that other people or links can change.', 'ls -ld ~/.bowerloom'],
  ['STORE_UNREADABLE', 'A folder that cannot be read cannot be checked, so Bowerloom does not use it.', 'ls -ld ~ ~/.bowerloom'],
  ['STORE_IN_CLOUD_FOLDER', 'Cloud sync changes file times and moves files, which breaks the checks that keep the store safe.', 'Move the home folder setup out of iCloud. The store must stay at ~/.bowerloom.'],
  ['STORE_NOT_A_PROJECT', 'Run this command in a project folder outside ~/.bowerloom.', 'cd <project-folder>'],
  // Spec 04, store writes.
  ['STORE_STATE_NESTED', 'Bowerloom keeps the cache outside the store, so a store inside the state folder, or the reverse, is refused.', 'Set XDG_STATE_HOME to a folder outside ~/.bowerloom.'],
  ['STORE_LOCKED', 'Two commands must not change the store at the same time, so nothing was changed.', 'When the other command is done, run this one again.'],
  ['MANIFEST_LIMIT', 'This beta keeps skills.json small: 128 skills and 1 MiB at most.', 'bowerloom skills check'],
  ['STORE_WRITE_FAILED', 'The disk refused the write. The message names the system error.', 'df -h ~ && ls -ld ~/.bowerloom'],
  ['CONFIG_INVALID', 'Bowerloom reads bowerloom.json strictly, so a hand edit can break it.', 'git diff bowerloom.json'],
  ['CONFIG_UNSAFE', 'Bowerloom will not trust a bowerloom.json that other people or links can change.', 'ls -l bowerloom.json'],
  ['PROJECT_FOLDER_UNSAFE', 'Bowerloom will not trust a project folder that other people can change.', 'ls -ld .'],
  ['CONFIG_UNREADABLE', 'A file that cannot be read cannot be checked, so Bowerloom does not use it.', 'ls -l bowerloom.json'],
  ['CONFIG_LIMIT', 'This beta keeps bowerloom.json small: 128 skills, 128 prompts, and 32 teams at most.', 'bowerloom status'],
  ['CONFIG_DUPLICATE_ID', 'Each item is listed once, from one source.', 'git diff bowerloom.json'],
  // Spec 05, Part B: registered folders.
  ['FOLDER_NAME_INVALID', 'The name becomes a file name in your store.', 'bowerloom help context'],
  ['FOLDER_EXISTS', 'Each registered folder needs its own name.', 'bowerloom folder list'],
  ['FOLDER_NOT_FOUND', 'Only a registered folder can be used or removed.', 'bowerloom folder list'],
  ['FOLDER_UNSAFE', 'Bowerloom reads only folders that you own and that no other user can change.', 'ls -ld <folder>'],
  ['FOLDER_IN_CLOUD', 'Cloud sync changes file times and moves files, which breaks the checks that keep a folder safe.', 'mv <folder> ~/Projects/'],
  ['FOLDER_INVALID', 'Bowerloom reads folder records strictly, so a hand edit can break one.', 'bowerloom folder list'],
  ['FOLDER_NOT_ALLOWED', 'A registered folder is shared with the projects you allow, one by one.', 'bowerloom folder allow <folder-name>'],
];

test('renderRefusal prints the fixed plain words of each M1 refusal code, with the code kept visible', () => {
  for (const [code, sentence, next] of M1) assert.equal(renderRefusal(code, 'The message.'), text(code, 'The message.', sentence, next), code);
});

test('a store MANIFEST_LIMIT points at skills check --global', () => {
  assert.equal(renderRefusal('MANIFEST_LIMIT', 'm', { hint: 'store-limit' }), text('MANIFEST_LIMIT', 'm', 'This beta keeps the store skills.json small: 256 skills and 4 MiB at most.', 'bowerloom skills check --global'));
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
    text('PROJECT_LOCK_SLOT_COLLISION', 'Taken.', 'The lock uses local port 23456. Another program listens on it, or another Bowerloom command is too busy to answer.', 'lsof -nP -iTCP:23456 -sTCP:LISTEN'));
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

test('plainText also escapes every other format character and the line and paragraph separators (review M1F 2)', () => {
  // Zero-width space, joiners, word joiner and invisible operators, the byte order mark, soft hyphen, U+2028, U+2029.
  assert.equal(plainText('a\u200bb\u200cc\u200dd\u2060e\u2061f\u2064g\ufeffh\u00adi\u2028j\u2029k'), 'a\\u200bb\\u200cc\\u200dd\\u2060e\\u2061f\\u2064g\\ufeffh\\u00adi\\u2028j\\u2029k');
  // A tag character sits outside the basic plane: both halves are written, so nothing is lost or left half-printed.
  assert.equal(plainText('x\u{e0041}y'), 'x\\udb40\\udc41y');
  assert.equal(plainText('one\ntwo\u2028three', true), 'one\ntwo\\u2028three', 'multiline keeps only the newline');
  assert.equal(plainText('Café 🌿 東京'), 'Café 🌿 東京');
  assert.doesNotMatch(plainText('\u0000\u001f\u007f\u0085\u009f\u061c\u180e\u200b\u202e\u2066\u206f\ufeff\ufff9\u{1d173}\u{e007f}\u2028\u2029'), /[\p{Cc}\p{Cf}\u2028\u2029]/u);
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
  // Review finding 4: in a terminal, exit 4 is the successful end of up. It prints no Refused block.
  assert.deepEqual(reportFailure(newCommandRefusal('WORKERS_HELD', 'Held.'), true), { text: '', exitCode: 4 });
  // The recipe case: exit 1 and never the --approve hint, since `recipe run` takes no such flag.
  for (const error of [new RecipeError('APPROVAL_REQUIRED'), new BrokerError('APPROVAL_REQUIRED', 'm'), new DefinitionError('APPROVAL_REQUIRED', 'm')]) {
    const failure = reportFailure(error, true);
    assert.equal(failure.exitCode, 1, error.name); assert.equal(failure.text.includes('--approve'), false, error.name); assert.match(failure.text, /^Refused \(APPROVAL_REQUIRED\): /);
  }
  const port = reportFailure(Object.assign(new DefinitionError('PROJECT_LOCK_SLOT_COLLISION', 'Another program holds local port 23456.'), { port: 23456 }), true);
  assert.equal(port.exitCode, 1); assert.match(port.text, /another Bowerloom command is too busy to answer\.\nNext: lsof -nP -iTCP:23456 -sTCP:LISTEN\n$/);
  const escaped = reportFailure(new DefinitionError('SCHEMA_INVALID', 'key \x1b[31m'), true);
  assert.equal(escaped.text.includes('\x1b'), false); assert.match(escaped.text, /key \\u001b\[31m/);
  assert.deepEqual(reportFailure(new Error('raw \x1b detail'), true), { text: renderRefusal('IO_ERROR', GENERIC_FAILURE), exitCode: 1 });
});

test('newCommandJson escapes C1, format characters and the separators, and parses to the same value; the plumbing envelope stays byte-identical (lead call 5)', () => {
  const value = { name: 'a\u0085b\u202ec\u200dd\u2029e\u{e0001}f\u001bg', plain: 'Café 🌿', n: 1 };
  const text = newCommandJson(value);
  assert.ok(text.endsWith('\n')); assert.doesNotMatch(text, /[\p{Cc}\p{Cf}\u2028\u2029](?!$)/u);
  assert.deepEqual(JSON.parse(text), value);
  assert.equal(text, '{"n":1,"name":"a\\u0085b\\u202ec\\u200dd\\u2029e\\udb40\\udc01f\\u001bg","plain":"Café 🌿"}\n');
  // A plumbing refusal on a pipe keeps today's envelope exactly: JSON.stringify of the code and message.
  const error = new DefinitionError('PLUMBING_CODE', 'kept \u202e as is');
  assert.equal(reportFailure(error, false).text, `${JSON.stringify({ error: { code: 'PLUMBING_CODE', message: 'kept \u202e as is' } })}\n`);
});

// Review finding 14: every refusal code of sync, apply and create has words of its own, never the generic ones.
test('every sync, apply and create refusal code has its own plain words and next step', () => {
  const generic = 'Nothing more is known about this refusal beyond its code.';
  for (const code of [...SYNC_REFUSAL_CODES, ...AUTHORING_REFUSAL_CODES]) {
    const text = renderRefusal(code, 'The message.');
    assert.doesNotMatch(text, new RegExp(generic.replace(/\./g, '\\.')), code);
    if (code !== 'USAGE') assert.doesNotMatch(text, /Next: bowerloom help\n$/, code);
  }
  for (const code of ['MANAGED_SKILL_STALE_APPROVAL', 'MANAGED_SKILL_LOCKED', 'MANAGED_SKILL_LOCK_NOT_HELD', 'MANAGED_SKILL_LOCK_SLOT_COLLISION', 'MANAGED_SKILL_ABORTED', 'MANAGED_SKILL_TIMEOUT', 'MANAGED_SKILL_REFUSED']) {
    assert.ok(SYNC_REFUSAL_CODES.includes(code as never), code);
    assert.match(renderRefusal(code, 'm.'), /^Refused \([A-Z_]+\): m\.\n[A-Z][^\n]+\.\nNext: [^\n]+\n$/, code);
  }
});

// Review finding 13: no refusal says the same thing twice.
test('the declined, usage and offline refusals do not repeat themselves', () => {
  const declined = renderRefusal('APPROVAL_DECLINED', 'You declined the plan. Nothing was changed.');
  assert.equal(declined.match(/nothing was changed/gi)?.length, 1, declined);
  const offline = renderRefusal('SKILLS_OFFLINE', 'A pinned skill is not in this machine\'s cache yet. Nothing in the project changed. --offline was set. The skill is charts. Run bowerloom skills sync without --offline.');
  assert.equal(offline.match(/nothing (?:in the project )?(?:was )?changed/gi)?.length, 1, offline);
  assert.equal(renderRefusal('USAGE', 'Use bowerloom up --team <name> --goal <goal>.').includes('did not match'), false);
});

// Spec 01a, section 10.8 item 10: the nine agent codes each have a row in the errors reference.
test('every agent refusal and hold code has a row in the errors reference', () => {
  const page = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');
  const codes = ['AGENT_INVALID', 'AGENT_KEY_UNKNOWN', 'AGENT_NAME_MISMATCH', 'AGENT_LIMIT', 'APPLY_AGENT_DUPLICATE', 'APPLY_AGENTS_FOLDER_UNSAFE', 'AGENT_TARGET_OCCUPIED', 'AGENT_GRANT_REVIEW_REQUIRED', 'AGENT_TEAM_UNREGISTERED'];
  for (const code of codes) assert.match(page, new RegExp(`^\\| \`${code}\` \\|`, 'm'), code);
  for (const code of codes) assert.ok([...SYNC_REFUSAL_CODES, ...AUTHORING_REFUSAL_CODES].includes(code as never), code);
});

// Spec 07, section 5: the two token codes, and the new next step of STORE_REMOTE_PRIVATE. Each has a row in the errors reference.
test('spec 07: GITHUB_TOKEN_INVALID, STORE_REMOTE_AUTH_FAILED, and the new STORE_REMOTE_PRIVATE next step', async () => {
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    // Review R2 of PR 97 (option C): each sentence says why, and does not repeat the message.
    ['GITHUB_TOKEN_INVALID', "Bowerloom checks the token's shape before any network call and never shows the value.", 'Set it to a token with letters, digits, _ or -, 20 to 255 characters.'],
    ['STORE_REMOTE_AUTH_FAILED', 'GitHub answers the same way for a token that cannot read the repository and for a repository that does not exist.', 'Check that the token can read the repository, and that the repository name is right.'],
    // Review F1 of PR 97.
    ['GITHUB_TOKEN_SSO_REQUIRED', 'An organization that uses single sign-on refuses a token until it is authorized for that organization.', "Authorize the token for the organization on GitHub, under the token's settings, then run the command again."],
  ];
  for (const [code, sentence, next] of rows) assert.equal(renderRefusal(code, 'The message.'), text(code, 'The message.', sentence, next), code);
  assert.match(renderRefusal('STORE_REMOTE_PRIVATE', 'm.'), /\nNext: Set BOWERLOOM_GITHUB_TOKEN to a GitHub token that can read the repository, or make the repository public\.\n$/);
  const page = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');
  for (const code of ['GITHUB_TOKEN_INVALID', 'STORE_REMOTE_AUTH_FAILED', 'STORE_REMOTE_PRIVATE', 'GITHUB_TOKEN_SSO_REQUIRED']) assert.match(page, new RegExp(`^\\| \`${code}\` \\|`, 'm'), code);
  // The errors reference row of each new code says what the terminal sentence says (review R2).
  for (const [code, sentence] of rows) assert.ok(page.split('\n').some(l => l.startsWith(`| \`${code}\` |`) && l.replace(/`/g, '').includes(sentence.replace(/`/g, ''))), code);
  // Review F6 and F5: the request-failed next step names the token, and the STALE_APPROVAL row says a token change stales a plan.
  // Round 3: a pinned third-party skill never sends the token, so the step names the token for the store repository only.
  assert.match(renderRefusal('GITHUB_REQUEST_FAILED', 'm.'), /\nNext: Run the command again later\. If the status is 401 or 403, make sure that the store repository is public\. If this is your store repository, set BOWERLOOM_GITHUB_TOKEN\.\n$/);
  // Round 3: GITHUB_RATE_LIMITED also covers a 403 whose message names a rate limit, in its message, its words, and its row.
  const { manifestRefusal } = await import('../packages/skill-manifest/src/refusal.js');
  assert.equal(manifestRefusal('GITHUB_RATE_LIMITED').message, 'api.github.com answered 429, or 403 with no requests left or with a message that names a rate limit.');
  const rateSentence = 'GitHub allows about 60 requests an hour without a token and about 5,000 with one. It also limits bursts of requests, and a 403 answer can say so.';
  assert.match(renderRefusal('GITHUB_RATE_LIMITED', 'm.'), new RegExp(`^Refused \\(GITHUB_RATE_LIMITED\\): m\\.\\n${rateSentence.replace(/[.,]/g, '\\$&')}\\n`));
  assert.ok(page.split('\n').some(l => l.startsWith('| `GITHUB_RATE_LIMITED` |') && l.includes(rateSentence)));
  assert.match(page, /^\| `STALE_APPROVAL` \|.*BOWERLOOM_GITHUB_TOKEN.*\|$/m);
  assert.match(page, /^\| `GITHUB_REQUEST_FAILED` \|.*If this is your store repository, set `BOWERLOOM_GITHUB_TOKEN`\. \|$/m);
  assert.match(page, /^\| `STORE_REMOTE_PRIVATE` \|.*Set `BOWERLOOM_GITHUB_TOKEN` to a GitHub token that can read the repository, or make the repository public\. \|$/m);
  // The JSON envelope of a pipe keeps the fixed message of each code.
  assert.equal(reportFailure(new DefinitionError('GITHUB_TOKEN_INVALID', rows[0]![1]), false).text, `${JSON.stringify({ error: { code: 'GITHUB_TOKEN_INVALID', message: rows[0]![1] } })}\n`);
});

// Spec 08, section 5: the six store migrate codes. Review C2 of PR 98 (Hanna's choice C on #97): each sentence says why,
// and does not repeat the message. Each has a row in the errors reference whose meaning is that sentence.
test('spec 08: the MIGRATE_* codes have their words and a row in the errors reference', () => {
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    ['MIGRATE_ITEM_NOT_FOUND', 'store migrate moves only items that this project defines in .bowerloom, with their files in place.', 'bowerloom ls'],
    ['MIGRATE_ITEM_UNSUPPORTED', 'A store item holds only md, txt, json, yaml, yml, csv, and license files, within the size limits.', 'bowerloom help store'],
    ['MIGRATE_ID_EXISTS', 'Bowerloom never overwrites a store item, so an item with the same id and other bytes cannot move.', 'Rename the project item, or remove the store item yourself.'],
    ['MIGRATE_RESERVED', 'Setup made these items for this project, so they stay in it.', 'bowerloom store migrate --all skips them.'],
    ['MIGRATE_TEAM_MISSING', 'The store keeps the team tag, so that team must be in the store.', 'Add --team <name> to move that team too.'],
    ['MIGRATE_LIMIT', 'This beta keeps the store record small: 512 items and 1 MiB at most.', 'Remove items from the store, or move fewer items.'],
  ];
  for (const [code, sentence, next] of rows) assert.equal(renderRefusal(code, 'The message.'), text(code, 'The message.', sentence, next), code);
  const page = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');
  for (const [code, sentence] of rows) assert.ok(page.split('\n').some(l => l.startsWith(`| \`${code}\` | ${sentence.replace('store migrate', '`store migrate`').replace('.bowerloom', '`.bowerloom`')} |`)), code);
  for (const code of rows.map(r => r[0])) assert.ok((CONFIG_REFUSAL_CODES as readonly string[]).includes(code), code);
  // A refusal that carries its own next step names it: the store record whose files are gone.
  assert.match(renderRefusal('MIGRATE_ID_EXISTS', 'm.', { next: 'bowerloom receipt clean --global' }), /\nNext: bowerloom receipt clean --global\n$/);
});

// Spec 09, section 5, with review M4 of PR 99 (Hanna's choice C on #97): each sentence says why, and the errors row
// says the same words. The fixed message of the code stays the message of section 5.
test('spec 09: the CACHE_* codes have their words, their fixed messages, and the same words in the errors reference', () => {
  const rows: ReadonlyArray<readonly [string, string, string, string]> = [
    ['CACHE_ENTRY_NOT_FOUND', 'cache prune --entry deletes only an entry that cache list shows, so the text must start one of its ids.', 'bowerloom cache list', 'No cache entry starts with that text.'],
    ['CACHE_ENTRY_BUSY', 'Bowerloom never deletes an entry while another command holds it. An owner lock older than a day does not count.', 'When the other command is done, run this one again.', 'Another Bowerloom command is using that cache entry.'],
    ['CACHE_PRUNE_FAILED', 'Bowerloom deletes only private folders of this user, one at a time, and stops at the first one it cannot delete.', 'bowerloom cache list, then run the command again without --approve', 'Bowerloom failed to delete a cache entry. Entries it deleted before that stay deleted.'],
  ];
  for (const [code, sentence, next, message] of rows) {
    assert.equal(renderRefusal(code, 'The message.'), text(code, 'The message.', sentence, next), code);
    assert.equal(syncError(code as SyncCode).message, message, code);
  }
  assert.equal(syncError('CACHE_PRUNE_FAILED', 'Deleted 2 of 5 entries.').message, 'Bowerloom failed to delete a cache entry. Entries it deleted before that stay deleted. Deleted 2 of 5 entries.');
  const page = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');
  const tick = (words: string): string => words.replace('cache prune --entry', '`cache prune --entry`').replace('cache list', '`cache list`');
  for (const [code, sentence] of rows) assert.ok(page.split('\n').some(l => l.startsWith(`| \`${code}\` | ${tick(sentence)} |`)), code);
});

// Second security review of PR 98, M1 and L2: a refusal after a partial write never says that nothing was applied or
// changed. Its words say the run stopped part way, its Next line is the exact command that finishes it, and the JSON
// envelope carries partial: true and that command as next.
test('a partial refusal: its own sentence, the rerun command as Next, and partial: true in JSON', () => {
  const rerun = 'bowerloom store migrate --prompt brief';
  const cases: Array<readonly [unknown, string]> = [
    [new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.'), 'STALE_APPROVAL'],
    [new DefinitionError('PROJECT_LOCKED', 'Another Bowerloom command is changing this project.'), 'PROJECT_LOCKED'],
    [new DefinitionError('STORE_LOCKED', 'Another Bowerloom command is changing the store.'), 'STORE_LOCKED'],
    [Object.assign(new Error('i/o error'), { code: 'EIO' }), 'IO_ERROR'],
  ];
  for (const [error, code] of cases) {
    const partial = partialRefusal(error, ['prompt brief, copied to the store'], rerun) as DefinitionError;
    assert.equal(partial.code, code);
    const text = reportFailure(partial, true).text;
    assert.doesNotMatch(text, /nothing was (?:applied|changed)/i, code);
    assert.match(text, new RegExp(`^Refused \\(${code}\\): [^\\n]*Already written: prompt brief, copied to the store\\.[^\\n]*\\nThe run stopped part way; the message lists what was written\\.\\nNext: bowerloom store migrate --prompt brief\\n$`), code);
    const json = JSON.parse(reportFailure(partial, false).text) as { error: { code: string; next?: string; partial?: boolean } };
    assert.equal(json.error.code, code); assert.equal(json.error.next, rerun); assert.equal(json.error.partial, true);
    assert.equal(reportFailure(partial, false).exitCode, 1);
  }
  // L2: the system code of an error that is not a refusal is kept as the cause.
  assert.equal((partialRefusal(Object.assign(new Error('x'), { code: 'EXDEV' }), ['bowerloom.json'], rerun) as { cause?: unknown }).cause, 'EXDEV');
  // Before any write, the error is returned as it is, and its envelope has no partial key.
  const untouched = new DefinitionError('STALE_APPROVAL', 'm.');
  assert.equal(partialRefusal(untouched, [], rerun), untouched);
  assert.equal('partial' in (JSON.parse(reportFailure(untouched, false).text) as { error: object }).error, false);
});
