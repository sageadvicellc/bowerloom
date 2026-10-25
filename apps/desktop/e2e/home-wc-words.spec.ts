/**
 * Wave C, group 3, in the real window: Find says the total and how many agents work in more than one app (worked out from the world) with a one-line note about the apps;
 * "Choose one by one" for "Pick by hand"; "passwords and keys" wherever keys were named alone; the Share sheet's "Create share file" and "Look inside" (every skill, agent, tool
 * and set of notes by name, the text that travels behind "Show text", and a plain warning with the item unticked when that text looks like it holds a key); and the copies
 * dialog that says what happens to the other copy. Set HOME_WC_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { toolTiles } from '../shared/home/find-model.js';
import { ownedAgents } from '../shared/home/cards.js';
import { withLibrarySamples } from '../shared/home/library-sample.js';
import { planShare, shareableAgents } from '../shared/home/share-model.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { withStarterAgents } from '../shared/home/starters.js';
import { generateWorld } from '../shared/proto/sample.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone } from './proto-wait.js';
import { WELCOME_PAGE, ensurePicked, fresh, launchHome, resize, setLook, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

const SHOTS = process.env.HOME_WC_SHOTS ?? null;
if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
const REVIEW = [[1280, 800], [900, 600]] as const;
const LOOKS = ['light', 'dark'] as const;

// The world the app opens with, worked out here from the same pieces, so the numbers in the page are checked against the world and not against a copy of the page.
const world = withLibrarySamples(withStarterAgents(withSampleCopies(generateWorld(1))));
const ids = shareableAgents(world).map(a => a.id);
const all = planShare(world, ids, []);
// The agents found in two or more of the apps, counted here by hand from what each agent was found in.
const MULTI = ownedAgents(world).filter(a => new Set(a.foundAt.map(f => f.interface)).size > 1).length;

let home: Home;
const page = (): Page => home.page;
const header = (): Locator => page().locator('header.hm-bar');
const bar = (): Locator => page().getByRole('region', { name: 'Save bar' });
const panel = (): Locator => page().locator('aside.hm-panel');
const sheet = (): Locator => page().getByRole('dialog', { name: 'Share my agents' });
const budget = async (): Promise<string[]> => assertTextBudget(await page().evaluate(() => document.querySelector('[data-home]')!.outerHTML));
const shot = async (name: string, w: number, h: number, look: string): Promise<void> => { if (SHOTS === null) return; await animationsDone(page()); await page().screenshot({ path: join(SHOTS, `${name}-${look}-${w}x${h}.png`), scale: 'css' }); };

test.beforeAll(async () => { test.setTimeout(300_000); home = await launchHome(); });
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await resize(page(), 1280, 800);
  await skipTour(page());
});

async function openFind(): Promise<void> {
  await fresh(page(), WELCOME_PAGE, { welcome: true });
  await page().getByRole('button', { name: 'Find my agents' }).click();
  await expect(page().getByRole('heading', { level: 1, name: /^Found \d+ agents?$/ })).toBeVisible();
}
async function openSheet(): Promise<void> {
  await header().getByRole('button', { name: 'Share', exact: true }).click();
  await expect(sheet()).toBeVisible();
  await animationsDone(page());
}

test('Find says "Found 10 agents", how many of them work in more than one app, and what the three tiles are', async () => {
  const p = page();
  await openFind();
  const tiles = toolTiles(world);
  const sum = tiles.reduce((n, t) => n + t.agents, 0);
  // The tiles count an agent once for each app it works in, so they add up to more than the agents. The line says how many agents are in more than one app.
  expect(sum).toBeGreaterThan(10);
  expect(MULTI).toBeGreaterThan(0);
  await expect(p.getByRole('heading', { level: 1 })).toHaveText('Found 10 agents');
  await expect(p.locator('[data-multi]')).toHaveText(`${MULTI} work in more than one app.`);
  await expect(p.locator('.fr-apps')).toHaveText('These are the apps your agents work in.');
  await expect(p.locator('.hm-sr[role="status"]')).toHaveText(`Found 10 agents. ${MULTI} work in more than one app.`);
  const statuses = await p.locator('.fr-tile-status').allInnerTexts();
  expect(statuses.map(s => s.replace(/\s+/g, ' ').trim())).toEqual(tiles.map(t => `${t.agents} ${t.agents === 1 ? 'agent' : 'agents'}`));
  // The note sits above the three tiles, and the line right under the total.
  const [title, multi, note, tilesBox] = [(await p.getByRole('heading', { level: 1 }).boundingBox())!, (await p.locator('[data-multi]').boundingBox())!, (await p.locator('.fr-apps').boundingBox())!, (await p.locator('.fr-tiles').boundingBox())!];
  expect(multi.y).toBeGreaterThanOrEqual(title.y + title.height - 2);
  expect(note.y).toBeGreaterThanOrEqual(multi.y + multi.height - 2);
  expect(tilesBox.y).toBeGreaterThanOrEqual(note.y + note.height - 2);
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('find-counts', w, h, look); }
});

test('"Choose one by one" is the name of the step that picks single notes, and "Pick by hand" is nowhere in the window', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Meeting assistant', exact: true }));
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  const layer = p.locator('[data-slot="notes"]');
  await expect(layer).toBeVisible();
  await expect(layer.getByRole('button', { name: 'Choose one by one', exact: true })).toBeVisible();
  await layer.getByRole('button', { name: 'Choose one by one', exact: true }).click();
  await expect(layer.getByRole('heading', { level: 3, name: 'Choose one by one' })).toBeFocused();
  expect(await p.locator('[data-home]').innerText()).not.toMatch(/pick by hand/i);
  expect(await budget()).toEqual([]);
});

test('the Share sheet has "Create share file" as its main button, and says "passwords and keys" where it said keys', async () => {
  const p = page();
  await openSheet();
  await expect(sheet().getByRole('button', { name: 'Create share file' })).toBeEnabled();
  await expect(sheet().getByRole('button', { name: 'Save a copy' })).toHaveCount(0);
  await expect(sheet().locator('.sh-left')).toHaveText(`Left out: ${all.keys} passwords and keys and 1 ready-made item`);
  await expect(sheet().getByText('Passwords and keys that Bowerloom keeps are left out.')).toBeVisible();
  const text = await sheet().innerText();
  // "keys" never stands alone in the sheet: it always comes after "passwords and".
  expect(text.match(/(?<!passwords and )\bkeys\b/gi) ?? []).toEqual([]);
  expect(await budget()).toEqual([]);
  await sheet().getByRole('button', { name: 'Create share file' }).click();
  await expect(sheet().getByRole('heading', { level: 3, name: 'Share file ready' })).toBeFocused();
  await expect(sheet().getByText('Nothing was written to your computer in this preview.')).toBeVisible();
  void p;
});

test('Look inside lists every skill, agent, tool and set of notes that goes in, by name, with its text behind Show text', async () => {
  const p = page();
  await openSheet();
  const look = sheet().getByRole('button', { name: 'Look inside', exact: true });
  await expect(look).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet().locator('.sh-look-list')).toHaveCount(0);
  await look.click();
  await expect(look).toHaveAttribute('aria-expanded', 'true');
  const items = sheet().locator('.sh-look-item');
  await expect(items).toHaveCount(all.counts.skills + all.counts.agents + all.counts.tools + all.counts.noteSets);
  for (const [kind, n] of [['skill', all.counts.skills], ['agent', all.counts.agents], ['tool', all.counts.tools], ['note', all.counts.noteSets]] as const) await expect(sheet().locator(`.sh-look-item[data-kind="${kind}"]`)).toHaveCount(n);
  // The names are the words of the cards, never a file name.
  const names = await items.locator('.sh-row-name').allInnerTexts();
  expect(names.every(n => n.trim() !== '')).toBe(true);
  expect(names.join('\n')).not.toMatch(/\.md\b|\/Users\//);
  await expect(sheet().locator('.sh-look-item[data-kind="agent"] .sh-row-name').filter({ hasText: 'Meeting assistant' })).toHaveCount(1);
  // Each item opens its own text, and closes it.
  const first = sheet().locator('.sh-look-item[data-kind="skill"]').first();
  const toggle = first.getByRole('button', { name: 'Show text' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const text = first.getByRole('region', { name: 'Text that travels' });
  await expect(text).toBeVisible();
  expect((await text.innerText()).trim().length).toBeGreaterThan(10);
  await expect(first.getByRole('button', { name: 'Hide text' })).toHaveAttribute('aria-expanded', 'true');
  expect(await budget()).toEqual([]);
  await first.getByRole('button', { name: 'Hide text' }).click();
  await expect(text).toHaveCount(0);
  // A tool shows its name and the name of its key, and never a value.
  const tool = sheet().locator('.sh-look-item[data-kind="tool"]').first();
  await tool.getByRole('button', { name: 'Show text' }).click();
  await expect(tool.getByRole('region', { name: 'Text that travels' })).toBeVisible();
  expect(await sheet().locator('.sh-look-item[data-kind="tool"] .sh-text').allInnerTexts().then(t => t.join(' '))).not.toMatch(/sk-|ghp_|AKIA/);
  // A set of notes shows its rule, not a page.
  const notes = sheet().locator('.sh-look-item[data-kind="note"]').first();
  await notes.getByRole('button', { name: 'Show text' }).click();
  await expect(notes.getByRole('region', { name: 'Text that travels' })).toContainText(/Topic: [A-Z]|Kind:|Label:/);
  expect(await notes.getByRole('region', { name: 'Text that travels' }).innerText()).not.toContain('/');
  for (const [w, h] of REVIEW) for (const look2 of LOOKS) { await resize(p, w, h); await setLook(p, look2); await shot('share-look-inside', w, h, look2); }
});

/** A file of one agent with its skills, whose first skill carries a key-shaped string, made new so it lands as all new. */
function fileWithKey(): string {
  const one = planShare(world, [ids[0]!], []);
  const swap = (s: string): string => `${s}-b`;
  const b = JSON.parse(one.text) as { items: Record<string, unknown>[]; toolRefs: Record<string, unknown>[]; sliceRules: Record<string, unknown>[] };
  let planted = false;
  for (const i of b.items) {
    i.id = swap(String(i.id)); i.name = swap(String(i.name));
    const d = i.definition as { name: string; skillIds: string[]; toolAttachments: { toolId: string }[]; sliceId?: string } | undefined;
    if (d !== undefined) { d.name = swap(d.name); d.skillIds = d.skillIds.map(swap); for (const t of d.toolAttachments) t.toolId = swap(t.toolId); if (d.sliceId !== undefined) d.sliceId = swap(d.sliceId); }
    else if (!planted) { for (const f of i.foundAt as { text: string }[]) f.text = `${f.text}\napi_key = sk-live-abcdefghijklmnop1234567`; planted = true; }
  }
  for (const t of b.toolRefs) { t.toolId = swap(String(t.toolId)); t.name = swap(String(t.name)); }
  for (const s of b.sliceRules) { s.sliceId = swap(String(s.sliceId)); s.name = swap(String(s.name)); }
  expect(planted).toBe(true);
  return JSON.stringify(b);
}

test('a skill whose text looks like it holds a key is marked, starts unticked, and is left out of the file until it is ticked on purpose', async () => {
  const p = page();
  await header().getByRole('button', { name: 'Add', exact: true }).click();
  const drawer = p.locator('[data-slot="add"]');
  await drawer.getByRole('tab', { name: 'From a shared file' }).click();
  await drawer.locator('input[type="file"]').setInputFiles({ name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(fileWithKey()) });
  await drawer.getByRole('button', { name: 'Add these' }).click();
  await expect(drawer.getByText(/^Added \d+ things? from the file\.$/)).toBeVisible();
  await p.keyboard.press('Escape');
  await bar().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar().getByText('Saved in this preview. Your files are untouched.', { exact: true })).toBeVisible();
  await openSheet();
  const summary = sheet().locator('[data-flagged-line]');
  await expect(summary).toHaveText('1 item looks like it holds a key. It is left out.');
  await expect(sheet().locator('.sh-left')).toContainText('1 item');
  const before = await sheet().locator('.sh-counts').innerText();
  await sheet().getByRole('button', { name: 'Look inside', exact: true }).click();
  const flagged = sheet().locator('.sh-look-item[data-flagged]');
  await expect(flagged).toHaveCount(1);
  await expect(flagged.getByRole('checkbox')).not.toBeChecked();
  await expect(flagged.getByText('This text looks like it holds a key.')).toBeVisible();
  await expect(sheet().locator('.sh-look-item:not([data-flagged]) .sh-warn')).toHaveCount(0);
  await flagged.getByRole('button', { name: 'Show text' }).click();
  await expect(flagged.getByRole('region', { name: 'Text that travels' })).toContainText('sk-live-abcdefghijklmnop1234567');
  expect(await budget()).toEqual([]);
  for (const [w, h] of REVIEW) for (const look of LOOKS) { await resize(p, w, h); await setLook(p, look); await shot('share-key-warning', w, h, look); }
  await resize(p, 1280, 800); await setLook(p, 'light');
  // Ticking it brings it into the file (one more skill), and the summary says to look first.
  await flagged.getByRole('checkbox').check();
  await expect(sheet().locator('.sh-counts')).not.toHaveText(before);
  await expect(summary).toHaveText('1 item looks like it holds a key. Look inside first.');
  await expect(sheet().locator('.sh-left')).not.toContainText('1 item');
  await flagged.getByRole('checkbox').uncheck();
  await expect(sheet().locator('.sh-counts')).toHaveText(before);
});

test('the dialog for two different copies says what happens to the other copy', async () => {
  const p = page();
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Inbox sorter', exact: true }));
  await panel().getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Pick the copy to keep.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('The other copy is replaced by this one when you Save.', { exact: true })).toBeVisible();
  expect(await dialog.innerText()).not.toContain('goes away');
  await expect(dialog).toHaveAttribute('aria-describedby', /\S+ \S+/);
  expect(await budget()).toEqual([]);
});
