// The Export and Import sheets' parts, drawn as markup: the risky parts first (a check block that jumps to each list, tools with their command in full and each argument
// on its own line, values with the host each goes to, files that can run, paths), the cap of 200 rows with "and N more" and a count of what a cut hides, names that are cut with
// a "Show all" button and everything a tick covers that is never cut, the ticks, the notes choices, and the folder cards. The made-up bundle is the sample bridge's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSampleEngine, SAMPLE_FOLDERS, SAMPLE_NOTES } from '../shared/engine/sample.js';
import { SHARE_LIST_LIMIT } from '../shared/engine/types.js';
import type { BundleView, ExportView, FolderInfo, ImportView, SaveChangeView, ShareSummary, ShareTool } from '../shared/engine/types.js';
import { ExportBody, ExportDone } from '../renderer/harness/sheets/ExportSheet.js';
import { BundleBody, FolderList, ImportReview, choicesOf, importFolderLine } from '../renderer/harness/sheets/ImportSheet.js';
import { Capped, Name, SecretsSection, ShareSummaryView } from '../renderer/harness/sheets/share-parts.js';
import { assertTextBudget, extractText } from '../shared/home/textbudget.js';
import { DESIGN_WORDS, bannedHere } from '../shared/harness/words.js';
import { DESKTOP } from './support.js';

const noop = (): void => undefined;
const e = createSampleEngine();
const bundle = (): Promise<BundleView> => e.chooseBundle().then(a => { assert.ok(a !== null && a.ok); return a.value; });
const summaryOf = async (): Promise<ShareSummary> => (await bundle()).summary;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);
const empty = { rows: [], more: 0 };
const blank: ShareSummary = {
  harness: 'blank', engines: ['claude-code'], instructions: false, counts: { skills: 0, agents: 0, mcp: 0, hooks: 0, guardrails: 0, scripts: 0, files: 1, bytes: 40 },
  tools: empty, codeFiles: empty, secrets: empty, notes: empty, borrowed: empty, foreignPaths: empty,
};
async function importView(choices: { link: Record<string, string>; leave: string[] } = { link: {}, leave: ['yard-wiki'] }, folder = SAMPLE_FOLDERS.adopt): Promise<ImportView> {
  const b = await bundle(), a = await e.planImport(folder, b.bundleId, choices);
  assert.ok(a.ok);
  return a.value;
}
const reviewProps = { approved: false, acknowledged: false, held: false, onApprove: noop, onAcknowledge: noop, onLink: noop, onLeave: noop };
const tool = (over: Partial<ShareTool>): ShareTool => ({ name: 't', kind: 'mcp', transport: 'stdio', runsCode: true, command: 'node', args: [], host: null, event: null, flags: [], ...over });
const css = readFileSync(join(DESKTOP, 'renderer', 'harness', 'sheets', 'share.css'), 'utf8');

test('the summary is one line of counts, then a check block, then the lists in the order a person must read them: tools, values, files that can run, paths', async () => {
  const out = html(createElement(ShareSummaryView, { summary: await summaryOf(), side: 'import' }));
  assert.match(out, /data-summary-line="">[\s\S]*2 skills, 1 agent, 4 tools, 1 hook, 1 guardrail, 2 scripts, 10 files, 4\.8 KB/);
  assert.doesNotMatch(out, /<dl|data-count=/, 'no grid of counts');
  const at = (needle: string): number => { const i = out.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  assert.ok(at('data-check=""') < at('data-section="share-tools"'));
  assert.ok(at('data-section="share-tools"') < at('data-section="share-secrets"'));
  assert.ok(at('data-section="share-secrets"') < at('data-section="share-code"'));
  assert.ok(at('data-section="share-code"') < at('data-section="share-paths"'));
  assert.ok(out.includes('Check before you go on'));
  for (const jump of ['tools', 'secrets', 'code', 'paths']) assert.match(out, new RegExp(`data-jump="${jump}"`));
  assert.ok(out.includes('5 tools') && out.includes('2 values go to tools') && out.includes('3 files can run') && out.includes('1 path from another computer'));
  for (const name of ['5 tools. Go to the list.', '2 values go to tools. Go to the list.', '3 files can run. Go to the list.', '1 path from another computer. Go to the list.']) assert.ok(out.includes(`aria-label="${name}"`), name);
  assert.ok(out.includes('This list is a guide. Read each command.'));
  assert.match(out, /<h3 class="hxe-head" id="[^"]+-h" tabindex="-1"><span>Values it reads<\/span>/, 'a heading a jump can focus');
  assert.ok(out.includes('The file passes these values from this computer to these tools.') && out.includes('They go to the tools and hosts shown.') && out.includes('Bowerloom did not check that these exist.'));
  assert.doesNotMatch(out, /\badd\b/i);
});

test('a tool says what it does in words: where it starts a program, what it downloads, what a hook runs on, and where a value goes', async () => {
  const out = html(createElement(ShareSummaryView, { summary: await summaryOf(), side: 'import' }));
  assert.match(out, /data-tool="stock-db"[^>]*data-runs-code=""/);
  assert.ok(out.includes('Connects to a web address.'));
  assert.doesNotMatch(out, /Starts a program on this computer/, 'a program that starts says so once, in the badge');
  assert.ok(out.includes('Tool server') && out.includes('Hook, runs on its own'));
  assert.doesNotMatch(out, />Server<|>Hook</);
  assert.ok(out.includes('This downloads code at start.'), 'npx fetches code');
  assert.equal([...out.matchAll(/This downloads code at start/g)].length, 1, 'only the npx server');
  assert.equal([...out.matchAll(/Starts a program</g)].length, 3, 'three tools start a program');
  assert.ok(out.includes('Runs after each tool use.') && out.includes('Event: <span class="hxsh-full hxe-mono"'), 'the raw event stays, in mono');
  assert.match(out, /Reaches: <span[^>]*>orders\.example\.test/);
  assert.ok(out.includes('orders-api, in a header, to orders.example.test'));
  assert.ok(out.includes('Passed to the program stock-db, in an environment value. It can send it anywhere.'));
  assert.doesNotMatch(out, /Server, stdio|Runs code/);
  for (const path of ['hooks.json', 'scripts/format-check.sh', 'skills/tally-stock/scripts/tally.sh']) assert.ok(out.includes(`data-code-file="${path}"`), path);
  assert.match(out, /data-foreign-path="instructions\/AGENTS\.md"/);
  assert.ok(out.includes('Line 12') && out.includes('/Users/example/yard-notes') && out.includes('They stay as written.'));
});

test('everything a tick covers is shown in full: 20 arguments of 200 characters, each on its own line, and a 200-character host, never clamped', () => {
  const args = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}${'a'.repeat(198)}`);
  const host = `${'h'.repeat(190)}.example.test`;
  const summary: ShareSummary = { ...blank, tools: { rows: [tool({ command: 'node', args, host })], more: 0 } };
  const out = html(createElement(ShareSummaryView, { summary, side: 'import' }));
  for (const arg of args) assert.ok(out.includes(`>${arg}<`), `argument ${arg.slice(0, 2)} is whole in the markup`);
  assert.equal([...out.matchAll(/data-arg="/g)].length, 20, 'one line each');
  assert.ok(out.includes(`>${host}<`), 'the host is whole');
  assert.match(out, /<ol class="hxsh-args" aria-label="Arguments">/, 'the list is shown whole: no inner scroll box, so no Tab stop');
  const argsRule = /\.hxsh-args \{([^}]*)\}/.exec(css)![1]!;
  assert.doesNotMatch(argsRule, /max-height|overflow/, 'a long list of arguments is not hidden behind an inner scroll');
  // The CSS never clamps or hides what is read under a tick.
  const full = /\.hxsh-full \{([^}]*)\}/.exec(css)![1]!;
  assert.doesNotMatch(full, /line-clamp|overflow: hidden|text-overflow|max-height/);
  assert.match(full, /overflow-wrap: anywhere/);
  assert.doesNotMatch(out, /hxsh-cut/);
});

test('a secret name under a tick is never cut, and a shell command line is flagged', () => {
  const long = 'S'.repeat(150);
  const out = html(createElement(ShareSummaryView, { summary: { ...blank, secrets: { rows: [{ kind: 'env', name: long, sinks: [{ tool: 'docs', field: 'env', host: null }] }], more: 0 }, tools: { rows: [tool({ command: 'sh', args: ['-c', 'echo hi'] })], more: 0 } }, side: 'import' }));
  assert.ok(out.includes(`>${long}<`));
  assert.doesNotMatch(out, /data-secret="[^"]*"[^>]*>[\s\S]*?data-cut/);
  assert.match(out, /data-shell=""/);
  const admin = html(createElement(ShareSummaryView, { summary: { ...blank, tools: { rows: [tool({ command: 'sudo', args: ['npx', 'x'] })], more: 0 } }, side: 'import' }));
  assert.match(admin, /data-admin=""/);
  assert.ok(admin.includes('This runs with admin rights.') && admin.includes('This downloads code at start.'));
  assert.ok(out.includes('This runs text as code.'));
});

test('only a name is cut, and a button says whether it is open; a short name has no button', () => {
  const long = 'N'.repeat(120);
  const out = html(createElement(Name, null, long));
  assert.match(out, /data-cut=""/);
  assert.match(out, /<button[^>]*aria-expanded="false"[^>]*aria-label="Show all"/);
  assert.ok(out.includes(long), 'the whole name is in the page; the cut is only how it is drawn');
  assert.doesNotMatch(html(createElement(Name, null, 'short')), /<button|data-cut/);
  assert.match(css, /\.hxsh-name\[data-cut\] \{[^}]*-webkit-line-clamp: 2/);
});

test('with nothing to check, one line says so; empty lists draw no section, and no grid of counts', () => {
  const out = html(createElement(ShareSummaryView, { summary: blank, side: 'export' }));
  assert.ok(out.includes('Nothing here runs. No value leaves this computer.'));
  assert.doesNotMatch(out, /data-section=|data-jump|data-more|Borrowed items/);
  assert.ok(out.includes('1 file, 40 bytes'));
});

test('a list shows at most 200 rows, then "and N more", and the check block counts what a cut hides', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ kind: 'env' as const, name: `VALUE_${i}`, sinks: [{ tool: 'docs', field: 'env' as const, host: null }] }));
  const cut = html(createElement(SecretsSection, { id: 'x', summary: { ...blank, secrets: { rows: rows.slice(0, SHARE_LIST_LIMIT), more: 50 } }, side: 'import' }));
  assert.equal([...cut.matchAll(/data-secret="/g)].length, 200);
  assert.match(cut, /data-more="50"[^>]*>and 50 more</);
  assert.match(cut, /<span class="hxe-count">250<\/span>/);
  const over = html(createElement(SecretsSection, { id: 'x', summary: { ...blank, secrets: { rows, more: 7 } }, side: 'import' }));
  assert.equal([...over.matchAll(/data-secret="/g)].length, 200);
  assert.match(over, /data-more="57"/);
  const exact = html(createElement(Capped, { list: { rows: ['a', 'b'], more: 0 }, label: 'List', empty: 'None', render: (r: string) => createElement('li', { key: r }, r) }));
  assert.doesNotMatch(exact, /data-more/);
  const hidden = html(createElement(ShareSummaryView, { summary: { ...blank, tools: { rows: [tool({})], more: 12 }, foreignPaths: { rows: [], more: 3 } }, side: 'import' }));
  assert.match(hidden, /data-hidden="15"/);
  assert.ok(hidden.includes('15 more rows are not shown.'));
  assert.doesNotMatch(html(createElement(ShareSummaryView, { summary: blank, side: 'import' })), /data-hidden/);
});

test('text from a file is plain text: a script in a name is written out, not run, and every text takes its own direction', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const summary: ShareSummary = {
    ...blank,
    tools: { rows: [tool({ name: evil, command: `sh -c "x"`, flags: ['credentials', 'backslash'] })], more: 0 },
    notes: { rows: [{ name: '<b>wiki</b>', readBy: [evil] }], more: 0 },
  };
  const out = html(createElement(ShareSummaryView, { summary, side: 'import' }));
  assert.doesNotMatch(out, /<img|<b>/);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(out.includes('The address holds a user name or password.') && out.includes('The address uses a backslash.'));
  assert.match(out, /class="hxsh-full hxe-mono" dir="auto"/);
  assert.match(css, /\.hxsh-full \{[^}]*unicode-bidi: isolate/);
});

test('the export sheet: the file name and size, the summary, the tick only when a path of this computer is in the files, and a note when changes are not saved', async () => {
  const plain = await e.planExport(SAMPLE_FOLDERS.defined), ticked = await e.planExport(SAMPLE_FOLDERS.stopped);
  assert.ok(plain.ok && ticked.ok);
  const a = html(createElement(ExportBody, { view: plain.value, acked: false, held: false, onAck: noop }));
  assert.match(a, /data-export-file="weekly-report\.bowerloom\.json"/);
  assert.match(a, /<\/span><\/span> <span class="hxe-muted">[0-9.]+ (?:bytes|KB)</);
  assert.ok(a.includes('Export writes the saved harness to one file.'));
  assert.doesNotMatch(a, /data-acknowledge-paths|data-unsaved/);
  assert.match(html(createElement(ExportBody, { view: plain.value, acked: false, held: false, onAck: noop, unsaved: true })), /data-unsaved=""[^>]*>[\s\S]*Your unsaved changes are not in the file\./);
  const b = html(createElement(ExportBody, { view: ticked.value, acked: false, held: false, onAck: noop }));
  assert.match(b, /data-acknowledge-paths=""/);
  assert.match(b, /aria-label="I accept these paths from this computer in the file: reading\.bowerloom\.json"/);
  assert.doesNotMatch(b, /<input[^>]*checked=""/);
  assert.match(html(createElement(ExportBody, { view: ticked.value, acked: true, held: false, onAck: noop })), /<input[^>]*checked=""/);
  assert.match(html(createElement(ExportBody, { view: ticked.value, acked: false, held: true, onAck: noop })), /<input[^>]*disabled=""/);
  const done = html(createElement(ExportDone, { written: { name: 'x.bowerloom.json', bytes: 2048 } }));
  assert.ok(done.includes('Exported') && done.includes('x.bowerloom.json, 2.0 KB') && done.includes('The file is written. Nothing else changed.'));
  assert.match(done, /<p class="hxi-sum" role="status">/);
});

test('the import file step shows the file, says to check what runs, and lists what it holds', async () => {
  const out = html(createElement(BundleBody, { bundle: await bundle() }));
  assert.match(out, /data-bundle-name="rope-yard\.bowerloom\.json"/);
  assert.ok(out.includes('This file came from another person. Check what runs before you import.'));
  assert.match(out, /data-summary-line=""/);
  assert.match(out, /data-tool="stock-db"/);
});

test('the import review: the folder it writes into, the plan line for a new harness, risky parts first, then notes, then the files, then the ticks', async () => {
  const view = await importView();
  const out = html(createElement(ImportReview, { view, ...reviewProps }));
  const at = (needle: string): number => { const i = out.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  assert.match(out, new RegExp(`data-target="${view.folder.replace(/[~/]/g, m => `\\${m}`)}"`));
  assert.ok(out.includes('Into'));
  assert.ok(out.includes('Makes the harness. Writes 10 files in all.') && view.makesHarness === true);
  const order = ['data-target=', 'data-makes-harness', 'data-check=', 'data-section="share-tools"', 'data-section="share-secrets"', 'data-section="share-code"', 'data-section="share-paths"', 'data-section="import-notes"', 'data-section="import-writes"', 'data-acknowledge-import', 'data-approve-plan'];
  order.reduce((from, needle) => { const i = out.indexOf(needle, from); assert.ok(i >= from, needle); return i; }, 0);
  assert.ok(at('data-section="import-writes"') > at('data-section="share-paths"'));
  assert.ok(out.includes('Import only writes files, into the .bowerloom folder. Nothing runs until you install.'));
  assert.doesNotMatch(html(createElement(ImportReview, { view: { ...view, makesHarness: false }, ...reviewProps })), /data-makes-harness/);
});

test('the import ticks are in words a person can act on: what runs, where values go, how many files go into which folder; no hash', async () => {
  const view = await importView();
  const out = html(createElement(ImportReview, { view, ...reviewProps }));
  assert.match(out, /aria-label="I read what runs, where my values go and the paths: Import rope-yard"/);
  assert.match(out, new RegExp(`aria-label="Make a harness and write these 10 files into ${view.folder.replace(/[~/]/g, m => `\\${m}`)}\\. Install is separate: ${view.folder.replace(/[~/]/g, m => `\\${m}`)}"`));
  assert.doesNotMatch(out, /I approve plan|[0-9a-f]{8}\b.*approve/);
  assert.doesNotMatch(out, /<input[^>]*checked=""/);
  assert.equal([...html(createElement(ImportReview, { view, ...reviewProps, approved: true, acknowledged: true })).matchAll(/<input[^>]*checked=""/g)].length, 2);
  const held = html(createElement(ImportReview, { view, ...reviewProps, held: true }));
  assert.equal([...held.matchAll(/<input[^>]*disabled=""/g)].length, 2, 'both ticks are held while a write runs');
  assert.equal([...held.matchAll(/<button[^>]*disabled=""/g)].length, 2, 'so are the two notes buttons');
  const calm = html(createElement(ImportReview, { view: { ...view, acknowledge: null }, ...reviewProps }));
  assert.doesNotMatch(calm, /data-acknowledge-import/);
  assert.match(calm, /data-approve-plan/);
  const cut = html(createElement(ImportReview, { view: { ...view, summary: { ...view.summary, tools: { rows: view.summary.tools.rows, more: 12 } } }, ...reviewProps }));
  assert.match(cut, /aria-label="I read 200 tools and the paths\. 12 tools are not shown: Import rope-yard"/, 'a cut list is named in the tick');
  assert.match(cut, /data-hidden="12"/);
});

test('while a new plan is on its way the old one stays, dimmed and busy, and the ticks wait', async () => {
  const view = await importView();
  const out = html(createElement(ImportReview, { view, ...reviewProps, stale: true, approved: false }));
  assert.match(out, /class="hxsh-stale" data-import-review="" aria-busy="true"/);
  assert.equal([...out.matchAll(/<input[^>]*disabled=""/g)].length, 2);
  assert.doesNotMatch(html(createElement(ImportReview, { view, ...reviewProps })), /hxsh-stale/);
  assert.match(css, /\.hxsh-stale \{ opacity: 0\.7; \}/);
});

test('the files it writes: those that run first, ten shown, a button for the rest that says whether it is open', async () => {
  const view = await importView();
  const out = html(createElement(ImportReview, { view, ...reviewProps }));
  const files = [...out.matchAll(/data-file="([^"]+)"/g)].map(m => m[1]!);
  assert.equal(files.length, 10, 'the sample plan has ten files, all shown');
  assert.deepEqual(files.slice(0, 2), ['.bowerloom/scripts/format-check.sh', '.bowerloom/skills/tally-stock/scripts/tally.sh'], 'the two that run come first');
  assert.doesNotMatch(out, /data-show-all-files/);
  const changes: SaveChangeView[] = Array.from({ length: 300 }, (_, i) => ({ path: `.bowerloom/skills/s${i}/SKILL.md`, action: 'create' as const, ...(i === 299 ? { executable: true as const } : {}) }));
  const big = html(createElement(ImportReview, { view: { ...view, changes }, ...reviewProps }));
  const shown = [...big.matchAll(/data-file="([^"]+)"/g)].map(m => m[1]!);
  assert.equal(shown.length, 10);
  assert.equal(shown[0], '.bowerloom/skills/s299/SKILL.md', 'the file that runs is first even when it is last in the plan');
  assert.match(big, /data-more="290"/);
  assert.match(big, /data-show-all-files=""[^>]*aria-expanded="false"[^>]*aria-controls="/);
});

test('the notes choices: Leave out is the default, Link a folder shows the folder\'s label and becomes Change folder, each button is described by its state line', async () => {
  const left = html(createElement(ImportReview, { view: await importView(), ...reviewProps }));
  assert.match(left, /data-note-choice="yard-wiki" data-choice="leave"/);
  assert.match(left, /<button[^>]*aria-pressed="false"[^>]*aria-label="Link a folder: yard-wiki"/);
  assert.match(left, /<button[^>]*aria-pressed="true"[^>]*aria-label="Leave out: yard-wiki"/);
  assert.ok(left.includes('Left out unless you link one.'));
  assert.match(left, /role="group" aria-label="Notes yard-wiki"/);
  const state = /id="([^"]+)" data-note-state/.exec(left)![1]!;
  assert.equal([...left.matchAll(new RegExp(`aria-describedby="${state}"`, 'g'))].length, 2, 'both buttons name the line that says what is chosen');
  const linked = html(createElement(ImportReview, { view: await importView({ link: { 'yard-wiki': SAMPLE_NOTES.use }, leave: [] }), ...reviewProps }));
  assert.match(linked, /data-note-choice="yard-wiki" data-choice="link"/);
  assert.match(linked, /<button[^>]*aria-pressed="true"[^>]*aria-label="Change folder: yard-wiki"/);
  assert.ok(linked.includes('Linked to') && linked.includes('~/Documents/Reading list'));
  assert.doesNotMatch(linked, /Left out unless you link one|Link a folder: yard-wiki/);
  assert.doesNotMatch(left, /data-leave-all/, 'one name needs no "Leave all out"');
});

test('five notes names or fewer are open; more are folded, with one button that leaves them all out', async () => {
  const view = await importView();
  const row = (i: number) => ({ name: `n${i}`, choice: i === 0 ? 'link' as const : 'leave' as const, label: i === 0 ? '~/Documents/a' : null, readBy: [] });
  const five = html(createElement(ImportReview, { view: { ...view, notes: Array.from({ length: 5 }, (_, i) => row(i)) }, ...reviewProps }));
  assert.match(five, /<details class="hxsh-notes" open="">/);
  assert.match(five, /data-leave-all=""/);
  const six = html(createElement(ImportReview, { view: { ...view, notes: Array.from({ length: 6 }, (_, i) => row(i)) }, ...reviewProps }));
  assert.match(six, /<details class="hxsh-notes">/);
  assert.doesNotMatch(six, /<details[^>]*open/);
  assert.match(six, /data-leave-all=""(?![^>]*aria-disabled)/, 'with a folder linked, the button works');
  const none = html(createElement(ImportReview, { view: { ...view, notes: Array.from({ length: 6 }, (_, i) => ({ ...row(i), choice: 'leave' as const, label: null })) }, ...reviewProps }));
  assert.match(none, /data-leave-all=""[^>]*aria-disabled="true"/, 'with nothing linked, there is nothing to leave out');
});

test('folder cards say which folders Import refuses, which it makes a harness in, and which it cannot tell', () => {
  const f = (over: Partial<FolderInfo>): FolderInfo => ({ id: 'folder-1', label: '~/Projects/a', name: 'a', hasDefinition: false, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false }, ...over });
  assert.deepEqual(importFolderLine(f({})), { words: 'No harness yet. Import makes one.', off: false });
  assert.deepEqual(importFolderLine(f({ hasDefinition: true, holdsParts: true, engines: ['claude-code'] })), { words: 'Has a harness. Choose an empty folder.', off: true });
  assert.deepEqual(importFolderLine(f({ hasDefinition: true, holdsParts: false })), { words: 'Has an empty harness.', off: false });
  assert.deepEqual(importFolderLine(f({ hasDefinition: true })), { words: 'Has a harness. It must be empty.', off: false }, 'not told, and no engines: the card does not call an empty harness wrong');
  assert.deepEqual(importFolderLine(f({ hasDefinition: true, engines: ['claude-code', 'codex'] })), { words: 'Claude Code and Codex', off: false });
  assert.deepEqual(importFolderLine(f({ hasDefinition: true, problem: 'It does not load.' })), { words: 'It does not load.', off: true });
  const out = html(createElement(FolderList, { folders: [f({}), f({ id: 'folder-2', hasDefinition: true, holdsParts: true })], picked: 'folder-1', busy: false, onPick: noop }));
  assert.match(out, /data-folder="folder-1"/);
  assert.match(out, /aria-disabled="true" data-off="" data-folder="folder-2"/);
  assert.ok(out.includes('Has a harness. Choose an empty folder.'));
});

test('the choices the window sends: a linked name maps to its notes id, the rest are left out, and a name like __proto__ is an own key', () => {
  assert.deepEqual(choicesOf(['a', 'b'], new Map([['a', 'notes-1']])), { link: { a: 'notes-1' }, leave: ['b'] });
  assert.deepEqual(choicesOf([], new Map()), { link: {}, leave: [] });
  const odd = choicesOf(['__proto__', 'constructor'], new Map([['__proto__', 'notes-2']]));
  assert.deepEqual(Object.keys(odd.link), ['__proto__']);
  assert.equal(Object.getPrototypeOf(odd.link), Object.prototype, 'the prototype is untouched');
  assert.deepEqual(odd.leave, ['constructor']);
});

test('the sheets\' fixed words are within the text budget', async () => {
  const view = await importView(), exp = await e.planExport(SAMPLE_FOLDERS.stopped);
  assert.ok(exp.ok);
  const pages: [string, string][] = [
    ['export', html(createElement(ExportBody, { view: exp.value as ExportView, acked: false, held: false, onAck: noop, unsaved: true }))],
    ['import file', html(createElement(BundleBody, { bundle: await bundle() }))],
    ['import review', html(createElement(ImportReview, { view, ...reviewProps }))],
  ];
  const own = [...view.changes.map(c => c.path), view.folder];
  for (const [name, markup] of pages) {
    // The preview's rule: "export", "import", "harness", "plan" and the other design words are allowed here, and every other banned word is not. The tick boxes' spoken
    // names are the engine sheets' own pattern (the visible words, a colon, the item), so their length is not held to a label.
    const problems = assertTextBudget(markup, { own }).filter(p => !/^Label "(?:I |Write |Make a harness|\d+ )/.test(p)).filter(p => { const m = /^The word "([^"]+)" is banned/.exec(p); return m === null || !DESIGN_WORDS.includes(m[1]!.toLowerCase()); });
    assert.deepEqual(problems, [], name);
    // The names of the files Bowerloom writes (mcp.json) are the person's own files, as on the save sheet, so they are taken out before the words are read.
    for (const piece of extractText(markup)) assert.equal(bannedHere(own.reduce((t, c) => t.split(c).join(' '), piece.text)), null, `${name}: ${piece.text}`);
  }
});

test('a tool shows its env, headers and address path whole; names that start code are flagged and references say they come from this computer', () => {
  const out = html(createElement(ShareSummaryView, {
    summary: { ...blank, tools: { rows: [
      tool({ name: 'a', env: [{ name: 'NODE_OPTIONS', value: '--require ./p.js' }, { name: 'REGION', value: '${REGION}' }, { name: 'PLAIN', value: 'north' }] }),
      tool({ name: 'b', transport: 'http', runsCode: false, command: null, host: 'h.example.test', headers: [{ name: 'Authorization', value: 'Bearer ${K}' }], path: '/v2/x?y=1#z' }),
      tool({ name: 'c', kind: 'hook', transport: null, command: 'sudo npx x', event: 'PostToolUse' }),
    ], more: 0 } }, side: 'import',
  }));
  assert.match(out, /data-pair="NODE_OPTIONS"[\s\S]*?--require \.\/p\.js/);
  assert.equal(out.split('data-changes-start=""').length - 1, 1, 'only NODE_OPTIONS starts code');
  assert.ok(out.includes('This changes how the program starts.'));
  assert.equal(out.split('data-from-computer=""').length - 1, 2, 'a reference in env and one in a header');
  assert.match(out, /data-pairs="headers"[\s\S]*Authorization[\s\S]*Bearer \$\{K\}/);
  assert.match(out, /data-path=""[\s\S]*\/v2\/x\?y=1#z/);
  assert.match(out, /data-tool="c"[\s\S]*data-admin=""/, 'a hook line is split before the admin check');
  assert.doesNotMatch(out, /data-pair="PLAIN"[^]*?data-changes-start[^]*?data-pair="REGION"/);
});
