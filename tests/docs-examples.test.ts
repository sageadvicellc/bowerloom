// Spec 10 of beta.3, tests E1 to E14: the page "Where your items come from" against the code. Every example and every
// quoted string on the page comes from the code: the serializers, the exported plan strings, the refusal words, and one
// run of the built CLI. Reads and runs nothing on the network.
import './support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { world, run, mustApprove, git } from './support/config-cli.js';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { configExample, lockExample, lockValue, writtenRows } from './support/docs-examples.js';
import { CONFIG_REFUSAL_CODES, NOT_SHAREABLE, lockAgrees, notShareable, parseConfig, parseLock, unknownSharedNote } from '../packages/project-config/src/index.js';
import type { NotShareableCause } from '../packages/project-config/src/index.js';
import { honestShared } from '../packages/project-config/src/refusal.js';
import { renderRefusal, TOPICS } from '../apps/cli/src/human.js';
import { NETWORK_LINE, NO_TOKEN_LINE, requestCount } from '../packages/project-sync/src/change.js';
import { SHARED_NO_LOCK_NOTE, STALE_NOTE } from '../packages/project-sync/src/resolve.js';
import { offlineHold } from '../packages/project-sync/src/plan.js';
import { credentialsLines, requestLine, TOKEN_TAIL } from '../apps/cli/src/sync.js';
import { GITHUB_REQUEST_LIMIT, GITHUB_REQUEST_MAX, TOKEN_STALE_NOTE } from '../packages/project-sync/src/store-git.js';
import { STORE_FILE_LIMITS } from '../packages/skill-manifest/src/content.js';
import { MANIFEST_REFUSAL_CODES } from '../packages/skill-manifest/src/index.js';
import { SYNC_REFUSAL_CODES, syncError } from '../packages/project-sync/src/refusal.js';
import { AUTHORING_REFUSAL_CODES } from '../packages/project-authoring/src/index.js';
import { revisionOf } from '../packages/skill-sources/src/validation.js';

const source = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const PAGE = 'apps/docs/src/content/docs/guides/item-sources.md';
const page = (): string => source(PAGE);
const cliDoc = (): string => source('apps/docs/src/content/docs/cli.md');
const has = (text: string, needle: string, what = needle): void => assert.ok(text.includes(needle), `the page holds: ${what}`);

/** The fenced blocks of a Markdown text, with their info string. */
function fences(text: string): { info: string; body: string[]; before: string[] }[] {
  const out: { info: string; body: string[]; before: string[] }[] = [], lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(.*)$/.exec(lines[i]!);
    if (!open) continue;
    const body: string[] = []; let j = i + 1;
    for (; j < lines.length && !lines[j]!.startsWith(open[1]!); j++) body.push(lines[j]!);
    out.push({ info: open[2]!.trim(), body, before: lines.slice(Math.max(0, i - 2), i) });
    i = j;
  }
  return out;
}
/** The json block that follows the marker line `<!-- example: <name> -->`. */
function example(name: string): string {
  const lines = page().split('\n'), at = lines.indexOf(`<!-- example: ${name} -->`);
  assert.ok(at >= 0, `marker ${name}`);
  let i = at + 1; while (lines[i] === '') i++;
  assert.equal(lines[i], '```json', `${name}: a json fence follows the marker`);
  const end = lines.indexOf('```', i + 1); assert.ok(end > i);
  return `${lines.slice(i + 1, end).join('\n')}\n`;
}
const textFenceLines = (text: string): string[] => fences(text).filter(f => f.info === 'text').flatMap(f => f.body);
const COMMANDS = (): string[] => {
  const m = /const COMMANDS = new Set\(\[([^\]]*)\]\)/.exec(source('apps/cli/src/main.ts'));
  assert.ok(m, 'COMMANDS in main.ts');
  return [...m[1]!.matchAll(/'([^']+)'/g)].map(x => x[1]!);
};

test('E1. the config example equals configExample()', () => { assert.equal(example('config'), configExample()); });
test('E2. the lock example equals lockExample()', () => { assert.equal(example('lock'), lockExample()); });
test('E3. the two examples parse, and the lock agrees with the config', () => {
  const config = parseConfig(Buffer.from(example('config'))), lock = parseLock(Buffer.from(example('lock')));
  assert.equal(lockAgrees(lock, config).agrees, true);
  // Only these two comments are on the page.
  assert.deepEqual(page().match(/<!--[\s\S]*?-->/g), ['<!-- example: config -->', '<!-- example: lock -->']);
});
test('E4. each written item of the fixture has the hash of its files', () => {
  for (const item of [...lockValue().skills, ...lockValue().prompts, ...lockValue().teams]) {
    if (!('authored' in item)) continue;
    assert.equal(item.authored.hash, revisionOf(item.authored.files), item.id);
    assert.equal(item.authored.hash, writtenRows(item.id as 'house-style').hash, item.id);
  }
});
test('E5. each bowerloom command in a text fence starts with a command word', () => {
  const words = new Set(COMMANDS()), bad: string[] = [];
  for (const line of textFenceLines(page())) for (const m of line.matchAll(/(?:^|\s|`)bowerloom ([^\s`]+)/g)) if (!words.has(m[1]!)) bad.push(line);
  assert.deepEqual(bad, []);
});
test('E6. cli.md names every command and holds the usage lines of seven topics', () => {
  const text = cliDoc(), skip = new Set(['help', '--help', '-h', '--version', '-V']);
  const named = new Set<string>();
  for (const f of fences(text)) for (const line of f.body) { const m = /^bowerloom ([^\s]+)/.exec(line.trim()); if (m) for (const part of m[1]!.split('|')) named.add(part); }
  for (const m of text.matchAll(/bowerloom ([a-z][a-z-]*)/g)) named.add(m[1]!);
  assert.deepEqual(COMMANDS().filter(w => !skip.has(w) && !named.has(w)), []);
  const lines = new Set(text.split('\n'));
  for (const topic of ['store', 'use', 'unuse', 'lock', 'cache', 'receipt', 'context']) {
    const words = TOPICS[topic]!.split('\n'), start = words.indexOf('Usage:');
    assert.ok(start >= 0, topic);
    for (let i = start + 1; i < words.length && words[i]!.startsWith('  '); i++) assert.ok(lines.has(words[i]!.trim()), `${topic}: ${words[i]!.trim()}`);
  }
});
test('E7. the store status fix commands on the page are the ones the CLI prints', t => {
  const w = world(t, 'bowerloom-docs-examples-');
  mustApprove(w.home, ['skill', 'create', 'probe', '--global'], w.env);
  const r = run(w.home, ['store', 'status'], w.env);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trimEnd().split('\n');
  assert.ok(!out.some(l => l.includes('GitHub token:')), 'no token line without a remote');
  const start = out.indexOf('  To fix this, run these commands yourself:');
  assert.ok(start >= 0, r.stdout);
  const last = out.at(-1)!;
  assert.equal(last, '  A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.');
  const fenceLines = new Set(textFenceLines(page()));
  for (const line of out.slice(start + 1, -1)) { assert.ok(line.startsWith('    '), line); assert.ok(fenceLines.has(line.slice(4)), `fence line: ${line.slice(4)}`); }
  has(page(), last.trim());
  // The other three cases: on the page, and in store.ts as written.
  const store = source('apps/cli/src/store.ts');
  const cases: string[][] = [
    ['cd ~/.bowerloom', 'git remote add origin https://github.com/<owner>/<repo>.git', 'git push -u origin <branch>'],
    ['cd ~/.bowerloom', 'git remote set-url origin https://github.com/<owner>/<repo>.git'],
    ['cd ~/.bowerloom', 'git push -u origin <branch>'],
  ];
  const blocks = fences(page()).filter(f => f.info === 'text').map(f => f.body.join('\n'));
  for (const c of cases) {
    assert.ok(blocks.includes(c.join('\n')), `a text fence holds exactly: ${c.join(' / ')}`);
    for (const line of c) {
      const code = line.replace('<branch>', '${b}');
      assert.ok(store.includes(`'${code}'`) || store.includes(`\`${code}\``), `store.ts: ${code}`);
    }
  }
  // Round 1 of the reviews of PR 101, E7: each other git state, through the built CLI. The printed fix lines, with the
  // branch name as <branch>, are a text fence of the page. A detached HEAD and no-origin print <branch> themselves.
  const fixLines = (label: string): string[] => {
    const r = run(w.home, ['store', 'status'], w.env), lines = r.stdout.trimEnd().split('\n');
    assert.equal(r.status, 0, `${label}: ${r.stderr}`);
    assert.ok(lines.includes('  A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.'), `${label}: the token line`);
    const at = lines.indexOf('  To fix this, run these commands yourself:');
    if (at < 0) return [];
    const out: string[] = [];
    for (const line of lines.slice(at + 1)) { if (!line.startsWith('    ')) break; out.push(line.slice(4)); }
    return out;
  };
  git(w.store, ['init', '-q', '.'], w); git(w.store, ['add', '-A'], w); git(w.store, ['commit', '-q', '-m', 'Store'], w);
  const states: [string, () => void, string[]][] = [
    ['no-origin', () => {}, cases[0]!],
    ['no-origin, detached HEAD', () => git(w.store, ['checkout', '-q', '--detach'], w), cases[0]!],
    ['unsupported-remote', () => { git(w.store, ['checkout', '-q', 'main'], w); git(w.store, ['remote', 'add', 'origin', 'https://gitlab.com/o/store.git'], w); }, cases[1]!],
    ['unpushed', () => git(w.store, ['remote', 'set-url', 'origin', 'https://github.com/o/store.git'], w), cases[2]!],
    ['unpushed, detached HEAD', () => git(w.store, ['checkout', '-q', '--detach'], w), cases[2]!],
  ];
  for (const [label, step, want] of states) {
    step();
    const got = fixLines(label).map(l => l.replace(/ main$/, ' <branch>'));
    assert.deepEqual(got, want, label);
    assert.ok(blocks.includes(got.join('\n')), `${label}: a text fence holds the printed lines`);
  }
  assert.ok(fixLines('unpushed, detached HEAD').includes('git push -u origin <branch>'), 'a detached HEAD prints <branch>');
  // unreadable: a .git file that the group can write. store status prints no fix commands.
  git(w.store, ['checkout', '-q', 'main'], w);
  chmodSync(join(w.store, '.git', 'config'), 0o664);
  assert.deepEqual(fixLines('unreadable'), [], 'unreadable prints no commands');
});
test('E8. STORE_ITEM_NOT_SHAREABLE: each cause, the rendered refusal, and the honest-shared prefix', () => {
  const text = page();
  for (const cause of Object.keys(NOT_SHAREABLE) as NotShareableCause[]) {
    const message = notShareable(cause).message, fixed = 'This project is shared, and a teammate cannot fetch this store item. ';
    assert.ok(message.startsWith(fixed));
    has(text, message.slice(fixed.length), cause);
  }
  for (const line of renderRefusal('STORE_ITEM_NOT_SHAREABLE', notShareable('none').message).trimEnd().split('\n')) has(text, line);
  const honest = (honestShared(notShareable('none'), '.git') as Error).message;
  const prefix = 'Bowerloom could not read .git and treats this project as shared';
  assert.ok(honest.startsWith(prefix));
  has(text, prefix.replace('.git', '<x>'));
});
test('E9. the plan strings, imported from the code', () => {
  const text = page();
  has(text, NETWORK_LINE(7777, 8888).replace('7777', '<n>').replace('8888', '<r>'));
  has(text, NO_TOKEN_LINE);
  has(text, STALE_NOTE(['<ids>'])); has(text, SHARED_NO_LOCK_NOTE);
  has(text, offlineHold('skill', 'x').next);
  const next = /\nNext: (.*)\n$/.exec(renderRefusal('ITEM_REVIEW_REQUIRED', ''))![1]!;
  has(text, next);
  has(text, TOKEN_TAIL);
  has(text, credentialsLines({ variable: 'BOWERLOOM_GITHUB_TOKEN', host: 'api.github.com', repositories: ['<owner>/<repo>'] })[0]!);
  has(text, TOKEN_STALE_NOTE);
  has(text, unknownSharedNote('<x>'));
  has(text, requestLine({ requests: 7777, maxRequests: 8888 })[0]!.replace('7777', '<r>').replace('8888', '<max>'));
  const frozen = /const FROZEN_LINE = '([^']+)';/.exec(source('packages/project-sync/src/plan.ts'));
  assert.ok(frozen); has(text, frozen[1]!);
  const change = source('packages/project-sync/src/change.ts'), prefix = 'Your store has commits that are not pushed (HEAD differs from origin/';
  assert.ok(change.includes(`${prefix}\${repo.branch}). The lock records the pushed commit \${repo.pushed!.slice(0, 8)}.\``), 'the warning in change.ts');
  has(text, `${prefix}<branch>). The lock records the pushed commit <commit8>.`);
});
test('E10. each flag the page gives for a command is in the help of that command', () => {
  const text = page(), spans = [...text.matchAll(/`([^`\n]+)`/g)].map(m => m[1]!);
  for (const f of fences(text)) if (f.info === 'text') spans.push(...f.body);
  const commands: [RegExp, string][] = [[/^use\b/, 'use'], [/^lock (?:update|verify)\b/, 'lock'], [/^apply\b/, 'apply'], [/^store (?:status|migrate)\b/, 'store'], [/^cache (?:list|prune)\b/, 'cache'], [/^receipt clean\b/, 'receipt'], [/^skills sync\b/, 'skills']];
  const bad: string[] = []; let checked = 0;
  for (const raw of spans) {
    const span = raw.trim().replace(/^bowerloom /, '');
    for (const [match, topic] of commands) {
      if (!match.test(span)) continue;
      for (const flag of span.match(/--[a-z][a-z-]*/g) ?? []) { checked++; if (!TOPICS[topic]!.includes(flag)) bad.push(`${topic}: ${flag} in ${raw}`); }
    }
  }
  assert.deepEqual(bad, []); assert.ok(checked >= 5, `${checked} flags checked`);
});
test('E11. request counts, tied to the code', () => {
  // "A skill or team takes 4 requests plus 1 for each file with different content": requestCount is 4 plus the distinct files.
  for (const distinct of [1, 2, 7, STORE_FILE_LIMITS.files]) assert.equal(requestCount([{ local: { distinct } }]), 4 + distinct, `${distinct} files`);
  assert.equal(requestCount([{ local: null }]), 0, 'a pin takes no request');
  has(page(), 'A skill or team takes 4 requests plus 1 for each file with different content.');
  // A prompt has one file.
  has(page(), `A prompt takes ${requestCount([{ local: { distinct: 1 } }])}.`);
  has(page(), `One item takes at most ${requestCount([{ local: { distinct: STORE_FILE_LIMITS.files } }])}.`);
  // The budget of one run, from the constants of store-git.ts.
  has(page(), `\`--max-github-requests <n>\`, a whole number from 1 to ${GITHUB_REQUEST_MAX}. The default is ${GITHUB_REQUEST_LIMIT}.`);
  has(page(), `\`use\`, \`lock update\`, and \`store migrate\` have a fixed budget of ${GITHUB_REQUEST_LIMIT}.`);
});
test('E12. every new code of the four exported code lists has an errors.md row', () => {
  const baseline = new Set(JSON.parse(source('apps/docs/tools/beta2-refusal-codes.json')) as string[]), errors = source('apps/docs/src/content/docs/reference/errors.md');
  const codes = [...new Set<string>([...CONFIG_REFUSAL_CODES, ...SYNC_REFUSAL_CODES, ...AUTHORING_REFUSAL_CODES, ...MANIFEST_REFUSAL_CODES])].filter(c => !baseline.has(c));
  assert.ok(codes.length > 0);
  assert.deepEqual(codes.filter(c => !new RegExp(`^\\| \`${c}\` \\|`, 'm').test(errors)), []);
});
test('E13. LOCK_COMMIT_GONE: its words in the code, on the page, and in errors.md', () => {
  const human = source('apps/cli/src/human.ts');
  assert.match(human, /^ {2}LOCK_COMMIT_GONE: \{/m);
  const message = syncError('LOCK_COMMIT_GONE').message;
  assert.equal(message, 'The locked commit is no longer on GitHub.');
  has(page(), message);
  const rendered = renderRefusal('LOCK_COMMIT_GONE', message).trimEnd().split('\n');
  has(page(), rendered[2]!.slice('Next: '.length), 'the LOCK_COMMIT_GONE next step');
  const errors = source('apps/docs/src/content/docs/reference/errors.md').split('\n').find(l => l.startsWith('| `LOCK_COMMIT_GONE` |'));
  const row = page().split('\n').find(l => l.startsWith('| `LOCK_COMMIT_GONE` |'));
  assert.ok(errors && row); assert.equal(row, errors);
});
test('E14. the folders/ warnings of store status, read from store.ts, are on the page', () => {
  const store = source('apps/cli/src/store.ts'), start = store.indexOf('function folderLines('), end = store.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'folderLines in store.ts');
  const warnings = [...store.slice(start, end).matchAll(/\[(?:'( {2}Warning: [^']+)'|"( {2}Warning: [^"]+)")\]/g)].map(m => (m[1] ?? m[2])!.trim());
  assert.equal(warnings.length, 3, warnings.join('\n'));
  const missing = /out\.push\("( {2}Warning: ~\/\.bowerloom\/\.gitignore misses lines[^"]+)"\)/.exec(store);
  assert.ok(missing, 'the .gitignore warning in store.ts');
  const lines = new Set(textFenceLines(page()));
  for (const w of [...warnings, missing[1]!.trim()]) assert.ok(lines.has(w), `a text fence holds: ${w}`);
});
