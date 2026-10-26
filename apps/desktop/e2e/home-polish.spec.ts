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
  // Wave D: the panel is 25 vw (320 px) and the drawer 380 px, so at 1440 the stage ends at 1440 - 320 - 380 = 740 px (it was 612 with a 384 px panel and a 420 px drawer).
  expect(widths[widths.length - 1]!).toBeLessThan(760);
  const start = rows.findIndex(r => r.v < widths[0]! - 0.5), end = rows.findIndex(r => r.v <= widths[widths.length - 1]! + 0.5);
  const span = rows[end]!.t - rows[start]!.t;
  console.log('MEASURED stage width at 1440 as the drawer opens:', JSON.stringify(rows.slice(Math.max(0, start - 1), end + 2).map(r => [r.t, Math.round(r.v)])), 'span ms', span);
  expect(span).toBeGreaterThan(120); expect(span).toBeLessThan(330);
  const steps = widths.slice(1).map((w, i) => widths[i]! - w);
  expect(Math.max(...steps)).toBeLessThan(330);
  expect(new Set(widths.filter(w => w < 1000 && w > 760).map(Math.round)).size).toBeGreaterThanOrEqual(4);
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
  expect(new Set(widths.filter(w => w > 760 && w < 1000).map(Math.round)).size).toBeGreaterThanOrEqual(2);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  await resize(p, 1440, 900);
  const still = sampling(300, () => document.querySelector('main.hm-stage')!.getBoundingClientRect().width);
  await addButton().click();
  const calm = await still;
  const settled = calm.filter(r => r.v < 800);
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
  // Wave D: the panel is 25 vw, at least 288 px, so at 1100 it is 288 px (it was 330 px at 30 vw).
  expect((await panel().boundingBox())!.width).toBeGreaterThan(280);
});

test('the real page stays inside the text budget with the Show button on it', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await addFirstSkill();
  await framesPainted(p);
  expect(assertTextBudget(await p.evaluate(() => document.querySelector('[data-home]')!.outerHTML))).toEqual([]);
});

// ---- 3. One help button per window.
test('the window has no bare "?": Help is a button with its word, at the far right; Preview is plain words with a dot that opens its own popover; Tools has a hint line instead of a "?"', async () => {
  const p = page();
  await resize(p, 1280, 800);
  const round = await p.locator('button.kit-button[data-round]').evaluateAll(list => list.map(b => (b.textContent ?? '').trim()));
  expect(round.filter(t => t === '?'), 'a bare question mark is gone').toHaveLength(0);
  await expect(bar().getByRole('button', { name: 'Help', exact: true })).toHaveText('Help');
  const help = bar().getByRole('button', { name: 'Help', exact: true });
  const pill = bar().getByRole('button', { name: 'About this preview' });
  await expect(pill).toHaveText('Preview');
  await expect(p.getByRole('button', { name: 'About tools' })).toHaveCount(0);
  const [pillBox, helpBox] = [(await pill.boundingBox())!, (await help.boundingBox())!];
  expect(helpBox.x).toBeGreaterThan(pillBox.x + pillBox.width);
  expect(helpBox.x + helpBox.width).toBeGreaterThan(1280 - 40);   // the far right of the bar
  await pill.click();
  const pop = p.locator('.kit-popover');
  await expect(pop.locator('p')).toHaveText('This is a preview. It sends nothing, stores nothing, and writes nothing to your computer.');
  await expect(pop.getByRole('button')).toHaveText(['How it will work']);
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

test('during the tour\'s click step nothing is picked, so the click means something; skipping the tour does not pick an agent in silence', async () => {
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
  // Wave E: a tour that ends picks nothing for a person who picked nothing. The panel waits, and says so.
  expect(await agentButtons().evaluateAll(list => list.filter(b => b.getAttribute('aria-pressed') === 'true').length)).toBe(0);
  await expect(heading()).toHaveText('Pick an agent');
});

test('the click step is a real click: clicking an agent picks that agent and the tour goes on; after the tour the pick stays', async () => {
  const p = page();
  await fresh(p, undefined, { tour: true });
  const tour = p.getByRole('dialog', { name: 'Tour' });
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('2 of 7')).toBeVisible();
  const second = agentButtons().nth(1);
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(tour.getByText('Skills show what the agent you picked can do.')).toBeVisible();
  for (let i = 0; i < 4; i += 1) await tour.getByRole('button', { name: 'Next' }).click();
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
  await expect(tour.getByText('Skills show what the agent you picked can do.')).toBeVisible();
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
  // Three topics are listed, biggest first, in no more than five words.
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  await layer.getByRole('button', { name: 'Money', exact: true }).click();
  await layer.getByRole('button', { name: 'Use these notes', exact: true }).click();
  await expect(card.locator('.kit-card-main')).toHaveText('Meetings, Money and Travel notes');
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

// ---- 9. The arrival of a new card.
type Arrival = { names: { name: string; duration: number; delay: number; easing: string }[]; frames: { t: number; opacity: number; y: number; ring: string }[] };
/** Waits (in the page) for the card that wears the new-card mark and records its animations and, frame by frame, its opacity, rise and ring. */
function watchArrival(ms: number): Promise<Arrival> {
  return page().evaluate(span => new Promise<Arrival>(resolve => {
    const frames: Arrival['frames'] = [];
    let t0 = -1;
    const tick = (): void => {
      const card = document.querySelector('aside.hm-panel .kit-card[data-size="small"][data-fresh]') as HTMLElement | null;
      if (card === null) { requestAnimationFrame(tick); return; }
      if (t0 < 0) t0 = performance.now();
      const s = getComputedStyle(card), m = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
      frames.push({ t: Math.round(performance.now() - t0), opacity: Number(s.opacity), y: Math.round(m.m42 * 100) / 100, ring: s.boxShadow.split(') ')[0]! });
      if (performance.now() - t0 < span) { requestAnimationFrame(tick); return; }
      const names = card.getAnimations().map(a => { const t = a.effect!.getComputedTiming(); return { name: (a as CSSAnimation).animationName, duration: Number(t.duration), delay: Number(t.delay), easing: String((a.effect as KeyframeEffect).getKeyframes()[0]!.easing) }; });
      resolve({ names, frames });
    };
    requestAnimationFrame(tick);
  }), ms);
}

test('a new shelf card rises and settles in 220 ms, its ring is drawn in 180 ms, held, and fades over 400 ms; the mark is gone by 5 s', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await p.evaluate(() => {
    const mark: Record<string, number> = {};
    (window as unknown as { __mark: Record<string, number> }).__mark = mark;
    new MutationObserver(() => {
      const on = document.querySelector('aside.hm-panel .kit-card[data-size="small"][data-fresh]') !== null, now = performance.now();
      if (on && mark.came === undefined) mark.came = now;
      if (!on && mark.came !== undefined && mark.gone === undefined) mark.gone = now;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  const watching = watchArrival(500);
  await addFirstSkill();
  const seen = await watching;
  const by = (name: string) => seen.names.find(a => a.name === name)!;
  console.log('MEASURED arrival animations:', JSON.stringify(seen.names));
  console.log('MEASURED arrival frames (t, opacity, rise px):', JSON.stringify(seen.frames.filter((_, i) => i % 2 === 0).map(f => [f.t, f.opacity, f.y])));
  expect(by('kit-arrive')).toMatchObject({ duration: 220, delay: 0, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  expect(by('kit-ring-draw')).toMatchObject({ duration: 180, delay: 0, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  expect(by('kit-ring-fade')).toMatchObject({ duration: 400, delay: 4600 });
  expect(seen.names.map(a => a.name).sort()).toEqual(['kit-arrive', 'kit-fill-fade', 'kit-ring-draw', 'kit-ring-fade']);
  // The card starts invisible and a few pixels low, and has landed (full opacity, no offset) after 220 ms.
  expect(seen.frames[0]!.opacity).toBeLessThan(0.6); expect(seen.frames[0]!.y).toBeGreaterThan(1);
  expect(Math.max(...seen.frames.map(f => f.y))).toBeLessThanOrEqual(6.01);
  const landed = seen.frames.find(f => f.t >= 230)!;
  expect(landed.opacity).toBe(1); expect(landed.y).toBe(0);
  // The mark is taken off at 5 s, and the ring has faded by then. A watcher in the page writes down when the mark came and went.
  await p.mouse.move(2, 450);
  await p.waitForFunction(() => (window as unknown as { __mark: Record<string, number> }).__mark.gone !== undefined, null, { timeout: 8000 });
  const mark = await p.evaluate(() => (window as unknown as { __mark: Record<string, number> }).__mark);
  console.log('MEASURED the mark on the new card stayed', Math.round(mark.gone! - mark.came!), 'ms');
  expect(mark.gone! - mark.came!).toBeGreaterThan(4900); expect(mark.gone! - mark.came!).toBeLessThan(5300);
});

test('with reduce motion the new card is marked at once, with a static ring, and nothing animates', async () => {
  const p = page();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  await resize(p, 1280, 800);
  await addFirstSkill();
  const card = panel().locator('.kit-card[data-size="small"][data-fresh]');
  await expect(card).toHaveCount(1);
  await framesPainted(p);
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await card.evaluate(el => { const s = getComputedStyle(el); return [s.animationName, s.opacity, s.transform, /0px 0px 3px/.test(s.boxShadow) || /3px/.test(s.boxShadow)]; })).toEqual(['none', '1', 'none', true]);
  await p.mouse.move(2, 450);
  await expect(panel().locator('.kit-card[data-fresh]')).toHaveCount(0, { timeout: 7000 });
});

// ---- 10. Layers come in and go out.
test('the "?" popover fades in over 140 ms with a 4 px rise and out over 100 ms; with reduce motion it comes and goes at once', async () => {
  const p = page();
  const help = bar().getByRole('button', { name: 'Help', exact: true });
  await help.click();
  const pop = p.locator('.kit-popover');
  expect(await pop.evaluate(el => { const s = getComputedStyle(el); return [s.animationName, s.animationDuration, s.animationTimingFunction]; })).toEqual(['kit-overlay-in', '0.14s', 'cubic-bezier(0.23, 1, 0.32, 1)']);
  expect(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion-home-overlay-travel'))).toBe('4px');
  await animationsDone(p);
  await p.keyboard.press('Escape');
  await expect(pop).toHaveAttribute('data-leaving', '');
  expect(await pop.evaluate(el => { const s = getComputedStyle(el); return [s.animationName, s.animationDuration]; })).toEqual(['kit-overlay-out', '0.1s']);
  await expect(pop).toHaveCount(0);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  await bar().getByRole('button', { name: 'Help', exact: true }).click();
  await expect(pop).toBeVisible();
  expect(await p.evaluate(() => document.getAnimations().length)).toBe(0);
  await p.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(bar().getByRole('button', { name: 'Help', exact: true })).toBeFocused();
});

test('the copies dialog and the share sheet fade and rise in, and leave faster; the scrim is just a fade', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Inbox sorter', exact: true }));
  await panel().getByRole('button', { name: '2 different copies' }).click();
  const dialog = p.getByRole('dialog', { name: 'Two different copies' });
  await expect(dialog).toBeVisible();
  const enter = await p.evaluate(() => { const scrim = getComputedStyle(document.querySelector('.add-scrim')!), box = getComputedStyle(document.querySelector('.add-dialog')!); return { scrim: [scrim.animationName, scrim.animationDuration], box: [box.animationName, box.animationDuration] }; });
  expect(enter).toEqual({ scrim: ['kit-fade-in', '0.14s'], box: ['kit-overlay-in', '0.14s'] });
  await animationsDone(p);
  await p.keyboard.press('Escape');
  await expect(p.locator('.add-scrim')).toHaveAttribute('data-leaving', '');
  expect(await p.evaluate(() => getComputedStyle(document.querySelector('.add-scrim')!).animationName)).toBe('kit-overlay-out');
  await expect(dialog).toHaveCount(0);
  await expect(panel().getByRole('button', { name: '2 different copies' })).toBeFocused();
  // The share sheet: the same.
  await bar().getByRole('button', { name: 'Version history', exact: true }).click();
  await p.getByRole('button', { name: 'Share my agents' }).click();
  const sheet = p.getByRole('dialog', { name: /Share/ });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate(el => [getComputedStyle(el).animationName, getComputedStyle(el).animationDuration])).toEqual(['kit-overlay-in', '0.14s']);
  await animationsDone(p);
  await p.keyboard.press('Escape');
  await expect(p.locator('.add-scrim')).toHaveAttribute('data-leaving', '');
  await expect(sheet).toHaveCount(0);
});

test('the Choose notes sheet fades in with an 8 px rise (not a 24 px slide), and leaves with a fade', async () => {
  const p = page();
  await resize(p, 1280, 800);
  await ensurePicked(p.locator('.hm-grid').getByRole('button', { name: 'Report builder', exact: true }));
  const frames = sampling(400, () => { const el = document.querySelector('[data-slot="notes"]'); if (el === null) return null; const s = getComputedStyle(el), m = new DOMMatrix(s.transform === 'none' ? undefined : s.transform); return { o: Number(s.opacity), x: m.m41, y: m.m42, name: s.animationName }; });
  await panel().getByRole('button', { name: 'Choose notes' }).click();
  const rows = (await frames).filter(r => r.v !== null).map(r => r.v!);
  console.log('MEASURED Choose notes sheet (opacity, x, y):', JSON.stringify(rows.slice(0, 6).map(r => [r.o, r.x, Math.round(r.y * 10) / 10])));
  expect(rows[0]!.name).toBe('kit-sheet-in');
  expect(rows.every(r => r.x === 0)).toBe(true);
  expect(Math.max(...rows.map(r => r.y))).toBeLessThanOrEqual(8.01); expect(rows[0]!.y).toBeGreaterThan(2);
  expect(rows[0]!.o).toBeLessThan(0.9);
  await animationsDone(p);
  await p.keyboard.press('Escape');
  await expect(p.locator('[data-slot="notes"]')).toHaveCount(0);
});

// ---- 11. A press, a quiet bar, and the Find screen.
test('a press shrinks a button and a card to 0.98 within 100 ms; a disabled button does not move; with reduce motion nothing moves', async () => {
  const p = page();
  await resize(p, 1280, 800);
  const add = addButton();
  const box = (await add.boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector('header.hm-bar [data-tour="add"]')!).transform).a < 0.99, null, { timeout: 500 });
  await animationsDone(p);
  expect(await add.evaluate(el => getComputedStyle(el).transform)).toBe('matrix(0.98, 0, 0, 0.98, 0, 0)');
  expect(await add.evaluate(el => getComputedStyle(el).transitionDuration.includes('0.1s'))).toBe(true);
  await p.mouse.move(2, 450); await p.mouse.up();
  await expect(drawer()).toHaveCount(0);
  // A card: pressing its name shrinks the whole card.
  const card = p.locator('.kit-card[data-kind="agent"]').nth(2);
  const cbox = (await card.boundingBox())!;
  await p.mouse.move(cbox.x + 40, cbox.y + 20); await p.mouse.down();
  await p.waitForFunction(() => { const el = document.querySelectorAll('.kit-card[data-kind="agent"]')[2]!; return new DOMMatrix(getComputedStyle(el).transform).a < 0.99; }, null, { timeout: 500 });
  await p.mouse.move(2, 450); await p.mouse.up();
  // Save is disabled with nothing to save: pressing it does nothing to it.
  const save = p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true });
  const sbox = (await save.boundingBox())!;
  await p.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2); await p.mouse.down();
  await framesPainted(p); await framesPainted(p);
  expect(await save.evaluate(el => getComputedStyle(el).transform)).toBe('none');
  await p.mouse.up();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(p); await skipTour(p);
  const box2 = (await addButton().boundingBox())!;
  await p.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2); await p.mouse.down();
  await framesPainted(p); await framesPainted(p);
  expect(await addButton().evaluate(el => getComputedStyle(el).transform)).toBe('none');
  await p.mouse.move(2, 450); await p.mouse.up();
});

test('the Find screen: a tile lights with no part waiting, and the reading bar grows by scaleX from its left edge', async () => {
  const p = page();
  await fresh(p, undefined, { welcome: true });
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await expect(p.getByRole('button', { name: 'Looks right' })).toBeVisible();
  await p.getByRole('button', { name: 'Looks right' }).click();
  const frames = sampling(2500, () => { const f = document.querySelector('.fr-progress-fill'); if (f === null) return null; const s = getComputedStyle(f); return { x: new DOMMatrix(s.transform === 'none' ? undefined : s.transform).a, origin: s.transformOrigin, prop: s.transitionProperty, w: (f as HTMLElement).offsetWidth }; });
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  const rows = (await frames).filter(r => r.v !== null).map(r => r.v!);
  console.log('MEASURED reading bar scaleX over time:', JSON.stringify([...new Set(rows.map(r => Math.round(r.x * 100) / 100))]));
  expect(rows.length).toBeGreaterThan(5);
  expect(rows[0]!.prop).toBe('transform'); expect(rows[0]!.origin.startsWith('0px')).toBe(true);
  const scales = [...new Set(rows.map(r => Math.round(r.x * 100) / 100))];
  expect(scales.some(x => x > 0 && x < 1)).toBe(true);
  expect(Math.max(...scales)).toBeGreaterThan(0.6);
  // The bar keeps its layout width the whole time: only a transform moves.
  expect(new Set(rows.map(r => Math.round(r.w / 10))).size).toBe(1);
  await expect(p.getByRole('heading', { level: 1, name: 'Your agents' })).toBeVisible({ timeout: 10_000 });
});

test('the closing note fades in, stays six seconds and fades out; the first Save of a guided session shows it', async () => {
  const p = page();
  await fresh(p, undefined, { welcome: true });
  await p.getByRole('button', { name: 'Find my agents' }).click();
  await p.getByRole('button', { name: 'Looks right' }).click();
  await p.getByRole('button', { name: 'Yes, read them' }).click();
  await expect(p.getByRole('dialog', { name: 'Tour' })).toBeVisible({ timeout: 10_000 });
  await p.keyboard.press('Escape');
  await p.evaluate(() => {
    const times: Record<string, number> = {};
    (window as unknown as { __toast: Record<string, number> }).__toast = times;
    new MutationObserver(() => {
      const t = document.querySelector('.hm-toast'); if (t === null) return;
      const now = performance.now();
      if (t.hasAttribute('data-open') && times.open === undefined) times.open = now;
      if (t.hasAttribute('data-leaving') && times.leaving === undefined) times.leaving = now;
      if (times.leaving !== undefined && !t.hasAttribute('data-leaving') && times.gone === undefined) times.gone = now;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  // The tour was skipped without a pick, so the person picks an agent first (the tour does not pick one for them).
  await p.locator('.hm-grid .kit-card[data-kind="agent"] .kit-card-main').first().click();
  await panel().locator('.kit-remove').first().click();
  await p.getByRole('region', { name: 'Save bar' }).getByRole('button', { name: 'Save', exact: true }).click();
  const toast = p.locator('.hm-toast');
  await expect(toast).toHaveText('Saved in this preview. Your files are untouched.');
  expect(await toast.evaluate(el => [getComputedStyle(el).animationName, getComputedStyle(el).animationDuration])).toEqual(['hm-toast-in', '0.14s']);
  await p.waitForFunction(() => (window as unknown as { __toast: Record<string, number> }).__toast.gone !== undefined, null, { timeout: 12_000 });
  const t = await p.evaluate(() => (window as unknown as { __toast: Record<string, number> }).__toast);
  console.log('MEASURED closing note: fade starts after', Math.round(t.leaving! - t.open!), 'ms, gone after', Math.round(t.gone! - t.open!), 'ms');
  expect(t.leaving! - t.open!).toBeGreaterThan(5500); expect(t.leaving! - t.open!).toBeLessThan(7000);
  expect(t.gone! - t.leaving!).toBeGreaterThan(80); expect(t.gone! - t.leaving!).toBeLessThan(250);
});
