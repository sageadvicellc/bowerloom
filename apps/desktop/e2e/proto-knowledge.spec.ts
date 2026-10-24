/**
 * Journey 5 in the real prototype window (launched with --prototype and a temporary data folder): open Knowledge, pick a slice, read its
 * page count, build rules, pick on the graph with a real pointer drag, and compare every page count on screen with a count made here, straight
 * from the generated page list. The count made here does NOT call matchPages: the folder, type, tag and link rules are written again below.
 * Set PROTO_KNOWLEDGE_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600. Run `npm run bundle` first, so dist matches the source.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../shared/proto/sample.js';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.env.PROTO_KNOWLEDGE_SHOTS ?? null;
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
const SIZES = [[1440, 900], [900, 600]] as const;
const world = generateWorld(1);
const pages = world.wikiPages;

interface Rule { folders: string[]; types: string[]; tags: string[]; hops: 0 | 1 | 2; seeds: string[] }

/** The independent count: the three handles written again, with no call to the rule engine. */
function expectedIds(r: Rule): Set<string> {
  const out = new Set<string>();
  for (const p of pages) {
    if (r.folders.some(f => p.folder === f || p.folder.startsWith(`${f}/`)) || r.types.includes(p.type) || p.tags.some(t => r.tags.includes(t))) out.add(p.id);
  }
  const byId = new Map(pages.map(p => [p.id, p] as const));
  let frontier: string[] = [];
  for (const s of r.seeds) if (byId.has(s)) { out.add(s); frontier.push(s); }
  for (let hop = 0; hop < r.hops; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) for (const to of byId.get(id)!.links) if (byId.has(to)) { out.add(to); next.push(to); }
    frontier = next;
  }
  return out;
}

let app: ElectronApplication, page: Page;

async function launch(reduced = false): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'bowerloom-proto-knowledge-'));
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await resize(1440, 900);
}
test.afterEach(async () => { await app.close(); });

async function resize(w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0]!.setContentSize(size.w, size.h); }, { w, h });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(w);
  await page.waitForTimeout(250);
}
async function shoot(name: string, prepare?: () => Promise<void>, after?: () => Promise<void>): Promise<void> {
  if (shotsDir === null) return;
  for (const [w, h] of [...SIZES].reverse()) {
    await resize(w, h);
    if (prepare !== undefined) await prepare();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(shotsDir, `${name}-${w}x${h}.png`), scale: 'css' });
    if (after !== undefined) await after();
  }
}
const scrollTo = (loc: Locator, block: 'start' | 'center' = 'start') => async (): Promise<void> => { await loc.evaluate((el, b) => { el.scrollIntoView({ block: b as ScrollLogicalPosition }); }, block); };

async function openKnowledge(): Promise<number> {
  const before = Date.now();
  await page.locator('nav.nav').getByRole('button', { name: 'Knowledge' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Knowledge' })).toBeVisible();
  await expect(page.locator('.kn-canvas')).toHaveAttribute('data-settled', '1', { timeout: 30_000 });
  return Date.now() - before;
}
const count = (): Promise<number> => page.getByTestId('slice-count').innerText().then(Number);
async function chooseSlice(name: string): Promise<void> { await page.getByLabel('Choose a slice').selectOption({ label: name }); }
const folderBox = (folder: string): Locator => page.locator(`input[data-folder="${folder}"]`);

/** Screen position of a page on the graph, from the real picture, in page (CSS) pixels. */
async function screenOfPage(id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(i => {
    const host = document.querySelector('.kn-canvas') as (HTMLElement & { graphView?: { screenOf(id: string): { x: number; y: number } | null } }) | null;
    const p = host?.graphView?.screenOf(i) ?? null, r = host?.getBoundingClientRect();
    return p === null || p === undefined || r === undefined ? null : { x: p.x + r.left, y: p.y + r.top };
  }, id);
}
async function canvasBox(): Promise<{ x: number; y: number; width: number; height: number }> { const b = await page.locator('.kn-canvas').boundingBox(); expect(b).not.toBeNull(); return b!; }

/** Drags a loop with the real pointer: down, a path, up. `keys` are held during the drag. */
async function dragLoop(points: { x: number; y: number }[], keys: ('Shift' | 'Alt')[] = [], hold = false): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.move(points[0]!.x, points[0]!.y, { steps: 2 });
  if (!hold) await page.mouse.up();
  for (const k of keys) await page.keyboard.up(k);
}
const ring = (cx: number, cy: number, r: number, n = 24): { x: number; y: number }[] => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));
function insidePolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

test('journey 5: pick a slice, read the preview, build rules, lasso on the graph, and every count matches a count made from the page list', async () => {
  test.setTimeout(180_000);
  await launch();
  const settle = await openKnowledge();
  console.log(`settle: ${settle} ms from the click to a settled graph`);
  await expect(page.getByRole('img', { name: /^Graph of the wiki\. 700 pages, \d+ links, 8 domain folders\./ })).toBeVisible();
  await expect(page.getByTestId('graph-status')).toHaveText('The graph has settled.');
  await shoot('01-first-view');

  // 1. The sample slices: the page count on screen is the count made from the page list.
  for (const slice of world.slices) {
    await chooseSlice(slice.name);
    const want = expectedIds({ folders: [...slice.rule.folders], types: [...slice.rule.pageTypesAndTags.types], tags: [...slice.rule.pageTypesAndTags.tags], hops: slice.rule.linksFromSeeds?.hops ?? 0, seeds: [...slice.seeds] });
    await expect(page.getByTestId('slice-count')).toHaveText(String(want.size));
    await expect(page.getByRole('status').filter({ hasText: /pages are in this slice|page is in this slice/ }).or(page.locator('.kn-count'))).toContainText('in this slice');
  }
  await chooseSlice(world.slices[0]!.name);
  const first = world.slices[0]!;
  const lit = expectedIds({ folders: [...first.rule.folders], types: [], tags: [], hops: 0, seeds: [...first.seeds] });
  await expect(page.getByTestId('slice-count')).toHaveText(String(lit.size));
  await expect(page.getByText(/^The pages add up to about [\d,]+ tokens\. This is a rough estimate\.$/)).toBeVisible();
  await expect(page.getByText(/^\d+ pages joined since your last visit\.$/)).toHaveText('3 pages joined since your last visit.');
  await expect(page.getByText(/links? leaves? this slice\. They are drawn as dashed lines on the graph\./)).toBeVisible();
  await expect(page.getByText(/^The agent gets a map of \d+ pages: a title and one line for each\./)).toBeVisible();
  for (const i of world.interfaces) {
    const label = `${{ 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }[i.id]}: ${i.enforcement}`;
    await expect(page.locator('.kn-badge', { hasText: label })).toBeVisible();
  }
  await expect(page.getByText('The agent cannot read pages outside this slice.')).toBeVisible();
  await expect(page.getByText('nothing stops it from reading other pages.').first()).toBeVisible();
  await shoot('02-slice-lit-dashed');
  await shoot('05-preview-panel-badges', scrollTo(page.locator('.kn-badges'), 'center'));
  await scrollTo(page.getByRole('heading', { level: 1, name: 'Knowledge' }))();

  // 2. Build a rule: the count follows every change, and always matches the independent count.
  await page.getByRole('button', { name: 'Make a new slice' }).click();
  await expect(page.getByTestId('slice-count')).toHaveText('0');
  await page.getByRole('radio', { name: 'Build a rule' }).check();
  const domain = world.wikiPages.find(p => p.folder.startsWith(pages[5]!.folder.split('/')[0]!))!.folder.split('/')[0]!;
  const sub = [...new Set(pages.filter(p => !p.folder.startsWith(`${domain}/`)).map(p => p.folder))][2]!;
  const rule: Rule = { folders: [], types: [], tags: [], hops: 0, seeds: [] };
  const check = async (what: string): Promise<void> => {
    const want = expectedIds(rule).size;
    await expect(page.getByTestId('slice-count'), what).toHaveText(String(want));
    console.log(`rule check: ${what} -> ${want} pages`);
  };
  await folderBox(domain).check(); rule.folders.push(domain); await check(`folder ${domain}`);
  await page.getByRole('button', { name: new RegExp(`^Show the \\d+ folders inside ${domain}$`) }).click();
  await expect(page.getByRole('group', { name: `Folders inside ${domain}` })).toBeVisible();
  await expect(page.getByRole('group', { name: `Folders inside ${domain}` }).locator('input:disabled').first()).toBeChecked();
  await page.getByRole('button', { name: new RegExp(`^Show the \\d+ folders inside ${sub.split('/')[0]}$`) }).click();
  await folderBox(sub).check(); rule.folders.push(sub); await check(`folder ${domain} and ${sub}`);
  const tag = [...new Set(pages.flatMap(p => p.tags))].sort()[3]!;
  await page.getByRole('group', { name: 'Tags' }).or(page.locator('fieldset', { has: page.locator('legend', { hasText: /^Tags$/ }) })).getByRole('checkbox', { name: new RegExp(`^${tag} `) }).check();
  rule.tags.push(tag); await check(`plus the tag ${tag}`);
  const type = [...new Set(pages.map(p => p.type))].sort()[1]!;
  await page.locator('fieldset', { has: page.locator('legend', { hasText: /^Page types$/ }) }).getByRole('checkbox', { name: new RegExp(`^${type} `) }).check();
  rule.types.push(type); await check(`plus the page type ${type}`);
  await shoot('04-rule-builder', scrollTo(page.getByRole('heading', { level: 2, name: 'Pick the pages' })));
  // A seed page and the hops.
  const seed = pages.filter(p => p.links.length >= 4 && !expectedIds(rule).has(p.id))[0]!;
  await page.getByLabel('Search the list').fill(seed.title);
  await page.getByRole('radio', { name: /^All \d+ pages$/ }).check();
  await page.getByRole('checkbox', { name: `Pick ${seed.title}`, exact: true }).check();
  rule.seeds.push(seed.id); await check('plus one picked page');
  await page.getByRole('radio', { name: /^1 hop/ }).check(); rule.hops = 1; await check('plus 1 hop from the picked page');
  await page.getByRole('radio', { name: /^2 hops/ }).check(); rule.hops = 2; await check('plus 2 hops');
  await page.getByRole('radio', { name: 'No links' }).check(); rule.hops = 0; await check('back to no links');
  await folderBox(domain).uncheck(); rule.folders = rule.folders.filter(f => f !== domain); await check('the whole folder taken off');
  await expect(page.getByText('everything in the', { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId('rule-words')).not.toContainText(/glob|regex|pattern/i);

  // 3. Pick on the graph: the lasso, with a real pointer.
  await page.getByRole('radio', { name: 'Pick on the graph' }).check();
  await page.getByRole('button', { name: 'Make a new slice' }).click();
  await scrollTo(page.getByRole('heading', { level: 1, name: 'Knowledge' }))();
  const lasso = page.getByRole('button', { name: /^Lasso: / });
  await expect(lasso).toHaveAttribute('aria-pressed', 'false');
  await lasso.click();
  await expect(lasso).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.kn-overlay')).toHaveClass(/kn-lasso-on/);
  // The pages that are on the picture now, with their places on the screen, and the busiest place among them.
  const plan = async (): Promise<{ placed: { id: string; at: { x: number; y: number } }[]; centre: { x: number; y: number } }> => {
    const box = await canvasBox();
    const placed = (await Promise.all(pages.map(async p => ({ id: p.id, at: await screenOfPage(p.id) })))).filter((n): n is { id: string; at: { x: number; y: number } } => n.at !== null && n.at.x > box.x + 20 && n.at.x < box.x + box.width - 20 && n.at.y > box.y + 20 && n.at.y < box.y + box.height - 20);
    expect(placed.length).toBeGreaterThan(600);
    const centre = placed.reduce((best, n) => { const near = placed.filter(m => Math.hypot(m.at.x - n.at.x, m.at.y - n.at.y) < 30).length; return near > best.near ? { n, near } : best; }, { n: placed[0]!, near: 0 }).n.at;
    return { placed, centre };
  };
  // A loop mid-drag, at both sizes, for the screenshots. Escape ends it without picking anything.
  await shoot('03-lasso-mid-drag', async () => {
    await scrollTo(page.getByRole('heading', { level: 1, name: 'Knowledge' }))();
    const here = await plan();
    await dragLoop(ring(here.centre.x, here.centre.y, 55).slice(0, 19), [], true);
    await expect(page.getByTestId('graph-status')).toContainText(/\d+ pages? inside the loop\./);
  }, async () => { await page.keyboard.press('Escape'); await page.mouse.up(); });
  await expect(page.locator('.kn-picked')).toContainText('No pages are picked yet.');
  await scrollTo(page.getByRole('heading', { level: 1, name: 'Knowledge' }))();
  const { placed, centre } = await plan();
  await expect(lasso).toHaveAttribute('aria-pressed', 'true');
  const loop = ring(centre.x, centre.y, 38);
  const inside = placed.filter(n => insidePolygon(n.at, loop)).map(n => n.id);
  expect(inside.length).toBeGreaterThan(5);
  await dragLoop(loop, [], true);
  await expect(page.getByTestId('graph-status')).toContainText(/\d+ pages? inside the loop\./);
  await page.mouse.up();
  await expect(page.locator('.kn-picked')).toContainText(`${inside.length} pages picked.`);
  await expect(page.locator('#kn-way-graph .kn-rule')).toBeVisible();
  const words = await page.locator('#kn-way-graph .kn-rule').innerText();
  console.log(`lasso: ${inside.length} pages inside the loop, rule: ${words}`);
  expect(words).not.toMatch(/glob|regex|pattern|helper|team/i);
  await expect(page.getByTestId('slice-count')).toHaveText(String(expectedIds({ folders: [], types: [], tags: [], hops: 0, seeds: inside }).size));
  // Shift adds, Alt removes.
  const other = placed.filter(n => !inside.includes(n.id) && Math.hypot(n.at.x - centre.x, n.at.y - centre.y) > 90)[0]!;
  const loop2 = ring(other.at.x, other.at.y, 20, 16), inside2 = placed.filter(n => insidePolygon(n.at, loop2)).map(n => n.id);
  await dragLoop(loop2, ['Shift']);
  const added = new Set([...inside, ...inside2]);
  await expect(page.locator('.kn-picked')).toContainText(`${added.size} pages picked.`);
  const loop3 = ring(centre.x, centre.y, 12, 12), gone = placed.filter(n => insidePolygon(n.at, loop3)).map(n => n.id);
  await dragLoop(loop3, ['Alt']);
  const left = [...added].filter(id => !gone.includes(id));
  await expect(page.locator('.kn-picked')).toContainText(`${left.length} pages picked.`);
  await expect(page.getByTestId('slice-count')).toHaveText(String(expectedIds({ folders: [], types: [], tags: [], hops: 0, seeds: left }).size));
  // Links are a separate choice, and the count follows.
  await page.locator('#kn-way-graph').getByRole('radio', { name: /^1 hop/ }).check();
  await expect(page.getByTestId('slice-count')).toHaveText(String(expectedIds({ folders: [], types: [], tags: [], hops: 1, seeds: left }).size));
  await expect(page.locator('#kn-way-graph .kn-rule')).toContainText('the pages that your picked pages have links to');
  await page.locator('#kn-way-graph').getByRole('radio', { name: 'No links' }).check();
  // Escape ends a loop that is under way, and the lasso turns off.
  await lasso.click();
  await expect(lasso).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.kn-overlay')).not.toHaveClass(/kn-lasso-on/);

  // 4. The keyboard path: no pointer, only the list and its buttons.
  await page.getByRole('button', { name: 'Clear picks' }).click();
  await expect(page.getByTestId('slice-count')).toHaveText('0');
  await page.getByRole('radio', { name: /^All \d+ pages$/ }).check();
  await page.getByLabel('Search the list').fill('');
  const target = pages.find(p => p.tags.length > 0)!;
  await page.getByRole('checkbox', { name: `Pick ${target.title}`, exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('slice-count')).toHaveText('1');
  await page.getByRole('button', { name: /^Select the pages in this folder \(/ }).click();
  const inFolder = pages.filter(p => p.folder === target.folder || p.folder.startsWith(`${target.folder}/`)).length;
  await expect(page.locator('.kn-picked')).toContainText(`${inFolder} pages picked.`);
  await expect(page.getByTestId('slice-count')).toHaveText(String(expectedIds({ folders: [target.folder], types: [], tags: [], hops: 0, seeds: [] }).size));
  await page.getByRole('button', { name: 'Clear picks' }).click();
  const tg = target.tags[0]!, withTag = pages.filter(p => p.tags.includes(tg)).length;
  await page.getByRole('checkbox', { name: `Pick ${target.title}`, exact: true }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: new RegExp(`^Select pages with the tag ${tg} \\(`) }).click();
  await expect(page.locator('.kn-picked')).toContainText(`${withTag} pages picked.`);
  await expect(page.getByTestId('slice-count')).toHaveText(String(expectedIds({ folders: [], types: [], tags: [tg], hops: 0, seeds: [] }).size));
  await expect(page.locator('#kn-way-graph .kn-rule')).toContainText(`pages with the tag ${tg}`);

  // 5. Save as a new slice, freeze it, give it to an agent.
  await page.getByLabel('Name of the new slice').fill('Reading pile');
  await page.getByRole('button', { name: 'Save as a new slice' }).click();
  await expect(page.getByLabel('Choose a slice')).toHaveValue(/slice-\d+/);
  await expect(page.getByLabel('Choose a slice').locator('option:checked')).toHaveText('Reading pile');
  await expect(page.getByText('Everything is saved to the draft.')).toBeVisible();
  const saved = withTag;
  await expect(page.getByTestId('slice-count')).toHaveText(String(expectedIds({ folders: [], types: [], tags: [tg], hops: 0, seeds: [] }).size));
  await expect(page.getByText('Changes you save here wait in the draft. Apply them on the Harness screen.')).toBeVisible();
  await page.getByRole('button', { name: /^Freeze at \d+ pages$/ }).click();
  await expect(page.locator('.kn-actions .kn-frozen')).toContainText(`Frozen at ${expectedIds({ folders: [], types: [], tags: [tg], hops: 0, seeds: [] }).size} pages.`);
  await expect(page.getByLabel('Choose a slice').locator('option:checked')).toHaveText('Reading pile (frozen)');
  await expect(page.getByRole('button', { name: /^Lasso: / })).toBeDisabled();
  await expect(page.getByText('This slice is frozen, so its rule cannot change.')).toBeVisible();
  await page.locator('.kn-actions select').selectOption({ index: 1 });
  const agentName = await page.locator('.kn-actions select').locator('option:checked').innerText();
  await page.getByRole('button', { name: 'Give this slice to the agent' }).click();
  await expect(page.getByTestId('holders')).toContainText(`Agents that have this slice: ${agentName.replace(/ \(has .*\)$/, '')}.`);
  await shoot('06-saved-frozen-given', scrollTo(page.locator('.kn-actions')));
  await page.getByRole('button', { name: /^Unfreeze/ }).click();
  await expect(page.getByLabel('Choose a slice').locator('option:checked')).toHaveText('Reading pile');
  expect(saved).toBeGreaterThan(0);
});

test('a frozen slice shows its frozen count and how the live rule differs', async () => {
  test.setTimeout(90_000);
  await launch();
  await openKnowledge();
  const slice = world.slices[2]!;
  await chooseSlice(slice.name);
  const n = expectedIds({ folders: [...slice.rule.folders], types: [], tags: [], hops: slice.rule.linksFromSeeds?.hops ?? 0, seeds: [...slice.seeds] }).size;
  await expect(page.getByTestId('slice-count')).toHaveText(String(n));
  await page.getByRole('button', { name: `Freeze at ${n} pages` }).click();
  await expect(page.locator('.kn-preview .kn-frozen')).toHaveText(`Frozen at ${n} pages. The rule picks the same pages today.`);
  await expect(page.getByTestId('slice-count')).toHaveText(String(n));
  await page.getByRole('button', { name: /^Unfreeze/ }).click();
  await expect(page.locator('.kn-preview .kn-frozen')).toHaveCount(0);
});

test('the graph settles and then stops, and with reduce motion it is already settled', async () => {
  test.setTimeout(90_000);
  await launch();
  await openKnowledge();
  await page.waitForTimeout(1200);
  const a = await page.locator('.kn-canvas').screenshot({ scale: 'css' });
  await page.waitForTimeout(1500);
  const b = await page.locator('.kn-canvas').screenshot({ scale: 'css' });
  expect(a.equals(b), 'the picture does not change after it settles').toBe(true);
  await page.locator('nav.nav').getByRole('button', { name: 'Versions' }).click();
  const again = Date.now();
  await page.locator('nav.nav').getByRole('button', { name: 'Knowledge' }).click();
  await expect(page.locator('.kn-canvas')).toHaveAttribute('data-settled', '1', { timeout: 10_000 });
  console.log(`second visit: settled ${Date.now() - again} ms after the click`);
  await app.close();
  await launch(true);
  const calm = Date.now();
  await page.locator('nav.nav').getByRole('button', { name: 'Knowledge' }).click();
  await expect(page.locator('.kn-canvas')).toHaveAttribute('data-settled', '1', { timeout: 10_000 });
  console.log(`reduce motion: settled ${Date.now() - calm} ms after the click`);
  await expect(page.getByTestId('graph-status')).toHaveText('The graph has settled.');
});

test('speed: a rule change repaints at once, and a lasso drag keeps a steady frame time', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  await page.getByRole('button', { name: 'Make a new slice' }).click();
  await page.getByRole('radio', { name: 'Build a rule' }).check();
  const folders = [...new Set(pages.map(p => p.folder.split('/')[0]!))].sort();
  // Time from the click to the next painted frame, for ten rule changes.
  const times: number[] = [];
  for (const f of folders.slice(0, 8)) {
    const ms = await folderBox(f).evaluate(async el => {
      const start = performance.now();
      (el as HTMLInputElement).click();
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      return performance.now() - start;
    });
    times.push(ms);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`rule change to second frame (ms): ${times.map(t => t.toFixed(1)).join(', ')}; median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)}`);
  expect(sorted[sorted.length - 1]!).toBeLessThan(250);
  await page.getByRole('radio', { name: 'Pick on the graph' }).check();
  await page.getByRole('button', { name: /^Lasso: / }).click();
  const box = await canvasBox();
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = []; w.__stop = false;
    let last = performance.now();
    const tick = (t: number): void => { w.__frames.push(t - last); last = t; if (!w.__stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(c.x + 140, c.y); await page.mouse.down();
  for (let i = 1; i <= 240; i += 1) { const a = (2 * Math.PI * i) / 240; await page.mouse.move(c.x + 140 * Math.cos(a), c.y + 100 * Math.sin(a)); }
  await page.mouse.up();
  const frames = await page.evaluate(() => { const w = window as unknown as { __frames: number[]; __stop: boolean }; w.__stop = true; return w.__frames.slice(2); });
  const fs = [...frames].sort((a, b) => a - b);
  console.log(`lasso drag, 240 moves over 700 pages: ${fs.length} frames, median ${fs[Math.floor(fs.length / 2)]!.toFixed(1)} ms, p95 ${fs[Math.floor(fs.length * 0.95)]!.toFixed(1)} ms, worst ${fs[fs.length - 1]!.toFixed(1)} ms`);
  expect(fs[Math.floor(fs.length * 0.95)]!).toBeLessThan(50);
});
