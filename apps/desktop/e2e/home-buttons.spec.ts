/**
 * Wave F, every button on every screen: it either has words you can see, or it is an icon button with an accessible name (an aria-label of at most 5 words), a tooltip
 * (a real `role="tooltip"` that describes it) and a target of at least 32 px by 32 px. A button with words is at least 24 px high (a text link) and a kit button 32 px. The
 * walk goes through the Welcome screen, the whole of Find (the list, the details, the second question), the map in every state that has a button of its own (an agent picked, a
 * skill, a tool and a set of notes, the trays, "Show where it lives", the note after Remove, the list of changes), the navigation open, as a rail and as a drawer, the sort
 * menu, the Add drawer on each of its tabs, Version history, Share, "How it will work", the "different copies" dialog, Choose notes, the Library on each page with its
 * dialogs and its web sheet, Find more, the tour, the two popovers, the kit gallery, and the map in read-only mode. A screen that adds a button without a name or a tooltip fails here.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
const page = (): Page => home.page;
const nav = (): Locator => page().locator('nav.hm-nav');
const item = (name: string): Locator => nav().getByRole('button', { name, exact: true }).first();
const cards = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"]');
const panel = (): Locator => page().locator('aside.hm-panel');
const dialog = (name: string | RegExp): Locator => page().getByRole('dialog', { name });

interface Seen { buttons: number; icons: number; problems: string[] }
/** Reads every button that is on show, and reports what is wrong with each. */
async function walk(label: string): Promise<Seen> {
  return page().evaluate(where => {
    const problems: string[] = [];
    let buttons = 0, icons = 0;
    const visibleWords = (el: Element): string => {
      let text = '';
      const go = (node: Node): void => {
        if (node.nodeType === 3) { text += node.textContent ?? ''; return; }
        if (!(node instanceof Element) || node.matches('svg, .hm-sr, [aria-hidden="true"]')) return;
        const r = node.getBoundingClientRect();
        if (r.width <= 1.5 && r.height <= 1.5) return;   // the words of an item of the rail: clipped to a pixel, there for a screen reader
        for (const child of node.childNodes) go(child);
      };
      go(el);
      return text.replace(/\s+/g, ' ').trim();
    };
    for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('[inert], [hidden]') !== null) continue;
      buttons += 1;
      // A state of a card ("2 different copies") may show its short form from a pseudo-element: its words are in the text, whatever the container shows.
      const words = visibleWords(el) || (el.classList.contains('kit-status') ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : ''), r = el.getBoundingClientRect();
      const hidden = (el.textContent ?? '').replace(/\s+/g, ' ').trim();   // words that a screen reader has and the eye does not (an item of the rail)
      const label_ = el.getAttribute('aria-label') ?? '';
      const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(' ').filter(Boolean).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const name = (label_ !== '' ? label_ : labelledBy !== '' ? labelledBy : words !== '' ? words : hidden).trim();
      const nameOf = `${where}: ${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${name || el.outerHTML.slice(0, 60)}"`;
      if (name === '') problems.push(`${nameOf} has no name`);
      if (words !== '') {
        // The name of a card (or of an agent in a picker) is the button whose ::after covers the whole card or row, so its target is that, not the line of its own box.
        if (r.height < 23.5 && !el.classList.contains('kit-card-main') && !el.classList.contains('add-pick-main')) problems.push(`${nameOf} has words but is ${r.height.toFixed(1)} px high`);
        if (el.classList.contains('kit-button') && r.height < 31.5) problems.push(`${nameOf} is a kit button ${r.height.toFixed(1)} px high`);
        continue;
      }
      icons += 1;
      if (label_.trim() === '' && labelledBy === '' && hidden === '') problems.push(`${nameOf} is an icon with no name`);
      if (name.split(/\s+/).filter(Boolean).length > 5) problems.push(`${nameOf} has a name over 5 words`);
      const described = (el.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);
      const tip = described.find(e => e.getAttribute('role') === 'tooltip');
      if (tip === undefined) problems.push(`${nameOf} is an icon with no tooltip`);
      else if ((tip.textContent ?? '').trim() === '') problems.push(`${nameOf} has an empty tooltip`);
      else if ((tip.textContent ?? '').trim().split(/\s+/).length > 12) problems.push(`${nameOf} has a tooltip over 12 words`);
      if (r.width < 31.5 || r.height < 31.5) problems.push(`${nameOf} is an icon ${r.width.toFixed(1)} by ${r.height.toFixed(1)} px`);
    }
    return { buttons, icons, problems };
  }, label);
}
const covered = new Map<string, Seen>();
async function audit(label: string): Promise<void> {
  await animationsDone(page());
  const seen = await walk(label);
  covered.set(label, seen);
  expect(seen.problems, label).toEqual([]);
  expect(seen.buttons, `${label} has buttons`).toBeGreaterThan(0);
}

test.beforeAll(async () => { test.setTimeout(480_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

test('Welcome and the whole of Find: every button has words, or a name, a tooltip and 32 px', async () => {
  const p = page();
  await fresh(p, undefined, { welcome: true }); await resize(p, 1280, 800);
  await audit('Welcome');
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await audit('Find, the list');
  await p.getByRole('button', { name: 'Show details' }).click();
  await audit('Find, the places');
  await p.getByRole('button', { name: 'Hide details' }).click();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await audit('Find, the second question');
  const icons = covered.get('Find, the second question')!.icons;
  expect(icons, 'Back is an icon').toBeGreaterThanOrEqual(1);
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible();
  await audit('The tour, step one');
  await p.getByRole('dialog', { name: 'Tour' }).getByRole('button', { name: 'Next' }).click();
  await audit('The tour, the step that waits');
  await p.keyboard.press('Escape');
});

test('the map: an agent, a skill, a tool and a set of notes, the trays, where it lives, the note after Remove and the list of changes', async () => {
  const p = page();
  await audit('The map, an agent picked');
  expect(covered.get('The map, an agent picked')!.icons).toBeGreaterThanOrEqual(8);   // the toggles, the sort, and a Remove on each card
  await cards().filter({ hasText: 'Meeting assistant' }).getByRole('button', { name: '4 skills' }).click();
  await audit('A tray');
  await p.locator('.kit-tray[data-open] .kit-card-main').first().click();
  await audit('A skill');
  await panel().getByRole('button', { name: 'Show where it lives' }).click();
  await audit('A skill, where it lives');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await panel().locator('.kit-card[data-kind="tool"] .kit-card-main').first().click(); await audit('A tool');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  await panel().locator('.kit-card[data-kind="note"] .kit-card-main').first().click(); await audit('A set of notes');
  await panel().getByRole('button', { name: 'Back to agent' }).click();
  // Remove three, so the note has its Undo and the bar has its list.
  for (let i = 0; i < 3; i += 1) await panel().locator('.kit-card[data-kind="skill"] [data-remove]').first().click();
  await audit('The note after Remove');
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: '3 changes' }).click();
  await audit('The list of changes');
  await p.keyboard.press('Escape');
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  await audit('The Save bar after Save');
  await panel().locator('.kit-card[data-kind="skill"] .kit-card-main').first().click();
});

test('the navigation open, as a rail and as a drawer; the sort menu; the popovers; and the details put away', async () => {
  const p = page();
  await audit('The navigation, open');
  await item('Library').click(); await audit('The navigation, with the Library open');
  await item('Agents').click();
  await p.getByRole('button', { name: 'Sort', exact: true }).click(); await audit('The sort menu'); await p.keyboard.press('Escape');
  await item('Help').click(); await audit('The Help popover'); await p.keyboard.press('Escape');
  await nav().locator('.hm-preview .kit-status').click(); await audit('The Preview popover'); await p.keyboard.press('Escape');
  await p.locator('[data-details-toggle]').click(); await audit('The details put away');
  await p.locator('[data-details-toggle]').click();
  await p.locator('nav.hm-nav [data-nav-toggle]').click(); await audit('The navigation as a rail');
  expect(covered.get('The navigation as a rail')!.icons).toBeGreaterThanOrEqual(9);   // every item is an icon with a tooltip now
  await p.locator('nav.hm-nav [data-nav-toggle]').click();
  await resize(p, 880, 600);
  await audit('The map under 900 px');
  await p.locator('.hm-topbar [data-nav-toggle]').click(); await audit('The navigation as a drawer');
  await p.keyboard.press('Escape');
});

test('the Add drawer on each tab, Version history after a save, Share, How it will work and the copies dialog', async () => {
  const p = page();
  await item('Add').click();
  const drawer = dialog('Add');
  await expect(drawer).toBeVisible();
  for (const tab of ['Skills', 'Tools', 'Notes', 'Agents', 'From a shared file']) { await drawer.getByRole('tab', { name: tab, exact: true }).click(); await audit(`Add, ${tab}`); }
  await drawer.getByRole('tab', { name: 'Skills', exact: true }).click();
  expect(covered.get('Add, Skills')!.icons, 'Show more and Close are icons').toBeGreaterThanOrEqual(2);
  await drawer.locator('.add-row').first().getByRole('button', { name: /^Add to / }).click();
  await audit('Add, the picker');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  // A save, so Version history has a row with "Go back to this".
  await ensurePicked(cards().first().locator('.kit-card-main'));
  await panel().locator('[data-remove]').first().click();
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  await item('Version history').click(); await expect(dialog('Version history')).toBeVisible();
  await audit('Version history');
  await dialog('Version history').getByRole('button', { name: 'Share my agents' }).click();
  await expect(dialog(/^Share/)).toBeVisible(); await audit('Share');
  await dialog(/^Share/).getByRole('button', { name: 'Look inside' }).click(); await audit('Share, look inside');
  await dialog(/^Share/).getByRole('button', { name: 'Create share file' }).click(); await audit('Share, done');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await nav().locator('.hm-preview .kit-status').click(); await p.locator('.kit-popover').getByRole('button', { name: 'How it will work' }).click();
  await expect(dialog('How it will work')).toBeVisible(); await audit('How it will work');
  await p.keyboard.press('Escape');
  await ensurePicked(cards().first().locator('.kit-card-main'));
  await panel().getByRole('region', { name: 'Skills' }).getByRole('button', { name: '2 different copies' }).first().click();
  await expect(p.getByRole('dialog', { name: 'Two different copies' })).toBeVisible(); await audit('The copies dialog');
  await p.keyboard.press('Escape');
});

test('Choose notes, on its topics and by hand', async () => {
  const p = page();
  await cards().filter({ hasText: 'Meeting assistant' }).locator('.kit-card-main').click();
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  const layer = p.locator('[data-slot="notes"]');
  await expect(layer).toBeVisible(); await audit('Choose notes, topics');
  await layer.getByRole('button', { name: 'Choose one by one' }).click(); await audit('Choose notes, by hand');
  expect(covered.get('Choose notes, by hand')!.icons, 'All topics is an arrow').toBeGreaterThanOrEqual(1);
  await layer.getByRole('button', { name: 'Cancel' }).click();
});

test('the Library on each page, its dialogs and its web sheet', async () => {
  const p = page();
  await item('Library').click();
  for (const name of ['Skills', 'Agents', 'Tools', 'Notes']) { await p.getByRole('tab', { name: new RegExp(`^${name}`) }).click(); await audit(`Library, ${name}`); }
  await p.getByRole('tab', { name: /^Skills/ }).click();
  await p.locator('.lb-list .kit-card-main', { hasText: 'Compare two options' }).click(); await audit('Library, a skill');
  await panel().getByRole('button', { name: 'Remove from library' }).click();
  await expect(p.getByRole('dialog').first()).toBeVisible(); await audit('Library, Remove from library');
  await p.keyboard.press('Escape');
  await p.locator('.lb-list .kit-card-main', { hasText: 'Tidy my meeting notes' }).click();
  await panel().getByRole('button', { name: 'Update', exact: true }).click();
  await expect(p.getByRole('dialog').first()).toBeVisible(); await audit('Library, Update'); await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Add from the web' }).click();
  const sheet = p.locator('.lb-sheet, [data-slot="web"]').first();
  await expect(sheet).toBeVisible(); await audit('The web sheet, the sources');
  await sheet.locator('[data-source]').first().getByRole('button').first().click(); await audit('The web sheet, a source');
  await p.keyboard.press('Escape');
});

test('Find more as a panel, and the kit gallery', async () => {
  const p = page();
  await item('Find more').click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible(); await audit('Find more, the list');
  await p.getByRole('button', { name: 'Looks right' }).click(); await audit('Find more, the second question');
  await p.getByRole('button', { name: 'Not now' }).click();
  await fresh(p, '#prototype-v2/kit'); await resize(p, 1280, 800); await audit('The kit gallery');
});

test('the map in read-only mode: the held-back controls are buttons too, with their words or a name and the reason for a tooltip', async () => {
  const p = page();
  await fresh(p, '#prototype-v2/map/readonly'); await resize(p, 1280, 800); await skipTour(p);
  await audit('Read-only, the map');
  await item('Add').click(); await audit('Read-only, the Add drawer'); await p.keyboard.press('Escape');
  await item('Library').click(); await p.locator('.lb-list .kit-card-main').first().click(); await audit('Read-only, the Library');
  const kinds = [...covered.keys()];
  expect(kinds.length).toBeGreaterThan(30);
  console.log(`MEASURED walk: ${kinds.length} screens, ${[...covered.values()].reduce((n, s) => n + s.buttons, 0)} buttons, ${[...covered.values()].reduce((n, s) => n + s.icons, 0)} of them icon buttons`);
});
