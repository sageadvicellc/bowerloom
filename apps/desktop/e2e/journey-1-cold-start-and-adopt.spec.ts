/**
 * Journey 1 (spec section 12): "Cold start and adopt". The person installs with the one terminal command, approves a scan, ticks places, and sees everything as one graph.
 *
 * It runs on the made-up home (tools/made-up-home.ts). Two steps are NOT run here:
 *   - "installs with the one terminal command" is outside the app (it is the terminal), so a test of the app cannot run it. `e2e/packaged-app.spec.ts` starts a built app when one is there.
 * "Sees everything as one graph" is step 1.5: the Overview is the first screen after the read, and it shows every place found (owner decision, every place closed and the home open).
 * What runs: the scan in its two questions, the ticks, the read, the Overview, and "adopt by copy" of two projects, which is how the scan's finds reach the graph of a folder. Every count and every byte is
 * read from the files by the test.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { adoptSheet, newMadeUpHome, openInBuilder, readTree, startApp, without } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

let h: RealHarness;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

// ---- what the files say, counted by the test --------------------------------------------------------------------------------

const names = (dir: string, keep: (name: string) => boolean = () => true): string[] => (existsSync(dir) ? readdirSync(dir).filter(keep).sort() : []);
const json = (file: string): Record<string, unknown> => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {});
const hookCount = (file: string): number => {
  const hooks = json(file).hooks as Record<string, { hooks?: unknown[] }[]> | undefined;
  return hooks === undefined ? 0 : Object.values(hooks).flat().reduce((n, group) => n + (group.hooks?.length ?? 0), 0);
};
const serverCount = (file: string): number => Object.keys((json(file).mcpServers as Record<string, unknown> | undefined) ?? {}).length;
const tomlServers = (file: string): number => (existsSync(file) ? (readFileSync(file, 'utf8').match(/^\[mcp_servers\.[^\]]+\]/gm) ?? []).length : 0);
const skillDirs = (dir: string): number => names(dir, n => existsSync(join(dir, n, 'SKILL.md'))).length;
/** Markdown files at the top of a project folder, outside hidden names: the pages the scan calls notes. */
const topNotes = (dir: string): number => names(dir, n => n.endsWith('.md')).length;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The words of a place's count line: agents, skills, tools (servers and hooks are told apart), and notes; a kind with none is left out. */
function line(c: { agent: number; skill: number; tool: number; hook: number; note: number }): string {
  const parts = [['agent', c.agent], ['skill', c.skill], ['tool', c.tool], ['hook', c.hook], ['note', c.note]] as const;
  const words = parts.filter(([, n]) => n > 0).map(([w, n]) => plural(n, w));
  return words.length === 0 ? 'Nothing here' : words.join(', ');
}

test('Journey 1, scan: Find my files, the two questions, the ticks, and the read; every count matches the files and no file changes', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), root = home.home;
  const before = readTree(root, { skip: ['.local', '.git'] });
  h = await startApp(home, '', { freshTour: true });
  const p: Page = h.page;
  const card = (name: string | RegExp) => p.locator('.hxf-card', { hasText: name });

  await test.step('1.2 approve the scan: question one lists the places with counts from the files, and the paths show only behind Show details', async () => {
    await expect(p.getByRole('heading', { level: 1, name: 'Bowerloom', exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Find my files', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Found 2 places' })).toBeVisible();
    const claude = { agent: names(join(root, '.claude', 'agents')).length, skill: skillDirs(join(root, '.claude', 'skills')), tool: serverCount(join(root, '.claude.json')), hook: hookCount(join(root, '.claude', 'settings.json')), note: 0 };
    const codex = { agent: names(join(root, '.codex', 'agents')).length, skill: skillDirs(join(root, '.codex', 'skills')), tool: tomlServers(join(root, '.codex', 'config.toml')), hook: 0, note: 0 };
    await expect(card('Claude Code at home')).toContainText(line(claude));
    await expect(card('Codex at home')).toContainText(line(codex));
    expect(await p.locator('body').innerText()).not.toContain(root);
    await expect(p.locator('[data-details]')).toHaveCount(0);
    await p.getByRole('button', { name: 'Show details', exact: true }).click();
    await expect(p.locator('[data-details]').first()).toContainText('~');
    await p.getByRole('button', { name: 'Hide details', exact: true }).click();
  });

  await test.step('1.3a add the folder of projects: each project is a place with counts from its files', async () => {
    await h.pick(home.projects);
    await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Found 6 places' })).toBeVisible();
    const project = (name: string): string => {
      const dir = join(home.projects, name);
      return line({
        agent: names(join(dir, '.claude', 'agents')).length + names(join(dir, '.codex', 'agents')).length,
        skill: skillDirs(join(dir, '.claude', 'skills')) + skillDirs(join(dir, '.agents', 'skills')) + skillDirs(join(dir, '.codex', 'skills')) + skillDirs(join(dir, '.bowerloom', 'skills')),
        tool: serverCount(join(dir, '.mcp.json')) + tomlServers(join(dir, '.codex', 'config.toml')),
        hook: hookCount(join(dir, '.claude', 'settings.json')), note: topNotes(dir),
      });
    };
    for (const name of ['ferry-schedule', 'kite-workshop', 'rope-yard']) await expect(card(name).first(), name).toContainText(project(name));
  });

  await test.step('1.3b tick places: untick one, and the second question names exactly the ticked folders', async () => {
    await card('kite-workshop').getByRole('checkbox').uncheck();
    await p.getByRole('button', { name: 'Looks right', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Read what is inside?' })).toBeVisible();
    const consent = p.locator('[data-consent]');
    await expect(consent.locator('li[data-place]')).toHaveCount(4);
    await expect(consent).toContainText('ferry-schedule');
    await expect(consent).toContainText('rope-yard');
    await expect(consent).not.toContainText('kite-workshop');
    await expect(consent).toContainText('Your files are not changed.');
    expect(await p.locator('body').innerText()).not.toContain(root);
    // Escape goes back without reading.
    await p.keyboard.press('Escape');
    await expect(p.getByRole('heading', { level: 1, name: 'Found 6 places' })).toBeVisible();
    await expect(card('kite-workshop').getByRole('checkbox')).not.toBeChecked();
    await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  });

  await test.step('1.3c read the ticked places: the list holds the ticked sources only, counts agree, and the Bowerloom folder is counted as left out', async () => {
    await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
    await expect(p.locator('[data-count]')).toContainText('parts in all', { timeout: 20_000 });
    await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible();
    const body = await p.locator('body').innerText();
    for (const present of ['Your Claude Code folder', 'Your Codex folder', 'ferry-schedule (Claude Code)', 'ferry-schedule (Codex)']) expect(body, present).toContain(present);
    expect(body, 'the unticked project is not read').not.toContain('kite-workshop');
    // The cards' own numbers add up to the count line.
    const cards = await p.locator('.hxf-card').allInnerTexts();
    const sum = cards.reduce((n, text) => n + [...text.matchAll(/(\d+) (?:agents?|skills?|tools?|contexts?)/g)].reduce((m, x) => m + Number(x[1]), 0), 0);
    const stated = /(\d+) sources?, (\d+) parts in all/.exec(await p.locator('[data-count]').innerText())!;
    expect(Number(stated[1])).toBe(cards.length);
    expect(Number(stated[2])).toBe(sum);
    // rope-yard already holds a harness: its skills are listed as a source of their own, by the files' own count, and nothing is counted as left out.
    const ropeSkills = skillDirs(join(home.rope, '.bowerloom', 'skills'));
    expect(cards.filter(text => text.includes('rope-yard (Bowerloom)') && new RegExp(`\\b${ropeSkills} skills?\\b`).test(text)), 'the card of rope-yard lists its skills').toHaveLength(1);
    await expect(p.locator('[data-read-notes]', { hasText: 'in a Bowerloom folder' })).toHaveCount(0);
  });

  await test.step('1.4 the scan changed no file of the home', async () => {
    expect(readTree(root, { skip: ['.local', '.git'] })).toEqual(before);
  });
});

test.fixme('Journey 1, step 1.1: install with the one terminal command (outside the app: a terminal, not a screen; not run in pass 1)', () => {
  // The spec starts the journey with an install from a terminal. The app has no part in it, and a test of the app must not open a terminal. The packaged app has its own spec (e2e/packaged-app.spec.ts).
});

test('Journey 1, step 1.5: the first screen after the read is the Overview; every place is shown closed but the home, a shared skill lights its copies, the List shows the same, and "Open in builder" reaches the Builder', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), root = home.home;
  h = await startApp(home, 'projects');
  const p = h.page, s = adoptSheet(p);
  // A place is "In Bowerloom" when main knows its folder and the folder holds a harness, so kite-workshop is adopted first (the same steps as the second adopt test below).
  await test.step('1.5a a project holds a harness, so the Overview can mark it', async () => {
    await p.getByRole('button', { name: 'From a folder', exact: true }).click();
    await h.pick(home.kite);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await s.getByRole('button', { name: /^Write \d+ files$/ }).click();
    await expect(s.locator('[data-done]')).toBeVisible();
    await s.getByRole('button', { name: 'Close', exact: true }).last().click();
    await s.waitFor({ state: 'detached' });
  });

  await test.step('1.5b read the home and the projects; "Not now" on the read leads to the Overview', async () => {
    await p.evaluate(() => { location.hash = '#app/overview'; });
    await p.getByRole('button', { name: 'Find my files', exact: true }).click();
    await h.pick(home.projects);
    await p.getByRole('button', { name: 'Add a folder', exact: true }).click();
    await p.getByRole('button', { name: 'Looks right', exact: true }).click();
    await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
    await expect(p.locator('[data-count]')).toContainText('parts in all', { timeout: 20_000 });
    await p.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
    // The Grid is the first view of a wide window. The steps below are about the Graph, so the Graph is chosen; the Grid has its own spec (harness-overview-grid.spec.ts).
    await p.getByRole('radio', { name: 'Graph view' }).click();
    await expect(p.locator('.hxo-canvas')).toBeVisible();
  });

  let totals = { total: 0, inBowerloom: 0 };
  // No absolute path in the words on the page, nor in the markup (aria-label, title, collapsed text).
  const noPath = async (): Promise<void> => {
    expect(await p.locator('body').innerText(), 'no absolute path is in the words on the page').not.toContain(root);
    expect(await p.locator('body').evaluate(el => el.innerHTML), 'no absolute path is in the markup').not.toContain(root);
  };
  const toggle = (name: string) => p.locator('[data-place-toggle]', { hasText: name });
  await test.step('1.5c every place is shown with its name, its ~ label and its counts, all closed but the home', async () => {
    const claudeHome = { agent: names(join(root, '.claude', 'agents')).length, skill: skillDirs(join(root, '.claude', 'skills')), tool: serverCount(join(root, '.claude.json')) + hookCount(join(root, '.claude', 'settings.json')) };
    const claudeOf = (name: string) => ({ agent: names(join(home.projects, name, '.claude', 'agents')).length, skill: skillDirs(join(home.projects, name, '.claude', 'skills')), tool: serverCount(join(home.projects, name, '.mcp.json')) + hookCount(join(home.projects, name, '.claude', 'settings.json')) });
    const words = (c: { agent: number; skill: number; tool: number }): string => [['agent', c.agent], ['skill', c.skill], ['tool', c.tool]].filter(([, n]) => (n as number) > 0).map(([w, n]) => plural(n as number, w as string)).join(', ');
    // The places the read finds, from the files: the two home folders, then for ferry-schedule and kite-workshop a place for each of Claude Code, Codex and notes that holds something.
    // A folder that holds a harness is a place of its own, "<folder> (Bowerloom)", counted from the files of its .bowerloom, whether or not the app knows the folder. rope-yard is one that the
    // app does not know. kite-workshop, adopted in step 1.5a, is known to the app, so its places, this one too, are In Bowerloom.
    const harnessOf = (dir: string): { agent: number; skill: number; tool: number; context: number } => {
      const base = join(dir, '.bowerloom'), list = (file: string, key: string): number => (existsSync(join(base, file)) ? ((json(join(base, file))[key] as unknown[] | undefined) ?? []).length : 0);
      return { agent: names(join(base, 'agents'), n => n.endsWith('.md')).length, skill: skillDirs(join(base, 'skills')), tool: list('mcp.json', 'servers') + list('hooks.json', 'hooks'), context: list('knowledge.json', 'sources') };
    };
    const holds = (c: { agent: number; skill: number; tool: number }): number => (c.agent + c.skill + c.tool > 0 ? 1 : 0);
    const codexOf = (name: string): number => names(join(home.projects, name, '.codex', 'agents')).length;
    const placesOf = (name: string): number => holds(claudeOf(name)) + (codexOf(name) > 0 ? 1 : 0) + (topNotes(join(home.projects, name)) > 0 ? 1 : 0);
    const harnessPlace = (name: string): number => (existsSync(join(home.projects, name, '.bowerloom', 'harness.json')) ? 1 : 0);
    const homePlaces = holds(claudeHome) + (names(join(root, '.codex', 'agents')).length > 0 ? 1 : 0);
    const total = homePlaces + placesOf('ferry-schedule') + placesOf('kite-workshop') + harnessPlace('ferry-schedule') + harnessPlace('kite-workshop') + harnessPlace('rope-yard'), inBowerloom = placesOf('kite-workshop') + harnessPlace('kite-workshop');
    totals = { total, inBowerloom };
    await expect(p.getByText(`${total} places`, { exact: true }).first()).toBeVisible();
    await expect(p.locator('[data-place-toggle]')).toHaveCount(total);
    const harnessWords = (c: { agent: number; skill: number; tool: number; context: number }): string => [['agent', c.agent], ['skill', c.skill], ['tool', c.tool], ['set of notes', c.context]].filter(([, n]) => (n as number) > 0).map(([w, n]) => (w === 'set of notes' ? (n === 1 ? '1 set of notes' : `${n} sets of notes`) : plural(n as number, w as string))).join(', ');
    const rows: [string, string, string][] = [
      ['Your Claude Code folder', '~', words(claudeHome)],
      ['Your Codex folder', '~', plural(names(join(root, '.codex', 'agents')).length, 'agent')],
      ['ferry-schedule (Claude Code)', '~/Projects/ferry-schedule', words(claudeOf('ferry-schedule'))],
      ['kite-workshop (Claude Code)', '~/Projects/kite-workshop', words(claudeOf('kite-workshop'))],
      ['ferry-schedule (notes)', '~/Projects/ferry-schedule', '1 set of notes'],
      ['rope-yard (Bowerloom)', '~/Projects/rope-yard', harnessWords(harnessOf(home.rope))],
      ['kite-workshop (Bowerloom)', '~/Projects/kite-workshop', harnessWords(harnessOf(join(home.projects, 'kite-workshop')))],
    ];
    for (const [name, label, counts] of rows) {
      const aria = await toggle(name).first().getAttribute('aria-label');
      expect(aria, name).toContain(`, ${label}, ${counts}`);
    }
    expect(await p.locator('[data-place-toggle][aria-expanded="true"]').count(), 'only the home is open').toBe(1);
    await expect(toggle('Your Claude Code folder')).toHaveAttribute('aria-expanded', 'true');
    await noPath();
  });

  await test.step('1.5d the places in Bowerloom are told from the others, and the others offer a folder chooser', async () => {
    const marks = await p.locator('.hxo-mark').allInnerTexts();
    expect(marks.filter(m => m === 'In Bowerloom'), 'the places of the adopted folder').toHaveLength(totals.inBowerloom);
    expect(marks.filter(m => m === 'Not in Bowerloom yet')).toHaveLength(totals.total - totals.inBowerloom);
    await expect(p.getByRole('button', { name: 'Open in builder, kite-workshop (Claude Code)', exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Open in builder, ferry-schedule (Claude Code)', exact: true })).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Choose this folder, ferry-schedule (Claude Code)', exact: true }).first()).toBeVisible();
  });

  let copies = 0;
  const alsoIn = (n: number): string => `Also in ${plural(n, 'place')}`;
  await test.step('1.5e open a place, select a skill that is in two places, and see its copies lit', async () => {
    await toggle('ferry-schedule (Claude Code)').click();
    await expect(toggle('ferry-schedule (Claude Code)')).toHaveAttribute('aria-expanded', 'true');
    const scale = (): Promise<number> => p.locator('.hxo-world').evaluate(el => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 'NaN'));
    const cluster = (await p.locator('[data-cluster][data-home]').first().boundingBox())!;
    await p.mouse.move(cluster.x + cluster.width / 2, cluster.y + Math.min(cluster.height / 2, 60));
    await p.keyboard.down('Control');
    for (let i = 0; i < 40 && (await scale()) < 0.6; i += 1) await p.mouse.wheel(0, -30);
    await p.keyboard.up('Control');
    expect(await scale(), 'the zoom reached the detail view').toBeGreaterThanOrEqual(0.6);
    const homeId = (await p.locator('[data-cluster][data-home]').first().getAttribute('data-cluster'))!;
    const skills = p.locator(`[data-node][data-kind="skill"][data-place="${homeId}"]`);
    await expect(skills.first()).toBeVisible();
    let picked = '';
    for (let i = 0; i < await skills.count() && picked === ''; i += 1) {
      await skills.nth(i).click();
      if (await p.locator('[data-details-node] [data-shared]').count() > 0) picked = (await skills.nth(i).getAttribute('data-node'))!;
    }
    expect(picked, 'the home holds a skill that another place holds too').not.toBe('');
    await expect(p.locator(`[data-node="${picked}"][data-selected]`)).toHaveCount(1);
    // How many other places hold a skill of that name, counted from the files of every place the read found.
    const skillName = (await p.locator(`[data-node="${picked}"] .hx-node-name`).innerText()).trim();
    // A copy is a skill of the same name with the same text (the Codex copy of chart-check says other words, so it is not one).
    const text = (dir: string): string | null => (existsSync(join(dir, skillName, 'SKILL.md')) ? readFileSync(join(dir, skillName, 'SKILL.md'), 'utf8') : null);
    const mine = text(join(root, '.claude', 'skills'));
    const elsewhere = [join(root, '.codex', 'skills'), ...['ferry-schedule', 'kite-workshop'].flatMap(n => [join(home.projects, n, '.claude', 'skills'), join(home.projects, n, '.codex', 'skills')])].filter(d => mine !== null && text(d) === mine).length;
    expect(elsewhere, 'the files show the skill in another place').toBeGreaterThan(0);
    copies = elsewhere;
    await expect(p.locator('[data-details-node] [data-shared]')).toHaveText(`Shared. ${alsoIn(elsewhere)}`);
    await expect(p.locator('[data-cluster][data-lit]'), 'the places that hold the copies are lit').toHaveCount(elsewhere);
  });

  await test.step('1.5f the List shows the same places and the same selection', async () => {
    await p.getByRole('radio', { name: 'List view' }).click();
    await expect(p.locator('[data-view="list"]')).toBeVisible();
    await expect(p.locator('li[data-place]')).toHaveCount(totals.total);
    await expect(p.locator('li[data-place][data-open]'), 'the home and the place opened above').toHaveCount(2);
    await expect(p.locator('li.hxo-row[data-selected]')).toHaveCount(1);
    // The lit places are the home, which holds the selection, and the place of the copy. The copy is a row of the second; it is open when it is the place opened above.
    const lit = p.locator('li[data-place][data-lit]');
    await expect(lit, 'the home and the places that hold the copies are lit').toHaveCount(copies + 1);
    const ferry = p.locator('li[data-place]', { has: toggle('ferry-schedule (Claude Code)') });
    await expect(ferry).toHaveAttribute('data-lit', '');
    await expect(ferry.locator('[data-place-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(ferry.locator('li.hxo-row[data-lit]'), 'the copy is lit in the List too').toHaveCount(1);
    await noPath();
  });

  await test.step('1.5g "Open in builder" on a place in Bowerloom reaches the Builder of that folder', async () => {
    await p.getByRole('button', { name: 'Open in builder, kite-workshop (Claude Code)', exact: true }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'kite-workshop', exact: true })).toBeVisible();
    await expect(p.locator('.hx-node').first()).toBeVisible();
  });
});

test('Journey 1, adopt by copy: a project is adopted with the choices and approvals the plan asks for, the original files stay as they were, and the folder\'s graph shows what was adopted', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), dir = home.ferry;
  const original = readTree(dir);
  h = await startApp(home, 'projects');
  const p = h.page, s = adoptSheet(p);

  await test.step('1.4a pick the project: the review lists what was found and where, and writes nothing', async () => {
    await p.getByRole('button', { name: 'From a folder', exact: true }).click();
    await h.pick(dir);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await expect(s.locator('.hxi-card', { hasText: 'ferry-schedule' })).toHaveAttribute('aria-pressed', 'true');
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(s.getByText(/^Read \d+ files in ~\/Projects\/ferry-schedule\. Nothing is written yet\.$/)).toBeVisible();
    await expect(s).not.toContainText(home.home);
    expect(readTree(dir), 'nothing is written while the person reads').toEqual(original);
  });

  await test.step('1.4b a skill found in two places with the same text is one item that lists both places', async () => {
    const item = s.locator('[data-item="skills/timetable-check"]');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('.agents/skills/timetable-check');
    await expect(item).toContainText('.claude/skills/timetable-check');
    expect(original['.agents/skills/timetable-check/SKILL.md']).toBe(original['.claude/skills/timetable-check/SKILL.md']);
  });

  await test.step('1.4c two instruction files that differ are shown side by side, and the person picks one', async () => {
    const conflict = s.locator('[data-conflict="system-prompt/AGENTS.md"]');
    await expect(conflict).toContainText('AGENTS.md');
    await expect(conflict).toContainText('CLAUDE.md');
    expect(original['AGENTS.md']).not.toBe(original['CLAUDE.md']);
    await conflict.getByRole('radio', { name: /^AGENTS\.md/ }).click();
    await expect(conflict).toContainText('Using AGENTS.md.');
  });

  await test.step('1.4d a Codex agent whose instructions sit in a multi-line string is adopted, not left out', async () => {
    await expect(s.locator('[data-unmapped=".codex/agents/signal-reader.toml"]')).toHaveCount(0);
    await expect(s.locator('[data-item="subagents/signal-reader"]')).toHaveCount(1);
  });

  let written: string[];
  await test.step('1.4e approve the hook and the tool (each runs a command or sends a value), then write: only the harness folder changes', async () => {
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    const approvals = s.locator('[data-section="approvals"] [data-tick]');
    await expect(approvals).toHaveCount(2);
    const write = s.getByRole('button', { name: /^Write \d+ files$/ });
    await expect(write).toBeDisabled();
    for (const a of await approvals.all()) await a.getByRole('checkbox').check();
    await expect(write).toBeEnabled();
    expect(readTree(dir), 'the ticks write nothing').toEqual(original);
    await write.click();
    await expect(s.locator('[data-done]')).toBeVisible();
    expect((await h.asked()).at(-1)!.message).toMatch(/^Write \d+ files into ~\/Projects\/ferry-schedule\/\.bowerloom\?$/);
    written = (await s.locator('[data-done] li').allInnerTexts()).map(t => t.trim().replace(/^\.bowerloom\//, ''));
  });

  await test.step('1.4f the bytes: the original files are unchanged, the written files are the listed files, and each carries what its source said', async () => {
    const after = readTree(dir);
    expect(without(after, '.bowerloom/'), 'copy, not move: every original file is as it was').toEqual(original);
    const harness = Object.fromEntries(Object.entries(after).filter(([f]) => f.startsWith('.bowerloom/')).map(([f, t]) => [f.slice('.bowerloom/'.length), t]));
    expect(Object.keys(harness).sort(), 'the files on disk are the files the sheet listed').toEqual([...written].sort());
    expect(harness['instructions/AGENTS.md']).toBe(original['AGENTS.md']);
    expect(harness['skills/timetable-check/SKILL.md']).toBe(original['.claude/skills/timetable-check/SKILL.md']);
    expect(harness['skills/chart-check/SKILL.md']).toBe(original['.claude/skills/chart-check/SKILL.md']);
    expect(Object.keys(harness).filter(f => f.startsWith('agents/')), 'the Codex agent with multi-line text is adopted').toEqual(['agents/dock-clerk.md', 'agents/signal-reader.md']);
    expect(harness['agents/signal-reader.md']).toContain('Read each flag. Say what it means.');
    // A tool keeps the name of its variable, never a value (spec principle 3).
    const mcp = JSON.parse(harness['mcp.json']!) as { servers: { name: string; env?: Record<string, string> }[] };
    expect(mcp.servers.map(x => x.name)).toEqual(['tide-feed']);
    expect(mcp.servers[0]!.env).toEqual({ TIDE_API_KEY: '${TIDE_API_KEY}' });
    expect(JSON.parse(harness['hooks.json']!).hooks).toHaveLength(1);
    expect(JSON.parse(harness['guardrails.json']!).rules).toHaveLength(1);
    expect(loadDefinition(join(dir, '.bowerloom')).ok).toBe(true);
  });

  await test.step('1.5 the folder\'s graph shows what was adopted: its agents and skills, as the files hold them', async () => {
    await s.getByRole('button', { name: 'Close', exact: true }).last().click();
    await s.waitFor({ state: 'detached' });
    await p.evaluate(() => { location.hash = '#app/harnesses'; });
    await openInBuilder(h, dir, 'ferry-schedule');
    const ids = await p.locator('.hx-node').evaluateAll(els => els.map(e => e.getAttribute('data-node')).sort());
    const def = join(dir, '.bowerloom');
    const expected = [...names(join(def, 'agents')).map(f => `agent:${f.replace(/\.md$/, '')}`), ...names(join(def, 'skills')).map(f => `skill:${f}`)].sort();
    expect(ids).toEqual(expected);
    expect(ids.length).toBeGreaterThan(0);
  });
});

test('Journey 1, adopt by copy, a second project: a Claude Code project with nothing to approve is adopted, and both folders are listed on the Harnesses screen', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), dir = home.kite;
  const original = readTree(dir);
  h = await startApp(home, 'projects');
  const p = h.page, s = adoptSheet(p);
  await p.getByRole('button', { name: 'From a folder', exact: true }).click();
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.getByText(/^Read \d+ files in ~\/Projects\/kite-workshop\. Nothing is written yet\.$/)).toBeVisible();
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(s.locator('[data-section="approvals"] [data-tick]')).toHaveCount(0);
  await s.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(s.locator('[data-done]')).toBeVisible();
  const after = readTree(dir);
  expect(without(after, '.bowerloom/'), 'every original file is as it was').toEqual(original);
  expect(after['.bowerloom/skills/string-test/SKILL.md']).toBe(original['.claude/skills/string-test/SKILL.md']);
  expect(Object.keys(after).filter(f => f.startsWith('.bowerloom/agents/'))).toEqual(['.bowerloom/agents/wind-reader.md']);
  await s.getByRole('button', { name: 'Close', exact: true }).last().click();
  await s.waitFor({ state: 'detached' });
  await p.evaluate(() => { location.hash = '#app/harnesses'; });
  await h.pick(dir);
  const folders = p.locator('[data-section="folders"]');
  await folders.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(folders.getByRole('button', { name: 'Open kite-workshop in the builder', exact: true })).toBeVisible();
});
