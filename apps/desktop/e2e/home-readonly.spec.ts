/**
 * Wave F, read-only mode, in the real window (Electron started with --prototype-v2): `#prototype-v2/map/readonly` (and `#prototype-v2/readonly` for Welcome) shows the setup
 * and holds back every control that would change it. Each such control is still shown, in its place, in the Tab order, with `aria-disabled="true"` (not a native `disabled`, so
 * the keyboard and the pointer can still reach it) and a plain reason in its tooltip: "Read-only: your setup is not changed." The Save bar says "Read-only. Nothing here changes
 * your setup." and the Preview mark says "Read-only". Looking is unchanged: picking, details, trays, the Library tabs, filters and search, the version history list, "Look inside"
 * and "Create share file" (which builds in memory and writes nothing). The state of the setup (the agents and their counts, the Library counts, the list of versions, the Save bar)
 * is read before and after every control is pressed, with the mouse and with the keyboard: it never moves. With read only off, the same page works as it always has.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { ensurePicked, fresh, launchHome, resize, setLook, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const READ_ONLY_PAGE = '#prototype-v2/map/readonly';
const REASON = 'Read-only: your setup is not changed.';
const BAR = 'Read-only. Nothing here changes your setup.';
let home: Home;
const page = (): Page => home.page;
const nav = (): Locator => page().locator('nav.hm-nav');
/** An item of the navigation (the first, because with the Library open its page "Agents" has a namesake among the Library's own pages). */
const item = (name: string): Locator => nav().getByRole('button', { name, exact: true }).first();
const agentCards = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const panel = (): Locator => page().locator('aside.hm-panel');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const tip = (): Locator => page().getByRole('tooltip');
const mine = (): Locator => page().locator('[data-readonly]:visible');

/** The setup as the page shows it: every agent with its counts, the Library counts, the list of versions, and what the Save bar says. */
async function snapshot(): Promise<string> {
  const p = page();
  const tiles = await agentCards().evaluateAll(list => list.map(c => (c.textContent ?? '').replace(/\s+/g, ' ').trim()));
  const saveBar = ((await bar().innerText()).replace(/\s+/g, ' ')).trim();
  await item('Library').click();
  const tabs = await p.getByRole('tab').evaluateAll(list => list.map(t => (t.getAttribute('aria-label') ?? t.textContent ?? '').trim()));
  await item('Agents').click();
  await item('Version history').click();
  const points = await p.locator('[data-slot="points"] .pt-list li').evaluateAll(list => list.map(l => (l.textContent ?? '').replace(/\s+/g, ' ').trim()));
  await p.keyboard.press('Escape');
  await expect(p.getByRole('dialog', { name: 'Version history' })).toHaveCount(0);
  return JSON.stringify({ tiles, saveBar, tabs, points });
}
/** A control that is held back: shown, in the Tab order (not natively disabled), aria-disabled, and its tooltip gives the reason on the pointer and on the keyboard. */
async function expectHeld(control: Locator, why = REASON): Promise<void> {
  const p = page();
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute('aria-disabled', 'true');
  expect(await control.evaluate(el => (el as HTMLButtonElement).disabled)).toBe(false);
  const described = (await control.getAttribute('aria-describedby')) ?? '';
  expect(described.length).toBeGreaterThan(0);
  expect(await control.evaluate((el, ids) => ids.split(' ').some(id => document.getElementById(id)?.getAttribute('role') === 'tooltip' && document.getElementById(id)?.textContent === 'Read-only: your setup is not changed.'), described)).toBe(true);
  await control.hover();
  await expect(tip().filter({ hasText: why })).toBeVisible({ timeout: 2000 });
  await p.mouse.move(640, 790);
  await expect(tip()).toBeHidden();
}

test.beforeAll(async () => { test.setTimeout(240_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page(), READ_ONLY_PAGE);
  await resize(page(), 1280, 800);
  await skipTour(page());
});

// ---- The marks of the mode.
test('the Preview mark says Read-only with the same popover, the Save bar says so with Save held back, and there is no banner', async () => {
  const p = page();
  const mark = nav().locator('.hm-preview .kit-status');
  await expect(mark).toHaveText('Read-only');
  await expect(mark).toHaveAttribute('aria-label', 'About read-only mode');
  await expect(nav().getByText('Preview', { exact: true })).toHaveCount(0);
  await mark.click();
  const pop = p.locator('.kit-popover');
  await expect(pop.locator('p')).toHaveText('Read-only preview.');   // the made-up sample, not the person's own setup
  await expect(pop.getByRole('button')).toHaveText(['How it will work']);
  await p.keyboard.press('Escape');
  await expect(pop).toHaveCount(0); await expect(mark).toBeFocused();
  await expect(bar().locator('p')).toHaveText(BAR);
  await expect(p.getByText('Nothing to save yet')).toHaveCount(0);
  await expectHeld(bar().getByRole('button', { name: 'Save', exact: true }));
  // No banner and no alert: the mark and the bar are all there is.
  await expect(p.locator('[role="banner"], [role="alert"], .hm-banner')).toHaveCount(0);
  expect(await budget()).toEqual([]);
});

test('the Welcome address opens Welcome in read-only mode: the first scan only reads, so nothing there is held back, and the map then says Read-only', async () => {
  const p = page();
  await fresh(p, undefined, { welcome: true });
  await p.evaluate(() => { location.hash = '#prototype-v2/readonly'; location.reload(); });
  await p.waitForLoadState('domcontentloaded'); await p.waitForSelector('[data-home]');
  await resize(p, 1280, 800);
  await expect(p.locator('[data-screen="welcome"]')).toBeVisible();
  await expect(p.locator('[aria-disabled="true"]')).toHaveCount(0);
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await expect(p.locator('[aria-disabled="true"], [data-readonly]')).toHaveCount(0);
  await p.getByRole('button', { name: 'Looks right' }).click(); await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Agents', exact: true })).toBeVisible();
  await expect(nav().locator('.hm-preview .kit-status')).toHaveText('Read-only');
  await expect(bar().locator('p')).toHaveText(BAR);
  await expect(agentCards()).toHaveCount(10);
});

// ---- Every edit control is shown and held back.
test('on the map, every Remove in the details of an agent is held back with the reason, and so is Remove from an agent on a skill, a tool and a set of notes', async () => {
  const p = page();
  await agentCards().filter({ hasText: 'Meeting assistant' }).locator('.kit-card-main').click();
  const removes = panel().locator('[data-remove]');
  expect(await removes.count()).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < await removes.count(); i += 1) {
    const r = removes.nth(i);
    await expect(r).toHaveAttribute('aria-disabled', 'true');
    await expect(r).toHaveAttribute('aria-label', 'Remove');
    expect((await r.innerText()).trim()).toBe('');
    const box = (await r.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(32); expect(box.height).toBeGreaterThanOrEqual(32);
  }
  await expectHeld(removes.first());
  // A card can still be picked, and its details have a text Remove that is held back too.
  for (const [kind, name] of [['skill', 'Write a reply'], ['tool', 'Read my calendar'], ['note', 'Client list']] as const) {
    await panel().locator(`.kit-card[data-kind="${kind}"] .kit-card-main`, { hasText: name }).click();
    await expect(panel().getByRole('heading', { level: 2, name })).toBeVisible();
    await expectHeld(panel().getByRole('button', { name: /^Remove from / }));
    await panel().getByRole('button', { name: 'Back to agent' }).click();
  }
  await expect(panel().getByRole('heading', { level: 2, name: 'Meeting assistant' })).toBeVisible();
  expect(await budget()).toEqual([]);
});

test('"Choose notes" opens the sheet, because looking is allowed, and "Use these notes" is held back', async () => {
  const p = page();
  await agentCards().filter({ hasText: 'Meeting assistant' }).locator('.kit-card-main').click();
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  const layer = p.locator('[data-slot="notes"]');
  await expect(layer).toBeVisible(); await animationsDone(p);
  await layer.locator('.nt-topic, .nt-topic-button, [data-topic]').first().click({ trial: true }).catch(() => undefined);
  await expectHeld(layer.getByRole('button', { name: 'Use these notes' }));
  await layer.getByRole('button', { name: 'Cancel' }).click();
  await expect(layer).toHaveCount(0);
});

test('the "different copies" dialog opens, and "Keep this copy" is held back', async () => {
  const p = page();
  await ensurePicked(agentCards().filter({ hasText: 'Inbox sorter' }).locator('.kit-card-main'));   // the first agent is picked when the map opens
  await panel().getByRole('region', { name: 'Skills' }).getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog').first();
  await expect(dialog).toBeVisible(); await animationsDone(p);
  await expectHeld(dialog.getByRole('button', { name: 'Keep this copy' }).first());
  await p.keyboard.press('Escape');
  await expect(p.getByRole('dialog')).toHaveCount(0);
});

test('the Add drawer opens and lists its cards; "Add to" on each card, "Add" on a ready-made agent, and a drag onto an agent all do nothing', async () => {
  const p = page();
  await item('Add').click();
  const drawer = p.getByRole('dialog', { name: 'Add' });
  await expect(drawer).toBeVisible(); await animationsDone(p);
  const before = await agentCards().evaluateAll(list => list.map(c => (c.textContent ?? '').replace(/\s+/g, ' ')));
  const adds = drawer.locator('.add-row').getByRole('button', { name: /^Add to / });
  expect(await adds.count()).toBeGreaterThan(3);
  await expectHeld(adds.first());
  await adds.first().click({ force: true });
  await expect(p.getByRole('group', { name: 'Add to which agent?' })).toHaveCount(0);   // the picker never opens
  await drawer.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expectHeld(drawer.locator('.add-row').first().getByRole('button', { name: /^Add / }));
  // A card cannot be dragged: no row is draggable, and a drag onto an agent changes nothing.
  await drawer.getByRole('tab', { name: 'Skills', exact: true }).click();
  expect(await drawer.locator('.add-row[data-draggable]').count()).toBe(0);
  const card = (await drawer.locator('.add-row .kit-card-main').first().boundingBox())!, target = (await agentCards().first().boundingBox())!;
  await p.mouse.move(card.x + 30, card.y + 10); await p.mouse.down(); await p.mouse.move(card.x - 30, card.y + 20, { steps: 4 }); await p.mouse.move(target.x + 50, target.y + 30, { steps: 10 }); await p.mouse.up();
  await expect(p.locator('[data-fresh]')).toHaveCount(0);
  expect(await agentCards().evaluateAll(list => list.map(c => (c.textContent ?? '').replace(/\s+/g, ' ')))).toEqual(before);
  await expect(bar().locator('p')).toHaveText(BAR);
  await p.keyboard.press('Escape');
});

test('the Library: its tabs, search, sort and filter work; "Add to an agent", "Make my own copy" and "Remove from library" are held back; "Update" opens its dialog and "Use the update" is held back', async () => {
  const p = page();
  await item('Library').click();
  await expect(p.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  const list = p.locator('.lb-list');
  await p.getByRole('tab', { name: /^Tools/ }).click(); await expect(p.getByRole('tab', { name: /^Tools/ })).toHaveAttribute('aria-selected', 'true');
  await p.getByRole('tab', { name: /^Skills/ }).click();
  await p.getByRole('searchbox', { name: 'Search the library' }).fill('compare');
  await expect(list.locator('li')).toHaveCount(2); await p.getByRole('searchbox', { name: 'Search the library' }).fill('');
  await p.getByRole('button', { name: 'Sort', exact: true }).click(); await p.getByRole('menuitemradio', { name: 'Recently added' }).click();
  await p.getByRole('button', { name: /^Not used yet/ }).click(); await expect(p.getByRole('button', { name: /^Not used yet/ })).toHaveAttribute('aria-pressed', 'true'); await p.getByRole('button', { name: /^Not used yet/ }).click();
  await list.locator('.kit-card-main', { hasText: 'Compare two options' }).click();
  await expect(panel().getByRole('heading', { level: 2, name: 'Compare two options' })).toBeVisible();
  await expectHeld(panel().getByRole('button', { name: 'Add to an agent' }));
  await expectHeld(panel().getByRole('button', { name: 'Make my own copy' }));
  await expectHeld(panel().getByRole('button', { name: 'Remove from library' }));
  await panel().getByRole('button', { name: 'Add to an agent' }).click({ force: true });
  await expect(p.getByRole('group', { name: /Add to which agent/ })).toHaveCount(0);
  await list.locator('.kit-card-main', { hasText: 'Tidy my meeting notes' }).click();
  await panel().getByRole('button', { name: 'Update', exact: true }).click();
  const d = p.getByRole('dialog', { name: /update/i });
  await expect(d).toBeVisible(); await animationsDone(p);
  await expectHeld(d.getByRole('button', { name: 'Use the update' }));
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(bar().locator('p')).toHaveText(BAR);
  expect(await budget()).toEqual([]);
});

test('"Add from the web" opens its sheet and shows what a source holds; "Add N items" is held back', async () => {
  const p = page();
  await item('Library').click();
  await p.getByRole('button', { name: 'Add from the web' }).click();
  const sheet = p.locator('[data-slot="web"], .lb-sheet').first();
  await expect(sheet).toBeVisible(); await animationsDone(p);
  await sheet.locator('[data-source]').first().getByRole('button').first().click();
  await expect(sheet.getByText('From the web. Read it before you add it.')).toBeVisible();
  const add = sheet.getByRole('button', { name: /^Add \d+ items?$/ });
  await expectHeld(add);
  await add.click({ force: true });
  await expect(sheet).toBeVisible();   // nothing was added, so the sheet did not move on
  await p.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(bar().locator('p')).toHaveText(BAR);
});

// ---- Looking still works.
test('browsing, picking, details, trays and the version history list all work; "Look inside" works and "Create share file" builds its copy in memory', async () => {
  const p = page();
  await agentCards().nth(2).locator('.kit-card-main').click();
  await expect(agentCards().nth(2).locator('.kit-card-main')).toHaveAttribute('aria-pressed', 'true');
  await agentCards().filter({ hasText: 'Meeting assistant' }).getByRole('button', { name: '4 skills' }).click();
  await expect(p.locator('.kit-tray[data-open]')).toHaveCount(1);
  await p.locator('.kit-tray[data-open] .kit-card-main').first().click();
  await expect(panel().locator('h2')).not.toHaveText('Pick an agent');
  await panel().getByRole('button', { name: 'Show the full text' }).click(); await expect(panel().getByRole('region', { name: 'Full text' })).toBeVisible();
  await item('Version history').click();
  const history = p.getByRole('dialog', { name: 'Version history' });
  await expect(history).toBeVisible(); await expect(history.getByRole('list', { name: 'Version history' })).toBeVisible();
  // Share is a view of the saved agents: "Look inside" shows what travels, and "Create share file" builds the copy in memory.
  await history.getByRole('button', { name: 'Share my agents' }).click();
  const sheet = p.getByRole('dialog', { name: /^Share/ });
  await expect(sheet).toBeVisible(); await animationsDone(p);
  await expect(sheet.getByRole('button', { name: 'Create share file' })).toBeEnabled();
  await expect(sheet.locator('[aria-disabled="true"], [data-readonly]')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Look inside' }).click();
  await expect(sheet.getByRole('button', { name: 'Look inside' })).toHaveAttribute('aria-expanded', 'true');
  const downloads: string[] = []; p.on('download', d => downloads.push(d.suggestedFilename()));
  await sheet.getByRole('button', { name: 'Create share file' }).click();
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
  expect(downloads).toEqual([]);   // nothing is written or saved
  await sheet.getByRole('button', { name: 'Done' }).click();
  await p.keyboard.press('Escape');
  await expect(bar().locator('p')).toHaveText(BAR);
});

// ---- Nothing can be dispatched.
test('the setup never changes: every held control is pressed with the mouse and with the keyboard, and so are Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y; the agents, the Library counts, the versions and the Save bar are the same', async () => {
  const p = page();
  const before = await snapshot();
  // The map with an agent picked, then a skill, then the Add drawer, the Library and its dialogs: press whatever is held, in each place.
  const pressAll = async (): Promise<number> => {
    let n = 0;
    for (let i = 0; i < await mine().count(); i += 1) {
      const c = mine().nth(i);
      await c.click({ force: true, timeout: 3000 }).catch(() => undefined);
      await c.focus().catch(() => undefined);
      await p.keyboard.press('Enter'); await p.keyboard.press('Space');
      n += 1;
    }
    return n;
  };
  let pressed = 0;
  await agentCards().filter({ hasText: 'Meeting assistant' }).locator('.kit-card-main').click();
  pressed += await pressAll();
  await panel().locator('.kit-card[data-kind="skill"] .kit-card-main').first().click();
  pressed += await pressAll();
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await item('Add').click(); await animationsDone(p);
  pressed += await pressAll();
  await p.keyboard.press('Escape');
  await item('Library').click();
  await p.locator('.lb-list .kit-card-main').first().click();
  pressed += await pressAll();
  await item('Agents').click();
  expect(pressed).toBeGreaterThan(12);
  // Undo, redo and the usual keys of the other kind.
  await p.locator('.hm-grid .kit-card-main').first().focus();
  for (const key of ['ControlOrMeta+z', 'ControlOrMeta+Shift+z', 'ControlOrMeta+y']) await p.keyboard.press(key);
  expect(await snapshot()).toBe(before);
  await expect(bar().locator('p')).toHaveText(BAR);
  expect(await budget()).toEqual([]);
});

// ---- With read only off, nothing is held back.
test('with read only off the same pages work as they always have: nothing is held back and a Remove changes the setup', async () => {
  const p = page();
  await fresh(p, '#prototype-v2/map'); await resize(p, 1280, 800); await skipTour(p);
  await expect(nav().locator('.hm-preview .kit-status')).toHaveText('Preview');
  await expect(p.locator('[data-readonly], [aria-disabled="true"]')).toHaveCount(0);
  await agentCards().filter({ hasText: 'Meeting assistant' }).locator('.kit-card-main').click();
  await expect(p.locator('[data-readonly]')).toHaveCount(0);
  await panel().locator('[data-remove]').first().click();
  await expect(bar().getByText('Removed Summarize a meeting', { exact: true })).toBeVisible();
  await expect(bar().getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await item('Add').click(); await expect(p.locator('[data-readonly]')).toHaveCount(0);
  await p.keyboard.press('Escape');
  await item('Library').click(); await p.locator('.lb-list .kit-card-main').first().click(); await expect(p.locator('[data-readonly]')).toHaveCount(0);
});

// ---- Looks and sizes.
for (const [w, h] of [[1280, 800], [900, 600]] as const) for (const look of ['light', 'dark'] as const) {
  test(`at ${w} by ${h}, ${look}: a held-back control is readable and large enough, nothing overflows, and the text budget holds`, async () => {
    const p = page();
    await setLook(p, look); await resize(p, w, h);
    await agentCards().filter({ hasText: 'Meeting assistant' }).locator('.kit-card-main').click();
    await expect(panel().locator('[data-remove]').first()).toBeVisible();
    const held = await mine().evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { w: r.width, h: r.height, size: parseFloat(s.fontSize), name: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim() }; }));
    expect(held.length).toBeGreaterThan(3);
    for (const c of held) { expect(c.h, c.name).toBeGreaterThanOrEqual(32); expect(c.w, c.name).toBeGreaterThanOrEqual(32); expect(c.size, c.name).toBeGreaterThanOrEqual(14); }
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(bar().locator('p')).toBeVisible();
    const barBox = (await bar().boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(h + 0.5);
    expect(await budget()).toEqual([]);
  });
}
