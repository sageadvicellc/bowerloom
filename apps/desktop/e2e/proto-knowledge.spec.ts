/**
 * Journey 5 in the real prototype window (launched with --prototype and a temporary data folder): open Knowledge, pick a slice, read its
 * page count, build rules, pick on the graph with a real pointer drag, and compare every page count on screen with a count made here, straight
 * from the generated page list. The count made here does NOT call matchPages: the folder, type, tag and link rules are written again below.
 * Set PROTO_KNOWLEDGE_SHOTS to a folder to also save screenshots at 1440 by 900 and 900 by 600. Run `npm run bundle` first, so dist matches the source.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import electronPath from 'electron';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from '../shared/proto/sample.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

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
  const userData = tempDir('bowerloom-prototype-e2e-');
  app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await resize(1440, 900);
}
test.afterEach(async () => { try { await app.close(); } finally { removeTempDirs(); } });

async function resize(w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0]!.setContentSize(size.w, size.h); }, { w, h });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(w);
  await framesPainted(page); // the resized page has been laid out and drawn once
}
async function shoot(name: string, prepare?: () => Promise<void>, after?: () => Promise<void>): Promise<void> {
  if (shotsDir === null) return;
  for (const [w, h] of [...SIZES].reverse()) {
    await resize(w, h);
    if (prepare !== undefined) await prepare();
    await animationsDone(page);
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
    await expect(page.locator('.kn-count')).toHaveText(`${want.size} ${want.size === 1 ? 'page is' : 'pages are'} in this slice`);
  }
  await chooseSlice(world.slices[0]!.name);
  const first = world.slices[0]!;
  const lit = expectedIds({ folders: [...first.rule.folders], types: [], tags: [], hops: 0, seeds: [...first.seeds] });
  await expect(page.getByTestId('slice-count')).toHaveText(String(lit.size));
  await expect(page.getByText(/^The pages add up to about [\d,]+ tokens, a rough measure of size\.$/)).toBeVisible();
  await expect(page.getByText(/^\d+ pages joined since your last visit\.$/)).toHaveText('3 pages joined since your last visit.');
  await expect(page.getByText(/links? leaves? this slice\. They are drawn as dashed lines on the graph\./)).toBeVisible();
  await expect(page.getByText(/^The agent gets a map of \d+ pages: a title and one line for each\./)).toBeVisible();
  for (const i of world.interfaces) {
    const label = `${{ 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', hermes: 'Hermes', bowerloom: 'Bowerloom' }[i.id]}: ${i.enforcement}`;
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

test('removing a picked page and picking it again leaves nothing to save', async () => {
  test.setTimeout(90_000);
  await launch();
  await openKnowledge();
  const slice = world.slices.find(s => s.seeds.length >= 2)!;
  await chooseSlice(slice.name);
  await page.getByRole('radio', { name: 'Build a rule' }).check();
  const seed = pages.find(p => p.id === slice.seeds[0])!;
  const save = page.getByRole('button', { name: 'Save changes' }), status = page.locator('.kn-actions p[role="status"][aria-live="polite"]');
  await expect(save).toBeDisabled();
  await expect(status).toHaveText('Everything is saved to the draft.');
  await page.getByRole('button', { name: `Remove ${seed.title} from the picked pages` }).click();
  await expect(status).toHaveText('There are changes to save.');
  await expect(page.getByRole('button', { name: 'Undo my changes' })).toBeVisible();
  // Pick it again from the list: it comes back last, so the order is not the saved one, but the pages are.
  await page.getByRole('radio', { name: /^All \d+ pages$/ }).check();
  await page.getByLabel('Search the list').fill(seed.title);
  await page.getByRole('checkbox', { name: `Pick ${seed.title}`, exact: true }).check();
  await expect(status).toHaveText('Everything is saved to the draft.');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Undo my changes' })).toHaveCount(0);
  await expect(page.getByText('The picked pages of a saved slice cannot change in place.')).toHaveCount(0);
});

test('the graph settles and then stops, and with reduce motion it is already settled', async () => {
  test.setTimeout(90_000);
  await launch();
  await openKnowledge();
  // The camera has come to rest, and then the picture stays the same for another 120 painted frames (about two seconds).
  await viewIsStill(pages[0]!.id, 30);
  const a = await page.locator('.kn-canvas').screenshot({ scale: 'css' });
  await viewIsStill(pages[0]!.id, 120);
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

/** In the page: waits until the picture (the camera and the place of every page) stays the same for `frames` frames in a row. A real wait on the picture, not on a clock. */
async function viewIsStill(id: string, frames = 20): Promise<void> {
  await page.evaluate(([pageId, need]) => new Promise<void>((resolve, reject) => {
    type View = { screenOf(id: string): { x: number; y: number } | null; placed(): readonly { x?: number; y?: number }[] };
    const host = document.querySelector('.kn-canvas') as (HTMLElement & { graphView?: View }) | null;
    let last = '', same = 0, tries = 0;
    const tick = (): void => {
      const view = host?.graphView, p = view?.screenOf(pageId as string) ?? null;
      const spread = (view?.placed() ?? []).reduce((sum, n, i) => sum + ((n.x ?? 0) * 1.01 + (n.y ?? 0)) * ((i % 7) + 1), 0);
      const now = p === null ? 'none' : `${p.x.toFixed(2)},${p.y.toFixed(2)},${spread.toFixed(2)}`;
      same = now === last ? same + 1 : 0; last = now; tries += 1;
      if (same >= (need as number)) resolve(); else if (tries > 2400) reject(new Error('The picture never stood still.')); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [id, frames] as const);
}
const restsOf = (): Promise<number> => page.locator('.kn-canvas').getAttribute('data-rests').then(v => Number(v ?? '0'));

test('dragging a page lets the graph settle again and does not send the view back to fit-all pages', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  const box = await canvasBox(), middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Zoom in on the middle, so the view is not the fit-all view.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -700);
  const ids = pages.map(p => p.id);
  const onScreen = async (): Promise<{ id: string; x: number; y: number }[]> => (await Promise.all(ids.map(async id => ({ id, at: await screenOfPage(id) }))))
    .filter((n): n is { id: string; at: { x: number; y: number } } => n.at !== null && n.at.x > box.x + 60 && n.at.x < box.x + box.width - 60 && n.at.y > box.y + 60 && n.at.y < box.y + box.height - 60)
    .map(n => ({ id: n.id, ...n.at }));
  let shown = await onScreen();
  expect(shown.length, 'some pages are in view after the zoom').toBeGreaterThan(10);
  const dragged = shown.reduce((best, n) => (Math.hypot(n.x - middle.x, n.y - middle.y) < Math.hypot(best.x - middle.x, best.y - middle.y) ? n : best));
  const ref = shown.filter(n => n.id !== dragged.id && Math.hypot(n.x - dragged.x, n.y - dragged.y) > 80)[0]!;
  await viewIsStill(ref.id);
  const readView = (): Promise<{ k: number; x: number; y: number }> => page.evaluate(() => (document.querySelector('.kn-canvas') as HTMLElement & { graphView: { viewport(): { k: number; x: number; y: number } } }).graphView.viewport());
  const zoomed = await readView();
  expect(zoomed.k, 'the view is zoomed in').toBeGreaterThan(1.2);
  const restsBefore = await restsOf();

  // Drag the page next to the middle by hand.
  const from = (await screenOfPage(dragged.id))!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 8 });
  await page.mouse.up();
  // The drag wakes the layout, and it rests again: the graph says so each time it comes to rest.
  await expect.poll(restsOf, { timeout: 20_000 }).toBeGreaterThan(restsBefore);
  await viewIsStill(ref.id);
  const after = await readView();
  expect(after.k, 'the zoom stayed').toBeCloseTo(zoomed.k, 2);
  expect(Math.abs(after.x - zoomed.x) + Math.abs(after.y - zoomed.y), 'the centre stayed where the person left it').toBeLessThan(1);

  // The Fit all pages button still does fit every page.
  await page.getByRole('button', { name: 'Fit all pages' }).click();
  await expect.poll(async () => (await readView()).k, { timeout: 5_000 }).toBeLessThan(zoomed.k * 0.8);
  await viewIsStill(ref.id);
  shown = await onScreen();
  expect(shown.length, 'every page is in view after Fit all pages').toBeGreaterThan(600);
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

// ------------------------------------------------------------------------------------------------------- words on the picture

interface Label { kind: 'hub' | 'page'; text: string; x0: number; y0: number; x1: number; y1: number; fontPx: number }
const labelsOf = (): Promise<Label[]> => page.evaluate(() => [...((document.querySelector('.kn-canvas') as HTMLElement & { graphView: { labels(): Label[] } }).graphView.labels())]);
const overlapping = (a: Label, b: Label): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

test('the graph names its eight domain folders and its busiest pages, never covers one label with another, and keeps every word at 12 pixels or more', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  const domains = [...new Set(pages.map(p => p.folder.split('/')[0]!))].sort();
  const sizes: string[] = [];
  for (const [w, h] of [[1440, 900], [900, 600]] as const) {
    await resize(w, h);
    await expect.poll(async () => (await labelsOf()).filter(l => l.kind === 'hub').length, { timeout: 10_000 }).toBe(8);
    const labels = await labelsOf(), hubs = labels.filter(l => l.kind === 'hub');
    expect(hubs.map(l => l.text).sort(), `${w}x${h}: every domain is named`).toEqual(domains);
    for (const l of labels) { expect(l.fontPx, `${l.text} is at least 12 px`).toBeGreaterThanOrEqual(12); expect(l.y1 - l.y0, `${l.text} is tall enough for its words`).toBeGreaterThanOrEqual(12); }
    for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) expect(overlapping(labels[i]!, labels[j]!), `${labels[i]!.text} and ${labels[j]!.text} do not overlap`).toBe(false);
    // Every label is on the picture.
    const box = await canvasBox();
    for (const l of hubs) { expect(l.x0).toBeGreaterThanOrEqual(-1); expect(l.x1).toBeLessThanOrEqual(box.width + 1); expect(l.y0).toBeGreaterThanOrEqual(-1); expect(l.y1).toBeLessThanOrEqual(box.height + 1); }
    sizes.push(`${w}x${h}: ${labels.length} labels (${hubs.length} domains, ${labels.length - hubs.length} pages), smallest word ${Math.min(...labels.map(l => l.fontPx))} px`);
  }
  console.log(sizes.join('; '));
  // The page labels are the pages with the most links.
  await resize(1440, 900);
  const degree = new Map<string, number>();
  for (const p of pages) for (const to of p.links) if (to !== p.id && pages.some(q => q.id === to)) { degree.set(p.id, (degree.get(p.id) ?? 0) + 1); degree.set(to, (degree.get(to) ?? 0) + 1); }
  const top = [...pages].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, 12).map(p => p.title);
  const named = (await labelsOf()).filter(l => l.kind === 'page').map(l => l.text.replace(/…$/, ''));
  expect(named.length, 'some busy pages are named when there is room').toBeGreaterThan(2);
  for (const t of named) expect(top.some(full => full.startsWith(t)), `${t} is one of the 12 busiest pages`).toBe(true);
});

test('a lit slice names its busiest lit pages, and a page that is not in the slice has a fainter link', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  await resize(1440, 900);
  await chooseSlice(world.slices[0]!.name);
  const litIds = expectedIds({ folders: [...world.slices[0]!.rule.folders], types: [], tags: [], hops: 0, seeds: [...world.slices[0]!.seeds] });
  const litTitles = pages.filter(p => litIds.has(p.id)).map(p => p.title);
  await expect.poll(async () => (await labelsOf()).filter(l => l.kind === 'page').length, { timeout: 10_000 }).toBeGreaterThan(0);
  const named = (await labelsOf()).filter(l => l.kind === 'page').map(l => l.text.replace(/…$/, ''));
  expect(named.some(t => litTitles.some(full => full.startsWith(t))), 'at least one named page is in the slice').toBe(true);
});

test('the pointer over a page names it: its title and its domain folder, in a box next to the pointer', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  await resize(1440, 900);
  // A page with room around it, so the pointer is over that page and no other.
  const target = await page.evaluate(() => {
    const host = document.querySelector('.kn-canvas') as HTMLElement & { graphView: { placed(): { id: string; title: string; folder: string; degree: number }[]; screenOf(id: string): { x: number; y: number } | null } };
    const r = host.getBoundingClientRect(), all = host.graphView.placed().map(n => ({ id: n.id, title: n.title, folder: n.folder, p: host.graphView.screenOf(n.id) })).filter(n => n.p !== null && n.p.x > 60 && n.p.x < r.width - 60 && n.p.y > 60 && n.p.y < r.height - 60);
    const alone = all.find(n => all.every(m => m === n || Math.hypot(m.p!.x - n.p!.x, m.p!.y - n.p!.y) > 16))!;
    return { id: alone.id, title: alone.title, folder: alone.folder, x: alone.p!.x + r.left, y: alone.p!.y + r.top };
  });
  const tip = page.getByTestId('graph-tip');
  await expect(tip).toBeHidden();
  await page.mouse.move(target.x - 80, target.y - 70);
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(target.title);
  await expect(tip).toContainText(`Folder ${target.folder.split('/')[0]}`);
  // Next to the pointer, not far from it.
  const tipBox = (await tip.boundingBox())!;
  expect(Math.abs(tipBox.x - target.x), 'the box is close to the pointer in x').toBeLessThan(260);
  expect(Math.abs(tipBox.y - target.y), 'the box is close to the pointer in y').toBeLessThan(120);
  // The pointer leaves the graph: the box goes.
  const outside = await canvasBox();
  await page.mouse.move(outside.x - 40, outside.y + 40, { steps: 5 });
  await expect(tip).toBeHidden();
  await page.mouse.move(target.x - 80, target.y - 70, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await expect(tip).toBeVisible();
  // The lasso takes the pointer, so the box is not shown while it is on.
  await page.getByRole('button', { name: /^Lasso: / }).click();
  await page.mouse.move(target.x - 3, target.y - 3, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 3 });
  await expect(tip).toBeHidden();
});

test('the graph stops asking for frames when it rests, starts again when the pointer moves over it, and stops again', async () => {
  test.setTimeout(120_000);
  await launch();
  await page.evaluate(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f: FrameRequestCallback): number => { w.__raf += 1; return raf(f); };
  });
  await openKnowledge();
  const calls = (): Promise<number> => page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  // The graph says when its drawing loop has gone to sleep (`looping`), and nothing is animating either.
  const asleep = async (): Promise<void> => {
    await expect.poll(() => page.evaluate(() => (document.querySelector('.kn-canvas') as HTMLElement & { graphView: { looping(): boolean } }).graphView.looping()), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 10_000 }).toBe(0);
  };
  // A window in which to count: the page itself waits this long, and the number of frames asked for in it is read before and after.
  const during = (ms: number): Promise<void> => page.evaluate(t => new Promise<void>(resolve => { setTimeout(resolve, t); }), ms);
  await asleep();
  const idleFrom = await calls();
  await during(3000);
  const idle = (await calls()) - idleFrom;
  console.log(`rAF calls in 3 s idle after settle: ${idle}`);
  expect(idle, 'no drawing loop while nothing changes').toBeLessThanOrEqual(3);
  // Moving the pointer over the graph wakes it.
  const box = await canvasBox(), moveFrom = await calls(), start = Date.now();
  for (let i = 0; Date.now() - start < 3000; i += 1) { await page.mouse.move(box.x + 80 + ((i * 7) % 400), box.y + 80 + ((i * 13) % 300)); await framesPainted(page); }
  const moving = (await calls()) - moveFrom;
  console.log(`rAF calls in 3 s of pointer movement: ${moving}`);
  expect(moving, 'the loop runs while the pointer moves').toBeGreaterThan(60);
  // And it goes back to sleep.
  await asleep();
  const againFrom = await calls();
  await during(3000);
  expect((await calls()) - againFrom, 'asleep again').toBeLessThanOrEqual(3);
  // A new slice still lights up and fades in while the loop was asleep: the picture changes, so a frame was drawn.
  const before = await page.locator('.kn-canvas').screenshot({ scale: 'css' });
  await chooseSlice(world.slices[1]!.name);
  await expect.poll(async () => !(await page.locator('.kn-canvas').screenshot({ scale: 'css' })).equals(before), { timeout: 5_000 }).toBe(true);
  await asleep();
  const slept = await calls();
  await during(2500);
  expect((await calls()) - slept, 'asleep again after the fade').toBeLessThanOrEqual(3);
  // The lasso still picks pages after a sleep.
  await page.getByRole('button', { name: 'Make a new slice' }).click();
  await page.getByRole('button', { name: /^Lasso: / }).click();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragLoop(ring(c.x, c.y, 60), []);
  await expect(page.locator('.kn-picked')).toContainText(/\d+ pages? picked\./);
});

test('the graph starts high on the screen: its top is above y 220 in a tall window, and the whole graph shows in a small one', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  const read = async (): Promise<{ top: number; bottom: number; inner: number; footer: number }> => page.evaluate(() => {
    const c = document.querySelector('.kn-canvas')!.getBoundingClientRect(), f = document.querySelector('footer')!.getBoundingClientRect();
    return { top: c.top, bottom: c.bottom, inner: window.innerHeight, footer: f.top };
  });
  // The real window cannot be taller than this screen, so a tall window is the browser's own size override at 1440 by 900.
  const cdp = await page.context().newCDPSession(page);
  for (const [w, h] of [[1440, 900], [900, 600]] as const) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([w, h]);
    await framesPainted(page);
    const m = await read();
    console.log(`${w}x${h}: the graph starts at y ${m.top.toFixed(0)} and ends at y ${m.bottom.toFixed(0)} (footer at ${m.footer.toFixed(0)})`);
    expect(m.top, `${w}x${h}: the graph starts above y 220`).toBeLessThan(220);
    expect(m.bottom, `${w}x${h}: the whole graph is in the first screenful`).toBeLessThanOrEqual(m.footer);
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});

test('the graph is fitted again when the window changes size, until the person moves the view', async () => {
  test.setTimeout(120_000);
  await launch();
  await openKnowledge();
  const inView = async (): Promise<number> => {
    const box = await canvasBox();
    return (await Promise.all(pages.map(async p => ({ at: await screenOfPage(p.id) })))).filter(n => n.at !== null && n.at.x > box.x && n.at.x < box.x + box.width && n.at.y > box.y && n.at.y < box.y + box.height).length;
  };
  await resize(900, 600);
  await expect.poll(inView, { timeout: 10_000 }).toBeGreaterThan(600);
  await resize(1440, 900);
  await expect.poll(inView, { timeout: 10_000 }).toBeGreaterThan(600);
  const box = await canvasBox(), middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -600);
  await viewIsStill(pages[0]!.id, 30);
  const zoomed = await page.evaluate(() => (document.querySelector('.kn-canvas') as HTMLElement & { graphView: { viewport(): { k: number } } }).graphView.viewport().k);
  await resize(900, 600);
  await viewIsStill(pages[0]!.id, 30);
  const after = await page.evaluate(() => (document.querySelector('.kn-canvas') as HTMLElement & { graphView: { viewport(): { k: number } } }).graphView.viewport().k);
  expect(after, 'a view the person zoomed is left as it is').toBeCloseTo(zoomed, 2);
});
