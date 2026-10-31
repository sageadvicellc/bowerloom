// The Export and Import sheets' parts, drawn as markup: what a bundle holds (counts, tools with their command or host and flags, files that can run with why, values
// read from this computer with the tool and host each goes to, notes names, paths of another computer), the cap of 200 rows with "and N more", text from a file that
// is plain, cut and never wide, the ticks, and the notes choices. The made-up bundle is the sample bridge's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSampleEngine, SAMPLE_FOLDERS, SAMPLE_NOTES } from '../shared/engine/sample.js';
import { SHARE_LIST_LIMIT } from '../shared/engine/types.js';
import type { BundleView, ExportView, ImportView, SaveChangeView, ShareSummary } from '../shared/engine/types.js';
import { ExportBody, ExportDone } from '../renderer/harness/sheets/ExportSheet.js';
import { BundleBody, ImportReview, choicesOf } from '../renderer/harness/sheets/ImportSheet.js';
import { Capped, SecretsSection, ShareSummaryView } from '../renderer/harness/sheets/share-parts.js';
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
async function importView(choices = { link: {}, leave: ['yard-wiki'] } as Parameters<typeof choicesOf>[1] extends never ? never : { link: Record<string, string>; leave: string[] }): Promise<ImportView> {
  const b = await bundle(), a = await e.planImport(SAMPLE_FOLDERS.adopt, b.bundleId, choices);
  assert.ok(a.ok);
  return a.value;
}
const reviewProps = { approved: false, acknowledged: false, held: false, onApprove: noop, onAcknowledge: noop, onLink: noop, onLeave: noop };

test('the summary lists the counts, each tool with its command or host, why a file can run, each value with the tool and host it goes to, the notes names and the paths', async () => {
  const out = html(createElement(ShareSummaryView, { summary: await summaryOf(), side: 'import' }));
  assert.match(out, /data-count="skills"><dt>Skills<\/dt><dd>2<\/dd>/);
  assert.match(out, /data-count="mcp"|data-count="tools"><dt>Tools<\/dt><dd>2<\/dd>/);
  assert.match(out, /data-count="bytes"><dt>Size<\/dt>/);
  // A tool that starts a program shows the command in full, with its arguments, and the "Runs code" mark; a remote tool shows the host it reaches.
  assert.match(out, /data-tool="stock-db"[^>]*data-runs-code=""/);
  assert.ok(out.includes('npx -y stock-db-server@2.0.1 --yard north'));
  assert.match(out, /data-tool="orders-api"/);
  assert.match(out, /Reaches:[\s\S]*?orders\.example\.test/);
  assert.match(out, /data-tool="format-check"[^>]*data-runs-code=""/);
  assert.ok(out.includes('PostToolUse'));
  assert.equal([...out.matchAll(/Runs code/g)].length, 2, 'two tools run code, and the remote one does not');
  // Files that can run, each with why.
  for (const path of ['hooks.json', 'scripts/format-check.sh', 'skills/tally-stock/scripts/tally.sh']) assert.ok(out.includes(`data-code-file="${path}"`), path);
  assert.ok(out.includes('The file of a hook.') && out.includes('Has the run permission.'));
  // Values from this computer: each name, its kind, and every sink.
  assert.match(out, /data-secret="ORDERS_KEY" data-kind="env"/);
  assert.ok(out.includes('orders-api, in a header, to orders.example.test'));
  assert.ok(out.includes('stock-db, in an environment value'));
  assert.ok(out.includes('The file passes these values from this computer to these tools.'));
  assert.ok(out.includes('Bowerloom did not check that these exist.'));
  assert.doesNotMatch(out, /\badd\b/i);
  // Notes names, and a path of another computer, with its line.
  assert.match(out, /data-note="yard-wiki"/);
  assert.ok(out.includes('Paths from another computer'));
  assert.match(out, /data-foreign-path="instructions\/AGENTS\.md"/);
  assert.ok(out.includes('Line 12') && out.includes('/Users/example/yard-notes'));
  assert.ok(out.includes('They stay as written.'));
});

test('an export names the paths of this computer, not another one; an empty list says so in words', () => {
  const out = html(createElement(ShareSummaryView, { summary: blank, side: 'export' }));
  assert.ok(out.includes('Paths from this computer') && !out.includes('Paths from another computer'));
  for (const words of ['No tools in this file.', 'No file in this harness can run.', 'No values from this computer.', 'No notes folders.', 'No path from another computer.']) assert.ok(out.includes(words), words);
  assert.doesNotMatch(out, /data-borrowed|Borrowed items/);
  assert.doesNotMatch(out, /data-more/);
});

test('a list shows at most 200 rows, then "and N more", counting what main cut', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ kind: 'env' as const, name: `VALUE_${i}`, sinks: [{ tool: 'docs', field: 'env' as const, host: null }] }));
  const cut = html(createElement(SecretsSection, { summary: { ...blank, secrets: { rows: rows.slice(0, SHARE_LIST_LIMIT), more: 50 } }, side: 'import' }));
  assert.equal([...cut.matchAll(/data-secret="/g)].length, 200);
  assert.match(cut, /data-more="50"[^>]*>and 50 more</);
  assert.match(cut, /<span class="hxe-count">250<\/span>/);
  // A window that was sent more than 200 rows draws 200 and counts the rest itself.
  const over = html(createElement(SecretsSection, { summary: { ...blank, secrets: { rows, more: 7 } }, side: 'import' }));
  assert.equal([...over.matchAll(/data-secret="/g)].length, 200);
  assert.match(over, /data-more="57"/);
  const exact = html(createElement(Capped, { list: { rows: ['a', 'b'], more: 0 }, label: 'List', empty: 'None', render: (r: string) => createElement('li', { key: r }, r) }));
  assert.doesNotMatch(exact, /data-more/);
});

test('text from a file is plain text, cut to three lines and never wider than its box; a script in a name is written out, not run', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const long = 'x'.repeat(200);
  const summary: ShareSummary = {
    ...blank,
    tools: { rows: [{ name: evil, kind: 'mcp', transport: 'stdio', runsCode: true, command: `sh -c "${long}"`, args: [], host: null, event: null, flags: ['credentials', 'backslash'] }], more: 0 },
    notes: { rows: [{ name: '<b>wiki</b>', readBy: [evil] }], more: 0 },
  };
  const out = html(createElement(ShareSummaryView, { summary, side: 'import' }));
  assert.doesNotMatch(out, /<img|<b>/);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(out.includes(long));
  assert.match(out, /class="hxsh-cut hxe-mono" data-budget="content">sh -c &quot;x{200}&quot;</);
  assert.ok(out.includes('The address holds a user name or password.') && out.includes('The address uses a backslash.'));
  const css = readFileSync(join(DESKTOP, 'renderer', 'harness', 'sheets', 'share.css'), 'utf8');
  assert.match(css, /\.hxsh-cut \{[^}]*-webkit-line-clamp: 3[^}]*overflow: hidden[^}]*overflow-wrap: anywhere/);
});

test('the export sheet: the file name and size, the summary, and the tick only when a path of this computer is in the files', async () => {
  const plain = await e.planExport(SAMPLE_FOLDERS.defined), ticked = await e.planExport(SAMPLE_FOLDERS.stopped);
  assert.ok(plain.ok && ticked.ok);
  const a = html(createElement(ExportBody, { view: plain.value, acked: false, held: false, onAck: noop }));
  assert.match(a, /data-export-file="weekly-report\.bowerloom\.json"/);
  assert.match(a, /weekly-report\.bowerloom\.json<\/span> <span class="hxe-muted">[0-9.]+ (?:bytes|KB)</);
  assert.ok(a.includes('Export writes the saved harness to one file.'));
  assert.doesNotMatch(a, /data-acknowledge-paths/);
  const b = html(createElement(ExportBody, { view: ticked.value, acked: false, held: false, onAck: noop }));
  assert.match(b, /data-acknowledge-paths=""/);
  assert.match(b, /aria-label="I read the paths from this computer: reading\.bowerloom\.json"/);
  assert.doesNotMatch(b, /<input[^>]*checked=""/);
  assert.match(html(createElement(ExportBody, { view: ticked.value, acked: true, held: false, onAck: noop })), /<input[^>]*checked=""/);
  assert.match(html(createElement(ExportBody, { view: ticked.value, acked: false, held: true, onAck: noop })), /<input[^>]*disabled=""/);
  const done = html(createElement(ExportDone, { written: { name: 'x.bowerloom.json', bytes: 2048 } }));
  assert.ok(done.includes('Exported') && done.includes('x.bowerloom.json, 2.0 KB'));
});

test('the import file step shows the file, says a file from another person is data, and lists what it holds', async () => {
  const out = html(createElement(BundleBody, { bundle: await bundle() }));
  assert.match(out, /data-bundle-name="rope-yard\.bowerloom\.json"/);
  assert.ok(out.includes('A file from another person is data. Read the files that run.'));
  assert.match(out, /data-count="skills"/);
  assert.match(out, /data-note="yard-wiki"/, 'the notes names are listed before the folder is picked');
});

test('the import review lists every file it writes, marks the ones that run, and asks for both ticks before it writes', async () => {
  const view = await importView();
  const out = html(createElement(ImportReview, { view, ...reviewProps }));
  assert.equal([...out.matchAll(/data-file="/g)].length, view.changes.length);
  assert.match(out, /data-file="\.bowerloom\/scripts\/format-check\.sh" data-action="create" data-executable=""/);
  assert.ok(out.includes('Can run as a program.'));
  assert.match(out, /data-acknowledge-import=""/);
  assert.match(out, /aria-label="I read the tools, files and values it lists: Import rope-yard"/);
  assert.match(out, /data-approve-plan=""/);
  assert.ok(out.includes(`I approve plan ${view.revision.slice(0, 8)}`));
  assert.ok(out.includes('A file from another person is data. Read the files that run.'));
  assert.ok(out.includes('The file passes these values from this computer to these tools.'));
  assert.ok(out.includes('Bowerloom writes only the files below, into the .bowerloom folder.'));
  // No tick on the pointer: both are off until given, and held while a write runs.
  assert.doesNotMatch(out, /<input[^>]*checked=""/);
  assert.equal([...html(createElement(ImportReview, { view, ...reviewProps, approved: true, acknowledged: true })).matchAll(/<input[^>]*checked=""/g)].length, 2);
  const held = html(createElement(ImportReview, { view, ...reviewProps, held: true }));
  assert.equal([...held.matchAll(/<input[^>]*disabled=""/g)].length, 2, 'both ticks are held while a write runs');
  assert.equal([...held.matchAll(/<button[^>]*disabled=""/g)].length, 2, 'so are the two notes buttons');
  // A plan with nothing to acknowledge shows no acknowledgement tick.
  const calm = html(createElement(ImportReview, { view: { ...view, acknowledge: null }, ...reviewProps }));
  assert.doesNotMatch(calm, /data-acknowledge-import/);
  assert.match(calm, /data-approve-plan/);
});

test('the notes choices: Leave out is the default, Link a folder shows the folder\'s label, and each button has its own name', async () => {
  const left = html(createElement(ImportReview, { view: await importView(), ...reviewProps }));
  assert.match(left, /data-note-choice="yard-wiki" data-choice="leave"/);
  assert.match(left, /<button[^>]*aria-pressed="false"[^>]*aria-label="Link a folder: yard-wiki"/);
  assert.match(left, /<button[^>]*aria-pressed="true"[^>]*aria-label="Leave out: yard-wiki"/);
  assert.ok(left.includes('Left out unless you link one.'));
  assert.match(left, /role="group" aria-label="Notes yard-wiki"/);
  const linked = html(createElement(ImportReview, { view: await importView({ link: { 'yard-wiki': SAMPLE_NOTES.use }, leave: [] }), ...reviewProps }));
  assert.match(linked, /data-note-choice="yard-wiki" data-choice="link"/);
  assert.match(linked, /<button[^>]*aria-pressed="true"[^>]*aria-label="Link a folder: yard-wiki"/);
  assert.ok(linked.includes('Linked to') && linked.includes('~/Documents/Reading list'));
  assert.doesNotMatch(linked, /Left out unless you link one/);
});

test('the choices the window sends: a linked name maps to its notes id, the rest are left out, and a name like __proto__ is an own key', () => {
  assert.deepEqual(choicesOf(['a', 'b'], new Map([['a', 'notes-1']])), { link: { a: 'notes-1' }, leave: ['b'] });
  assert.deepEqual(choicesOf([], new Map()), { link: {}, leave: [] });
  const odd = choicesOf(['__proto__', 'constructor'], new Map([['__proto__', 'notes-2']]));
  assert.deepEqual(Object.keys(odd.link), ['__proto__']);
  assert.equal(Object.getPrototypeOf(odd.link), Object.prototype, 'the prototype is untouched');
  assert.deepEqual(odd.leave, ['constructor']);
});

test('a long list of files the import writes shows 200 rows and "and N more"', async () => {
  const view = await importView();
  const changes: SaveChangeView[] = Array.from({ length: 300 }, (_, i) => ({ path: `.bowerloom/skills/s${i}/SKILL.md`, action: 'create' as const }));
  const out = html(createElement(ImportReview, { view: { ...view, changes }, ...reviewProps }));
  assert.equal([...out.matchAll(/data-file="/g)].length, 200);
  assert.match(out, /data-more="100"/);
});

test('the sheets\' fixed words are within the text budget', async () => {
  const view = await importView(), exp = await e.planExport(SAMPLE_FOLDERS.stopped);
  assert.ok(exp.ok);
  const pages: [string, string][] = [
    ['export', html(createElement(ExportBody, { view: exp.value as ExportView, acked: false, held: false, onAck: noop }))],
    ['import file', html(createElement(BundleBody, { bundle: await bundle() }))],
    ['import review', html(createElement(ImportReview, { view, ...reviewProps }))],
  ];
  for (const [name, markup] of pages) {
    // The preview's rule: "export", "import", "harness", "plan" and the other design words are allowed here, and every other banned word is not. The tick boxes' spoken
    // names are the engine sheets' own pattern (the visible words, a colon, the item), so their length is not held to a label.
    const problems = assertTextBudget(markup, { own: view.changes.map(c => c.path) }).filter(p => !/^Label "[^"]*: /.test(p)).filter(p => { const m = /^The word "([^"]+)" is banned/.exec(p); return m === null || !DESIGN_WORDS.includes(m[1]!.toLowerCase()); });
    assert.deepEqual(problems, [], name);
    // The names of the files Bowerloom writes (mcp.json) are the person's own files, as on the save sheet, so they are taken out before the words are read.
    for (const piece of extractText(markup)) assert.equal(bannedHere(view.changes.reduce((t, c) => t.split(c.path).join(' '), piece.text)), null, `${name}: ${piece.text}`);
  }
});
