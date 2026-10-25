/**
 * The design and motion fixes of the 0.8 home app, measured in the real window (Electron started with --prototype-v2): the window size, the drawer and the page
 * moving together, the note after an add, one help button, the honest Save bar, a readable disabled button, the new look of a note card, the starter agents,
 * the first agent picked, the arrival of a new card, the enter and exit of the layers, and the press feedback. Frames are sampled with requestAnimationFrame, never
 * with a fixed wait. Set HOME_FIX_SHOTS to a folder to also save screenshots at 1280 by 800 and 900 by 600, light and dark.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { removeTempDirs } from './proto-temp.js';
import { animationsDone, framesPainted } from './proto-wait.js';
import { ensurePicked, fresh, launchHome, resize, skipTour } from './home-page.js';
import type { Home } from './home-page.js';

let home: Home;
let launched: { content: number[]; title: string; innerWidth: number; innerHeight: number };
const page = (): Page => home.page;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  home = await launchHome();
  // Read before any test resizes the page: this is the window as it opens.
  const content = await home.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize());
  const title = await home.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
  launched = { content, title, innerWidth: await home.page.evaluate(() => window.innerWidth), innerHeight: await home.page.evaluate(() => window.innerHeight) };
});
test.afterAll(async () => { try { await home.app.close(); } finally { removeTempDirs(); } });
test.beforeEach(async () => {
  await page().emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await fresh(page());
  await skipTour(page());
});

// ---- Helpers.
const bar = (): Locator => page().locator('header.hm-bar');
const addButton = (): Locator => bar().getByRole('button', { name: 'Add', exact: true });
const drawer = (): Locator => page().locator('[data-slot="add"]');
const panel = (): Locator => page().locator('aside.hm-panel');
const row = (id: string): Locator => drawer().locator(`.add-row[data-add-id="${id}"]`);
const agentCard = (name: string): Locator => page().locator('.kit-card[data-kind="agent"]').filter({ hasText: name });

/** Samples `read` in the page on every animation frame for `ms`. The promise starts now; await it after the action under test. */
function sampling<T>(ms: number, read: () => T): Promise<{ t: number; v: T }[]> {
  return page().evaluate(({ ms: span, src }) => new Promise<{ t: number; v: unknown }[]>(resolve => {
    const f = new Function(`return (${src})()`) as () => unknown, rows: { t: number; v: unknown }[] = [], t0 = performance.now();
    const tick = (): void => { const t = performance.now() - t0; rows.push({ t: Math.round(t), v: f() }); if (t < span) requestAnimationFrame(tick); else resolve(rows); };
    requestAnimationFrame(tick);
  }), { ms, src: read.toString() }) as Promise<{ t: number; v: T }[]>;
}

/**
 * Adds the first skill of the Add drawer to the first agent in its picker that does not have it, and returns once the note shows. Gives the name of the skill and
 * of the agent, as a person reads them.
 */
async function addFirstSkill(): Promise<{ skill: string; agent: string }> {
  await addButton().click();
  await expect(drawer()).toBeVisible();
  await animationsDone(page());
  const first = drawer().locator('.add-row').first();
  const skill = (await first.locator('.kit-card-main').textContent())!.trim();
  await first.getByRole('button', { name: /^Add to / }).click();
  const choices = page().getByRole('group', { name: 'Add to which agent?' }).locator('button:not([aria-disabled="true"])');
  const agent = (await choices.first().textContent())!.trim();
  await choices.first().click();
  await expect(drawer().locator('.add-note')).toHaveText(`Added to ${agent}.`);
  return { skill, agent };
}

// ---- 1. The window, and the note after an add.
test('the window opens at 1280 by 800 and is called Bowerloom from the first moment', () => {
  expect(launched.content).toEqual([1280, 800]);
  expect([launched.innerWidth, launched.innerHeight]).toEqual([1280, 800]);
  expect(launched.title).toBe('Bowerloom');
});

test('at the size it opens at, the shelves stay beside the open Add drawer, and the new card is in view', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await addFirstSkill();
  await expect(panel()).toBeVisible();
  const box = (await panel().boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  await expect(panel().locator('.kit-card[data-fresh]')).toHaveCount(1);
  await expect(panel().locator('.kit-card[data-fresh]')).toBeInViewport();
});

test('the note has a Show button that closes the drawer and brings the new card into view, even where the drawer hides the shelves', async () => {
  const p = page();
  await resize(p, 900, 600);
  const { skill } = await addFirstSkill();
  await expect(panel()).toBeHidden();
  const show = drawer().getByRole('button', { name: 'Show what was added' });
  await expect(show).toHaveText('Show');
  await show.click();
  await expect(drawer()).toHaveCount(0);
  await expect(panel()).toBeVisible();
  const card = panel().locator('.kit-card[data-fresh]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(skill);
  await expect(card).toBeInViewport();
});

test('the note lies under the list, never over a row, and it fades out after about six seconds', async () => {
  const p = page();
  await resize(p, 1280, 800);
  // A watcher in the page writes down when the note opens, when it starts to fade and when it is gone, so no poll can miss the short fade.
  await p.evaluate(() => {
    const times: Record<string, number> = {};
    (window as unknown as { __note: Record<string, number> }).__note = times;
    new MutationObserver(() => {
      const foot = document.querySelector('.add-foot');
      if (foot === null) return;
      const now = performance.now();
      if (foot.hasAttribute('data-open') && times.open === undefined) times.open = now;
      if (foot.hasAttribute('data-leaving') && times.leaving === undefined) times.leaving = now;
      if (!foot.hasAttribute('data-open') && times.open !== undefined && times.gone === undefined) times.gone = now;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  await addFirstSkill();
  const geometry = await p.evaluate(() => {
    const scroll = document.querySelector('.add-scroll')!.getBoundingClientRect(), foot = document.querySelector('.add-foot')!.getBoundingClientRect();
    // What is drawn at the middle of the note is the note itself, never a row of the list under it.
    const under = document.elementFromPoint(foot.left + foot.width / 2, foot.top + foot.height / 2);
    return { scrollBottom: scroll.bottom, footTop: foot.top, footHeight: foot.height, noteOnTop: under !== null && under.closest('.add-foot') !== null };
  });
  expect(geometry.footHeight).toBeGreaterThan(30);
  expect(geometry.footTop).toBeGreaterThanOrEqual(geometry.scrollBottom - 0.5);
  expect(geometry.noteOnTop).toBe(true);
  // The pointer rests on the note after the click, which holds it; moving away lets it go.
  await p.mouse.move(2, 450);
  await p.waitForFunction(() => (window as unknown as { __note: Record<string, number> }).__note.gone !== undefined, null, { timeout: 12000 });
  const t = await p.evaluate(() => (window as unknown as { __note: Record<string, number> }).__note);
  console.log('MEASURED note: open at', Math.round(t.open!), 'fade starts after', Math.round(t.leaving! - t.open!), 'ms, gone after', Math.round(t.gone! - t.open!), 'ms');
  expect(t.leaving! - t.open!).toBeGreaterThan(5500); expect(t.leaving! - t.open!).toBeLessThan(7500);
  expect(t.gone! - t.leaving!).toBeGreaterThan(80); expect(t.gone! - t.leaving!).toBeLessThan(250);
  await expect(drawer().locator('.add-note')).toHaveText('');
});

// ---- 2. The page and the drawer move together.
test('opening the drawer at 1440 moves the map on the drawer\'s clock: it narrows over about 220 ms, never in one frame', async () => {
  const p = page();
  await resize(p, 1440, 900);
  const frames = sampling(500, () => document.querySelector('main.hm-stage')!.getBoundingClientRect().width);
  await addButton().click();
  const rows = await frames;
  const widths = rows.map(r => r.v);
  expect(widths[0]).toBeGreaterThan(1000);
  expect(widths[widths.length - 1]!).toBeLessThan(612);
  const start = rows.findIndex(r => r.v < widths[0]! - 0.5), end = rows.findIndex(r => r.v <= widths[widths.length - 1]! + 0.5);
  const span = rows[end]!.t - rows[start]!.t;
  console.log('MEASURED stage width at 1440 as the drawer opens:', JSON.stringify(rows.slice(Math.max(0, start - 1), end + 2).map(r => [r.t, Math.round(r.v)])), 'span ms', span);
  expect(span).toBeGreaterThan(120); expect(span).toBeLessThan(330);
  const steps = widths.slice(1).map((w, i) => widths[i]! - w);
  expect(Math.max(...steps)).toBeLessThan(330);
  expect(new Set(widths.filter(w => w < 1000 && w > 620).map(Math.round)).size).toBeGreaterThanOrEqual(4);
});

test('closing the drawer gives the room back on the close clock, and with reduce motion the map is final at once', async () => {
  const p = page();
  await resize(p, 1440, 900);
  await addButton().click();
  await animationsDone(p);
  const frames = sampling(400, () => document.querySelector('main.hm-stage')!.getBoundingClientRect().width);
  await p.keyboard.press('Escape');
  const rows = await frames;
  const widths = rows.map(r => r.v);
  expect(widths[widths.length - 1]!).toBeGreaterThan(1000);
  expect(new Set(widths.filter(w => w > 620 && w < 1000).map(Math.round)).size).toBeGreaterThanOrEqual(2);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  await resize(p, 1440, 900);
  const still = sampling(300, () => document.querySelector('main.hm-stage')!.getBoundingClientRect().width);
  await addButton().click();
  const calm = await still;
  const settled = calm.filter(r => r.v < 700);
  expect(settled.length).toBeGreaterThan(0);
  expect(new Set(calm.map(r => Math.round(r.v))).size).toBeLessThanOrEqual(2);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('in a window too narrow for three columns the shelves fade out in about 110 ms instead of vanishing, and come back with the drawer\'s leaving', async () => {
  const p = page();
  await resize(p, 1100, 700);
  await expect(panel()).toBeVisible();
  const frames = sampling(400, () => { const s = getComputedStyle(document.querySelector('aside.hm-panel')!); return { o: Number(s.opacity), v: s.visibility, w: document.querySelector('aside.hm-panel')!.getBoundingClientRect().width }; });
  await addButton().click();
  const rows = await frames;
  console.log('MEASURED shelves at 1100 as the drawer opens (t, opacity, visibility, width):', JSON.stringify(rows.filter(r => r.v.o < 1 || r.v.v !== 'visible').slice(0, 14).map(r => [r.t, Number(r.v.o.toFixed(2)), r.v.v, Math.round(r.v.w)])));
  const middle = rows.filter(r => r.v.o > 0.03 && r.v.o < 0.97);
  expect(middle.length).toBeGreaterThanOrEqual(2);
  const last = rows[rows.length - 1]!.v;
  expect(last.o).toBe(0); expect(last.v).toBe('hidden'); expect(last.w).toBeLessThan(2);
  const fadeStart = rows.find(r => r.v.o < 0.999)!.t, fadeEnd = rows.find(r => r.v.o <= 0.001)!.t;
  expect(fadeEnd - fadeStart).toBeLessThan(200);
  await p.keyboard.press('Escape');
  await expect(drawer()).toHaveCount(0);
  await expect(panel()).toBeVisible();
  await animationsDone(p);
  expect((await panel().boundingBox())!.width).toBeGreaterThan(300);
});

test('the real page stays inside the text budget with the Show button on it', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await addFirstSkill();
  await framesPainted(p);
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
});

// ---- 3. One help button per window.
test('the window has one "?" (Help, at the far right); Preview is a pill that opens its own popover; Tools has a hint line instead of a "?"', async () => {
  const p = page();
  await resize(p, 1280, 800);
  const round = await p.locator('button.kit-button[data-round]').evaluateAll(list => list.map(b => (b.textContent ?? '').trim()));
  expect(round.filter(t => t === '?')).toHaveLength(1);
  const help = bar().getByRole('button', { name: 'Help', exact: true });
  const pill = bar().getByRole('button', { name: 'About this preview' });
  await expect(pill).toHaveText('Preview');
  await expect(p.getByRole('button', { name: 'About tools' })).toHaveCount(0);
  const [pillBox, helpBox] = [(await pill.boundingBox())!, (await help.boundingBox())!];
  expect(helpBox.x).toBeGreaterThan(pillBox.x + pillBox.width);
  expect(helpBox.x + helpBox.width).toBeGreaterThan(1280 - 40);   // the far right of the bar
  await pill.click();
  const pop = p.locator('.kit-popover');
  await expect(pop).toHaveText('This is a preview. Nothing is written to your computer.');
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  await p.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(pill).toBeFocused();
  // The Tools shelf says in one short line what a tool is, right under its heading.
  const tools = panel().getByRole('region', { name: 'Tools' });
  await expect(tools.getByText('Tools let an agent reach outside services.')).toBeVisible();
  const [head, hint] = [(await tools.getByRole('heading', { name: 'Tools' }).boundingBox())!, (await tools.getByText('Tools let an agent reach outside services.').boundingBox())!];
  expect(hint.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
  expect(Math.abs(hint.x - head.x)).toBeLessThan(2);
});

// ---- 4. The Save bar does not claim that a file changed.
test('after Save the bar says it was saved in the preview, and lists the programs that would be updated, with no tick', async () => {
  const p = page();
  await resize(p, 1280, 800);
  // The first agent is already picked when the map opens.
  await expect(panel().locator('.kit-card .kit-remove').first()).toBeVisible();
  await panel().locator('.kit-card .kit-remove').first().click();
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  const saveBar = p.getByRole('region', { name: 'Save bar' });
  await expect(saveBar.getByText('Saved in this preview. Your files are untouched.', { exact: true })).toBeVisible();
  await expect(saveBar.getByText('Would update:')).toBeVisible();
  await expect(saveBar.getByRole('list', { name: 'Would update' }).getByRole('listitem')).toHaveText(['Claude Code', 'Codex', 'OpenCode']);
  expect(await saveBar.locator('.hm-tick svg').count()).toBe(0);
  await expect(saveBar.getByRole('button', { name: 'Go back' })).toBeFocused();
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
});

// ---- 5. A disabled button is readable while the pointer rests on it.
for (const look of ['light', 'dark'] as const) {
  test(`${look} look: the disabled Save button keeps its muted text on its own fill while the pointer rests on it (3 to 1 at least)`, async () => {
    const p = page();
    await resize(p, 1280, 800);
    await p.emulateMedia({ colorScheme: look, reducedMotion: 'no-preference' });
    await p.waitForFunction(l => document.documentElement.getAttribute('data-theme') === l, look);
    const save = p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    await save.hover({ force: true });
    await animationsDone(p);
    const read = async (): Promise<{ text: string; fill: string; ratio: number }> => save.evaluate(el => {
      const channels = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]: number[]): number => { const f = [r!, g!, b!].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!; };
      // The fill the text really sits on: the button's own, else the first ancestor that paints one.
      let node: Element | null = el, fill = [0, 0, 0, 0];
      for (; node !== null; node = node.parentElement) { const c = channels(getComputedStyle(node).backgroundColor); if ((c[3] ?? 1) > 0.99 || (c.length === 3)) { fill = [...c, 1].slice(0, 4); break; } }
      const text = channels(getComputedStyle(el).color), a = lum(text), b = lum(fill);
      return { text: getComputedStyle(el).color, fill: `rgb(${fill.slice(0, 3).join(', ')})`, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    const hovered = await read();
    console.log(`MEASURED ${look}: disabled Save under the pointer, text ${hovered.text} on ${hovered.fill} = ${hovered.ratio.toFixed(2)} to 1`);
    expect(await save.evaluate(el => el.matches(':hover'))).toBe(true);
    expect(hovered.ratio).toBeGreaterThanOrEqual(3);
    // The fill is the page's, not the dark green of a pressable primary button.
    expect(await save.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  });
}

// ---- 8. The first agent is picked, so the panel is never empty on the first view; the tour's click step is still a real click.
const heading = (): Locator => panel().getByRole('heading', { level: 2 });
const agentButtons = (): Locator => page().locator('.hm-grid .kit-card[data-kind="agent"] .kit-card-main');

test('the map opens with the first agent in the current order picked, and its shelves show what it has', async () => {
  const p = page();
  await resize(p, 1280, 800);
  const first = (await agentButtons().first().textContent())!.trim();
  await expect(agentButtons().first()).toHaveAttribute('aria-pressed', 'true');
  await expect(heading()).toHaveText(first);
  await expect(panel().locator('.kit-card[data-kind="skill"]').first()).toBeVisible();
  await expect(panel().getByText('Nothing here yet.')).not.toHaveCount(3);
  await expect(heading()).not.toHaveText('Pick an agent');
});

test('the person can still put the pick down, and it stays down', async () => {
  const p = page();
  await agentButtons().first().click();
  await expect(heading()).toHaveText('Pick an agent');
  await expect(agentButtons().first()).toHaveAttribute('aria-pressed', 'false');
  await framesPainted(p); await framesPainted(p);
  await expect(heading()).toHaveText('Pick an agent');
  // Picking another agent works as before.
  await agentButtons().nth(1).click();
  await expect(heading()).toHaveText((await agentButtons().nth(1).textContent())!.trim());
});

test('during the tour\'s click step nothing is picked, so the click means something; skipping the tour then picks the first agent', async () => {
  const p = page();
  await fresh(p, undefined, { tour: true });
  const tour = p.getByRole('dialog', { name: 'Tour' });
  await expect(tour).toBeVisible();
  // Step one, and step two (the click step): the panel is empty and no agent is pressed.
  await expect(heading()).toHaveText('Pick an agent');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('Click an agent to see what it can do.')).toBeVisible();
  await expect(heading()).toHaveText('Pick an agent');
  expect(await agentButtons().evaluateAll(list => list.filter(b => b.getAttribute('aria-pressed') === 'true').length)).toBe(0);
  await p.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(agentButtons().first()).toHaveAttribute('aria-pressed', 'true');
  await expect(heading()).toHaveText((await agentButtons().first().textContent())!.trim());
});

test('the click step is a real click: clicking an agent picks that agent and the tour goes on; after the tour the pick stays', async () => {
  const p = page();
  await fresh(p, undefined, { tour: true });
  const tour = p.getByRole('dialog', { name: 'Tour' });
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByRole('button', { name: 'Next' })).toHaveCount(0);
  const second = agentButtons().nth(1);
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(tour.getByText('Skills are what it knows how to do.')).toBeVisible();
  for (let i = 0; i < 3; i += 1) await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('button', { name: 'Done' }).click();
  await expect(tour).toHaveCount(0);
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(await agentButtons().evaluateAll(list => list.filter(b => b.getAttribute('aria-pressed') === 'true').length)).toBe(1);
});

test('replaying the tour from Help puts the pick down first, so the click step has something to do', async () => {
  const p = page();
  await expect(agentButtons().first()).toHaveAttribute('aria-pressed', 'true');
  await p.getByRole('button', { name: 'Help', exact: true }).click();
  await p.getByRole('button', { name: 'Show me around' }).click();
  const tour = p.getByRole('dialog', { name: 'Tour' });
  await expect(tour).toBeVisible();
  await expect(heading()).toHaveText('Pick an agent');
  await tour.getByRole('button', { name: 'Next' }).click();
  await agentButtons().first().click();
  await expect(agentButtons().first()).toHaveAttribute('aria-pressed', 'true');
  await expect(tour.getByText('Skills are what it knows how to do.')).toBeVisible();
});

// ---- 6. A set of notes is named by what it holds.
test('after Choose notes the Notes card and the Save bar name the topics and count the notes', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Report builder', exact: true }));
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  const layer = p.locator('[data-slot="notes"]');
  await expect(layer).toBeVisible();
  await layer.getByRole('button', { name: 'Travel', exact: true }).click();
  await layer.getByRole('button', { name: 'Meetings', exact: true }).click();
  const total = await layer.locator('.nt-big').getAttribute('data-count');
  await layer.getByRole('button', { name: 'Use these notes', exact: true }).click();
  await expect(layer).toHaveCount(0);
  const card = panel().locator('[data-notes-shelf] .kit-card');
  await expect(card.locator('.kit-card-main')).toHaveText('Meetings and Travel notes');
  await expect(card.locator('.kit-card-hint')).toHaveText(`${total} notes it can read.`);
  await expect(p.getByRole('region', { name: 'Save bar' }).locator('.hm-savebar-state p')).toHaveText('Added Meetings and Travel notes to Report builder');
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
  // Three topics: the first and a count, never more than five words.
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await layer.getByRole('button', { name: 'Money', exact: true }).click();
  await layer.getByRole('button', { name: 'Use these notes', exact: true }).click();
  await expect(card.locator('.kit-card-main')).toHaveText('Meetings and 2 more notes');
});

// ---- 7. The Agents tab offers six starters that are not empty.
test('the Agents tab lists six hand-written starters with their jobs; adding one makes an agent that has its skills', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await addButton().click();
  await expect(drawer()).toBeVisible();
  await animationsDone(p);
  await drawer().getByRole('tab', { name: 'Agents', exact: true }).click();
  const rows = drawer().locator('.add-row');
  await expect(rows.locator('.kit-card-main')).toHaveText(['Budget checker', 'Email drafter', 'Note taker', 'Reading coach', 'Research reader', 'Trip planner']);
  await expect(rows.locator('.kit-card-hint')).toHaveText([
    'Checks your spending and flags what looks odd.', 'Drafts replies in your voice for you to check.', 'Writes up your meetings and lists who does what.',
    'Explains hard words and sums up what you read.', 'Reads articles and tells you what matters.', 'Lays out a trip day by day and hunts for prices.',
  ]);
  expect((await drawer().innerText())).not.toMatch(/Cartographer|nothing added yet|Meeting helper/i);
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
  await rows.filter({ hasText: 'Note taker' }).getByRole('button', { name: /Add agent/ }).click();
  await expect(drawer().locator('.add-note')).toHaveText('Added Note taker to your agents.');
  await expect(p.locator('.hm-grid .kit-card[data-kind="agent"]')).toHaveCount(11);
  const mine = p.locator('.hm-grid .kit-card[data-kind="agent"]').filter({ hasText: 'Note taker' });
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.kit-card-hint')).toHaveText('Summarizes meetings and lists action items.');
  // The new agent is picked, wears the mark, and holds three real skills.
  await expect(panel().getByRole('heading', { level: 2, name: 'Note taker' })).toBeVisible();
  await expect(panel().getByRole('region', { name: 'Skills' }).locator('.kit-card-main')).toHaveText(['Summarize a meeting', 'List action items', 'Make a to-do list']);
  await expect(mine).toHaveAttribute('data-fresh', '');
  await expect(p.getByRole('region', { name: 'Save bar' }).locator('.hm-savebar-state p')).toHaveText('Added Note taker');
  await drawer().getByRole('button', { name: 'Show what was added' }).click();
  await expect(drawer()).toHaveCount(0);
  await expect(mine).toBeInViewport();
});
