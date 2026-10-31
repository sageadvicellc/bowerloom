// What `look` shows and how control numbers behave. A look holds text, roles, states and one screenshot path, and nothing else. The page-side collector
// is read as text here (it needs a real page to run, and the smoke test runs it for real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

interface Control { t: 'control'; depth: number; n: number; role: string; name: string; iconOnly: boolean; states: string[]; value: string | null; placeholder: string; off: boolean; [extra: string]: unknown }
type Item = { t: string; depth: number; [extra: string]: unknown };
interface Raw { width: number; height: number; title: string; dark: boolean; reduced: boolean; scrollY: number; scrollMax: number; focus: { n: number | null; role?: string; name?: string } | null; truncated: boolean; items: Item[]; [extra: string]: unknown }
interface LookModule {
  formatLook(raw: Raw, o?: { shot?: string | null; redactor?: (t: string) => string }): string;
  controlLine(c: Control): string;
  collectPage: { toString(): string };
  HANDLE_KEY: string;
}
interface HandlesModule {
  HandleTable: new () => { replace(n: number): void; invalidate(): void; indexOf(n: number): number; readonly count: number };
  goneMessage(n: number): string; coveredMessage(n: number): string; hiddenMessage(n: number): string; outMessage(n: number): string;
}
const look = async (): Promise<LookModule> => await import(join(DESKTOP, 'tools', 'personas', 'look.mjs')) as LookModule;
const handles = async (): Promise<HandlesModule> => await import(join(DESKTOP, 'tools', 'personas', 'handles.mjs')) as HandlesModule;

const control = (n: number, role: string, name: string, extra: Partial<Control> = {}): Control => ({ t: 'control', depth: 0, n, role, name, iconOnly: false, states: [], value: null, placeholder: '', off: false, ...extra });
const base = (items: Item[], extra: Partial<Raw> = {}): Raw => ({ width: 1280, height: 800, title: 'Bowerloom', dark: false, reduced: false, scrollY: 0, scrollMax: 0, focus: null, truncated: false, items, ...extra });

test('a look names the window, the focus, open layers, the tour, what is on, and the scroll, then the text in order, then the screenshot', async () => {
  const { formatLook } = await look();
  const text = formatLook(base([
    { t: 'region', depth: 0, role: 'main', name: '' },
    { t: 'heading', depth: 1, level: 1, text: 'Your agents' },
    { t: 'text', depth: 1, text: '10 agents. Pick one to see what it can do.' },
    control(5, 'button', 'Name', { depth: 1, states: ['pressed'] }),
    control(6, 'button', 'Add', { depth: 1, states: ['collapsed', 'has focus'] }),
    { t: 'region', depth: 0, role: 'dialog', name: 'Tour' },
    control(7, 'button', 'Next', { depth: 1 }),
  ], { focus: { n: 6 }, dark: true, reduced: true, scrollY: 100, scrollMax: 400 }), { shot: '/out/look-001.png' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'WINDOW: 1280 by 800, dark colours, reduced motion');
  assert.ok(lines.includes('TITLE: Bowerloom'));
  assert.ok(lines.includes('FOCUS: [6] button "Add"'));
  assert.ok(lines.includes('OPEN LAYERS: dialog "Tour"'));
  assert.ok(lines.includes('TOUR: open'));
  assert.ok(lines.some(l => l.startsWith('ON: ') && l.includes('[5] "Name" (pressed)') && l.includes('[6] "Add" (expanded)') === false));
  assert.ok(lines.includes('SCROLL: 25 percent down'));
  const body = lines.slice(lines.indexOf('---') + 1);
  assert.deepEqual(body.slice(0, 5), ['main:', '  heading 1: Your agents', '  10 agents. Pick one to see what it can do.', '  [5] button "Name" (pressed)', '  [6] button "Add" (collapsed, has focus)']);
  assert.ok(body.includes('dialog "Tour":'));
  assert.ok(body.includes('  [7] button "Next"'));
  assert.equal(lines.at(-1), 'SCREENSHOT: /out/look-001.png');
  assert.match(text, /3 numbered controls\./);
});

test('the tour, dialog and focus lines say "none" and "not open" when nothing is open, and the window scroll says so', async () => {
  const { formatLook } = await look();
  const text = formatLook(base([control(1, 'button', 'Find my agents', { states: ['has focus'] })], { focus: { n: 1 } }), { shot: null });
  assert.match(text, /^FOCUS: \[1\] button "Find my agents"$/m);
  assert.match(text, /^OPEN LAYERS: none$/m);
  assert.match(text, /^TOUR: not open$/m);
  assert.match(text, /^SCROLL: the window does not scroll$/m);
  assert.match(text, /1 numbered control\./);
  assert.doesNotMatch(text, /SCREENSHOT/);
  const ends = (y: number): string => formatLook(base([], { scrollY: y, scrollMax: 300 })).match(/^SCROLL: .*$/m)![0];
  assert.equal(ends(0), 'SCROLL: at the top');
  assert.equal(ends(300), 'SCROLL: at the bottom');
  assert.equal(formatLook(base([], { focus: { n: null, role: 'heading', name: 'Add' } })).match(/^FOCUS: .*$/m)![0], 'FOCUS: heading "Add" (not numbered)');
});

test('which things are selected, pressed or expanded is listed once, from the states of the controls', async () => {
  const { formatLook } = await look();
  const none = formatLook(base([control(1, 'button', 'Save', { states: ['disabled'] })]));
  assert.match(none, /^ON: nothing is selected, pressed or expanded$/m);
  const some = formatLook(base([control(1, 'tab', 'Skills', { states: ['selected'] }), control(2, 'button', 'Add', { states: ['expanded', 'has focus'] }), control(3, 'checkbox', 'Home folder', { states: ['checked'] })]));
  const on = some.match(/^ON: .*$/m)![0];
  assert.match(on, /\[1\] "Skills" \(selected\)/);
  assert.match(on, /\[2\] "Add" \(expanded\)/);
  assert.match(on, /\[3\] "Home folder" \(checked\)/);
  assert.doesNotMatch(on, /has focus/);
});

test('a control line shows its number, role and name, plus a value, a hint, its states, and what only a screen reader would hear', async () => {
  const { controlLine } = await look();
  assert.equal(controlLine(control(7, 'button', 'Add')), '[7] button "Add"');
  assert.equal(controlLine(control(2, 'textbox', 'Search', { value: 'inbox', placeholder: 'Type a name' })), '[2] textbox "Search" value="inbox" hint="Type a name"');
  assert.equal(controlLine(control(9, 'button', 'Close', { iconOnly: true })), '[9] button "Close" (shows an icon only, no visible words)');
  assert.equal(controlLine(control(3, 'button', 'Show', { states: ['disabled'], off: true })), '[3] button "Show" (disabled, out of view)');
  assert.equal(controlLine(control(4, 'clickable', '')), '[4] clickable (no name)');
  assert.equal(controlLine(control(5, 'textbox', 'Name', { value: '' })), '[5] textbox "Name" value=""');
  assert.equal(controlLine(control(6, 'button', 'Say "hi"')), "[6] button \"Say 'hi'\"", 'a quote inside a name cannot break the line');
});

test('a look writes only text, roles, names, states, values and hints: extra fields of the input (markup, classes, ids, styles, selectors, scripts) never appear', async () => {
  const { formatLook } = await look();
  const leaky: Control = control(1, 'button', 'Add', {
    outerHTML: '<button class="kit-btn" data-tour="add" id="secret-id" style="color:red">Add</button>', className: 'kit-btn', id: 'secret-id', selector: '#root > div.kit-btn', style: 'color:red', href: 'file:///etc/passwd', onclick: 'function(){steal()}',
  });
  const raw: Raw = { ...base([leaky, { t: 'text', depth: 0, text: 'Plain words', html: '<p class="x">Plain words</p>', className: 'copy', id: 'lead' }]), innerHTML: '<div>whole page</div>', url: 'file:///Users/x/app/index.html', cookie: 'a=b', cwd: '/Users/x/repo' };
  const text = formatLook(raw, { shot: '/out/look-001.png' });
  for (const banned of ['<button', '</', '<p', 'class=', 'kit-btn', 'data-tour', 'secret-id', 'color:red', 'file://', '/etc/passwd', 'steal', 'whole page', '#root', 'a=b', '/Users/x', 'outerHTML', 'innerHTML', 'selector']) assert.ok(!text.includes(banned), `look must not show ${banned}`);
  assert.ok(text.includes('[1] button "Add"') && text.includes('Plain words'));
  assert.doesNotMatch(text, /<\/?[a-z][^>]*>/i, 'no markup tag anywhere');
});

test('the look is passed through the redactor, but the screenshot path is added after it and kept whole', async () => {
  const { formatLook } = await look();
  const text = formatLook(base([{ t: 'text', depth: 0, text: 'Folder /work/repo/apps here' }]), { shot: '/work/out/look-001.png', redactor: t => t.split('/work/repo').join('<path>') });
  assert.match(text, /Folder <path>\/apps here/);
  assert.match(text, /\nSCREENSHOT: \/work\/out\/look-001\.png$/);
});

test('a list longer than the page holds says so, and an image with no description says so', async () => {
  const { formatLook } = await look();
  const text = formatLook(base([{ t: 'image', depth: 0, text: '(no description)' }, { t: 'image', depth: 0, text: 'The leaf logo' }], { truncated: true }));
  assert.match(text, /^image: \(no description\)$/m);
  assert.match(text, /^image: The leaf logo$/m);
  assert.match(text, /There is more on the screen than this list holds\. Scroll and look again\./);
});

test('the page-side collector reads names, text and states, and its source has no way to return markup, classes, ids, styles or links', async () => {
  const { collectPage, HANDLE_KEY } = await look();
  const source = collectPage.toString();
  for (const banned of [/outerHTML/, /innerHTML/, /classList/, /className/, /getAttribute\(\s*['"](?:class|style|id|src|href|data-[a-z-]+)['"]\s*\)/, /\.outerText/, /serializeToString/, /XMLSerializer/, /documentElement\.(?:outer|inner)/, /\.cookie/, /localStorage/, /sessionStorage/, /location\.href/, /document\.URL/, /\bfetch\(/, /\beval\(/, /new Function/, /import\(/]) assert.doesNotMatch(source, banned, String(banned));
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-expanded/);
  assert.equal(HANDLE_KEY, 'bowerloom.persona.handles');
});

test('numbers are stable within a look, replaced by the next look, and old after a goto', async () => {
  const { HandleTable, goneMessage, coveredMessage, hiddenMessage, outMessage } = await handles();
  const table = new HandleTable();
  // Before any look.
  assert.throws(() => table.indexOf(1), /no numbered controls yet\. Run look first/);
  table.invalidate();
  assert.throws(() => table.indexOf(1), /Run look first/, 'a goto before any look changes nothing');
  // After a look of 5 controls.
  table.replace(5);
  assert.equal(table.count, 5);
  for (let i = 0; i < 3; i += 1) { assert.equal(table.indexOf(1), 0); assert.equal(table.indexOf(5), 4); assert.equal(table.indexOf(3), 2); }
  assert.throws(() => table.indexOf(6), /There is no control \[6\]\. The last look showed \[1\] to \[5\]\./);
  assert.throws(() => table.indexOf(0), /There is no control \[0\]/);
  assert.throws(() => table.indexOf(1.5), /There is no control/);
  // After navigation the numbers are old, and the error says what to do.
  table.invalidate();
  assert.throws(() => table.indexOf(3), /Control \[3\] is out of date, because the screen was started again\. Run look to get new numbers\./);
  assert.throws(() => table.indexOf(1), /out of date/);
  // The next look makes them valid again, with a new count.
  table.replace(2);
  assert.equal(table.indexOf(2), 1);
  assert.throws(() => table.indexOf(3), /\[1\] to \[2\]/);
  // The messages for a control that the page no longer has all tell the persona to look again.
  for (const m of [goneMessage(4), coveredMessage(4), hiddenMessage(4), outMessage(4)]) { assert.match(m, /Control \[4\]/); assert.doesNotMatch(m, /Error:|undefined|<\/|\bat \S+\.(?:mjs|tsx?)/); }
  assert.match(goneMessage(4), /Run look/);
  assert.match(coveredMessage(4), /Close what is on top of it, or run look/);
});
