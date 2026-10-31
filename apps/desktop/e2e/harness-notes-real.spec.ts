/**
 * Journey 5 on real folders (Electron started with --prototype-v3-real, HOME and XDG_STATE_HOME pointed at a made-up folder, real git from the machine).
 *
 * "create": Start fresh in a new folder, check the starter files on disk against the kit's own bytes, check that the folder is a repository with exactly one
 * commit and a clean tree, build the Notes keeper with the tour and save it into a harness folder, check `knowledge.json` and the agent's `notes` on disk,
 * install to Claude Code and Codex, and check the notes section in the projected agent files. Then add pages and a report, commit them with the test's own
 * git on a day that is not today, start the app again, and check that the Notes panel shows the page count and the last-change day the test read itself.
 *
 * "link": Use my notes on a folder that has pages and no history. The history offer lists the files the first commit holds. Accepting it makes one commit
 * and leaves every file as it was; declining it leaves no `.git` and writes nothing.
 *
 * Every expected value is read by this test from files and from its own git (a scrubbed environment), never from the app's code or its answers. If git is
 * not where Bowerloom looks for it, the file skips with the reason.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { filesOf, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './proto-temp.js';
import { GIT, KIT_DIR, NO_GIT_REASON, commitAll, commitCount, countMarkdown, git, kitSkillIds, kitStarter, lastCommitDay, walkFiles } from './harness-notes-support.js';

test.skip(GIT === null, NO_GIT_REASON);

let h: RealHarness, home: string;
const page = (): Page => h.page;

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

/** A private made-up home with a folder of notes ready to be chosen. */
function newHome(): string {
  const dir = realpathSync(tempDir('bowerloom-notes-home-'));
  chmodSync(dir, 0o700);
  return dir;
}
const put = (root: string, rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

/** Starts the app on the made-up home at a route of the real launch. A second start with the same home is a restart: the state folder under it stays. */
async function start(route: string): Promise<void> {
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(r => { location.hash = `#prototype-v3-real/${r}`; location.reload(); }, route);
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
}

const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
const tour = (p: Page): Locator => p.getByRole('dialog', { name: 'Tour' });

/** Every file of a folder, hidden names included and `.git` left out: path to bytes. */
function snapshot(root: string): Map<string, Buffer> {
  return new Map([...walkFiles(root)].filter(([path]) => path !== '.git' && !path.startsWith('.git/')));
}
/** The files a first commit holds by the stated rule: every file whose path has no hidden name in it. */
function visibleFiles(root: string): string[] {
  return [...snapshot(root).keys()].filter(path => !path.split('/').some(part => part.startsWith('.'))).sort();
}

test('create: Start fresh makes the starter files and one commit; the keeper is built, saved, installed to both interfaces; the panel shows what the folder holds', async () => {
  test.setTimeout(240_000);
  home = newHome();
  const notes = join(home, 'Documents', 'field-notes');
  mkdirSync(notes, { recursive: true });
  const harnessDir = teamFolder(home), def = join(harnessDir, '.bowerloom');
  const starter = kitStarter();
  expect(starter.size).toBeGreaterThan(3);
  const skills = kitSkillIds();
  expect(existsSync(join(notes, '.git'))).toBe(false);
  await start('notes');
  const p = page();

  // 1. Start fresh in the new folder. The step lists the starter files and writes nothing while the person reads.
  await h.pick(notes);
  await p.getByRole('button', { name: 'Start fresh', exact: true }).click();
  const step = p.locator('[data-notes-step="starter"]');
  await expect(step).toBeVisible();
  await expect(step.locator('[data-starter-file]')).toHaveCount(starter.size);
  expect(await step.locator('[data-starter-file]').evaluateAll(els => els.map(e => e.getAttribute('data-starter-file')).sort())).toEqual([...starter.keys()].sort());
  await expect(p.locator('[data-home]')).not.toContainText(home);
  expect(readdirSync(notes), 'nothing is written while the person reads').toEqual([]);
  await step.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(p.locator('[data-notes-done="created"]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toBe(`Write ${starter.size} files into ~/Documents/field-notes and start its history?`);

  // 2. The starter files on disk are the kit's starter bytes, and nothing else is in the folder besides the history.
  const onDisk = snapshot(notes);
  expect([...onDisk.keys()].sort()).toEqual([...starter.keys()].sort());
  for (const [path, bytes] of starter) expect(onDisk.get(path)!.equals(bytes), path).toBe(true);

  // 3. The folder is a repository with exactly one commit that holds those files, and a clean tree.
  expect(existsSync(join(notes, '.git'))).toBe(true);
  expect(commitCount(notes)).toBe(1);
  expect(git(notes, ['status', '--porcelain'])).toBe('');
  expect(git(notes, ['ls-files']).split('\n').filter(Boolean).sort()).toEqual([...starter.keys()].sort());

  // 4. Build the keeper with the tour and save it into the harness folder.
  await p.getByRole('button', { name: 'Build my Notes keeper', exact: true }).click();
  const s = saveSheet(p);
  await expect(s).toBeVisible();
  await h.pick(harnessDir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(s.locator('.hxi-card', { hasText: 'team' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const t = tour(p);
  await expect(t).toContainText('Step 1 of 7');
  for (let i = 0; i < 3; i++) await t.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(t).toContainText('Skills are what it knows how to do.');
  const tray = s.locator('[data-section="keeper-build"]');
  const skillsShelf = s.locator('[data-shelf="skills"]'), notesShelf = s.locator('[data-shelf="notes"]');
  await tray.locator('[data-card="add-source"]').dragTo(skillsShelf);
  await expect(skillsShelf.locator('[data-on-shelf="add-source"]')).toBeVisible();
  await s.getByRole('button', { name: 'Add the other skills', exact: true }).click();
  expect(await skillsShelf.locator('[data-on-shelf]').evaluateAll(els => els.map(e => e.getAttribute('data-on-shelf')).sort())).toEqual(skills);
  await tray.locator('[data-kind="notes"]').dragTo(notesShelf);
  await expect(notesShelf.locator('[data-on-shelf]')).toHaveCount(1);
  await expect(t).toContainText('Changes wait here until you press Save.');
  await t.getByRole('button', { name: 'Skip tour', exact: true }).click();
  expect(snapshot(def).has('knowledge.json'), 'nothing is written while the person builds').toBe(false);
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file=".bowerloom/knowledge.json"]')).toHaveAttribute('data-action', 'create');
  await expect(review.locator('[data-file=".bowerloom/agents/notes-keeper.md"]')).toHaveAttribute('data-action', 'create');
  await expect(s).not.toContainText(home);
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Save \d+ files$/ }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();

  // 5. On disk: the knowledge source points at the notes folder, the agent lists it in `notes` and all the skills, and each kit skill is byte for byte the kit's.
  const saved = snapshot(def);
  const knowledge = JSON.parse(saved.get('knowledge.json')!.toString('utf8')) as { sources: { kind: string; name: string; path: string }[] };
  expect(knowledge.sources).toHaveLength(1);
  const source = knowledge.sources[0]!;
  expect(source.kind).toBe('wiki-folder');
  expect(source.name).toBe('field-notes');
  expect(source.path.startsWith('~/') ? join(home, source.path.slice(2)) : resolve(harnessDir, source.path)).toBe(notes);
  const agentText = saved.get('agents/notes-keeper.md')!.toString('utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(agentText)![1]!;
  expect(front).toMatch(/^notes:\n {2}- field-notes$/m);
  for (const id of skills) expect(front, id).toMatch(new RegExp(`^ {2}- ${id}$`, 'm'));
  for (const id of skills) {
    const kitFiles = [...walkFiles(join(KIT_DIR, 'skills', id))];
    expect(kitFiles.length).toBeGreaterThan(0);
    for (const [rel, bytes] of kitFiles) expect(saved.get(`skills/${id}/${rel}`)?.equals(bytes), `${id}/${rel}`).toBe(true);
  }
  // The notes folder itself was not touched by the save.
  expect(commitCount(notes)).toBe(1);
  expect(git(notes, ['status', '--porcelain'])).toBe('');

  // 6. Install to Claude Code and Codex.
  await s.locator('[data-install-next]').click();
  const install = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(install).toBeVisible();
  await install.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(install.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
  await expect(install.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
  await install.getByRole('button', { name: 'Next', exact: true }).click();
  // Codex has no per-tool list, so the keeper's tool limit is one weaker rule the person reads and ticks before the plan.
  const weaker = install.locator('[data-section="approve-lines"]');
  await expect(weaker).toContainText('notes-keeper (tools)');
  for (const box of await weaker.locator('input').all()) await box.check();
  await install.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
  await install.locator('[data-approve-plan] input').check();
  const before = filesOf(harnessDir);
  await install.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(install.locator('[data-done]')).toBeVisible();
  const after = filesOf(harnessDir);
  const projectedCount = Object.keys(after).filter(f => !(f in before)).length;
  expect(projectedCount).toBeGreaterThan(0);
  expect((await h.asked()).at(-1)!.message).toBe(`Write ${projectedCount} files in ~/Projects/team?`);

  // 7. The projected agent instructions carry the notes section: the heading, the source, the folder, and its AGENTS.md.
  const section = (text: string): void => {
    expect(text).toContain('## Notes');
    expect(text).toContain(`- ${source.name}: `);
    expect(text).toContain(`\`${source.path}\``);
    expect(text).toContain(`\`${source.path}/AGENTS.md\``);
  };
  section(readFileSync(join(harnessDir, '.claude', 'agents', 'notes-keeper.md'), 'utf8'));
  section(readFileSync(join(harnessDir, '.codex', 'agents', 'notes-keeper.toml'), 'utf8'));
  // An agent that does not list the notes has no section.
  expect(readFileSync(join(harnessDir, '.claude', 'agents', 'writer.md'), 'utf8')).not.toContain('## Notes');
  await h.app.close();

  // 8. The dashboard. The test adds pages (one nested, one in a hidden folder that is not counted) and a report, and commits them on a day that is not today.
  put(notes, 'pages/garden.md', '# Garden\n');
  put(notes, 'pages/deep/roots.md', '# Roots\n');
  put(notes, 'pages/picture.png', 'not a page');
  put(notes, '.hidden/skipped.md', '# Hidden\n');
  put(notes, 'reports/2024-03-04-refine.md', '# Report\n');
  put(notes, 'reports/2024-02-01-refine.md', '# Older report\n');
  commitAll(notes, 'Add pages', '2024-03-05');
  const pages = countMarkdown(notes);
  const day = lastCommitDay(notes);
  const reportDate = readdirSync(join(notes, 'reports')).flatMap(n => (/^(\d{4}-\d{2}-\d{2})-.*\.md$/.exec(n)?.[1] ?? [])).sort().at(-1)!;
  expect(pages).toBe(starter.size + 2 + 2);
  expect(day).toBe('2024-03-05');
  expect(reportDate).toBe('2024-03-04');

  await start('projects');
  const q = page();
  await q.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  const u = saveSheet(q);
  await h.pick(harnessDir);
  await u.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(u.locator('.hxi-card', { hasText: 'team' })).toHaveAttribute('aria-pressed', 'true');
  await u.getByRole('button', { name: 'Next', exact: true }).click();
  const card = u.locator('[data-section="notes"] [data-card]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-pages]')).toHaveText(`${pages} pages`);
  await expect(card.locator('[data-last-change]')).toHaveText(`Last change ${day}`);
  await expect(card.locator('[data-report]')).toHaveText(`Tidy-up report ${reportDate}`);
  await expect(card.locator('[data-readers]')).toHaveText('Read by notes-keeper');
  await card.getByRole('button', { name: 'Show details' }).click();
  await expect(card).toContainText('~/Documents/field-notes');
  await expect(card).toContainText(`reports/${reportDate}-refine.md`);
  await expect(u).not.toContainText(home);
  expect(commitCount(notes), 'reading the folder writes nothing').toBe(2);
});

test('link: an existing wiki with no history gets the offer; accepting it makes one commit and changes no file', async () => {
  test.setTimeout(180_000);
  home = newHome();
  const wiki = join(home, 'Documents', 'old-wiki');
  put(wiki, 'index.md', '# Old wiki\n');
  put(wiki, 'topics/soil.md', '# Soil\n');
  put(wiki, 'topics/notes.txt', 'plain text\n');
  put(wiki, 'assets/diagram.png', 'png bytes');
  put(wiki, '.obsidian/app.json', '{}\n');
  put(wiki, '.DS_Store', 'junk');
  const visible = visibleFiles(wiki);
  expect(visible).toEqual(['assets/diagram.png', 'index.md', 'topics/notes.txt', 'topics/soil.md']);
  const bytesBefore = snapshot(wiki);
  expect(existsSync(join(wiki, '.git'))).toBe(false);
  await start('notes');
  const p = page();

  await h.pick(wiki);
  await p.getByRole('button', { name: 'Use my notes', exact: true }).click();
  const offer = p.locator('[data-notes-offer]');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('This folder keeps no history.');
  await expect(offer.locator('[data-history-file]')).toHaveCount(visible.length);
  expect(await offer.locator('[data-history-file]').evaluateAll(els => els.map(e => e.getAttribute('data-history-file')).sort())).toEqual(visible);
  await expect(offer).toContainText(/hidden names? stays? out\./);
  await expect(p.locator('[data-home]')).not.toContainText(home);
  expect(existsSync(join(wiki, '.git')), 'nothing is written while the person reads').toBe(false);
  expect(await h.asked()).toEqual([]);

  // Accept: main asks once, for the files the person read, and the folder gets one commit.
  await offer.getByRole('button', { name: 'Start its history', exact: true }).click();
  await expect(p.locator('[data-notes-done="ready"]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toBe(`Start version history in ~/Documents/old-wiki with ${visible.length} files?`);
  expect(commitCount(wiki)).toBe(1);
  expect(git(wiki, ['status', '--porcelain'])).toBe('');
  expect(git(wiki, ['ls-files']).split('\n').filter(Boolean).sort()).toEqual(visible);
  // Every file is byte for byte as it was, and the hidden ones are still there.
  const bytesAfter = snapshot(wiki);
  expect([...bytesAfter.keys()]).toEqual([...bytesBefore.keys()]);
  for (const [path, bytes] of bytesBefore) expect(bytesAfter.get(path)!.equals(bytes), path).toBe(true);
});

test('link: declining the offer leaves no history and writes nothing', async () => {
  test.setTimeout(180_000);
  home = newHome();
  const wiki = join(home, 'Documents', 'plain-wiki');
  put(wiki, 'index.md', '# Plain wiki\n');
  put(wiki, 'topics/water.md', '# Water\n');
  put(wiki, '.obsidian/app.json', '{}\n');
  const bytesBefore = snapshot(wiki);
  await start('notes');
  const p = page();

  await h.pick(wiki);
  await p.getByRole('button', { name: 'Use my notes', exact: true }).click();
  const offer = p.locator('[data-notes-offer]');
  await expect(offer.locator('[data-history-file]')).toHaveCount(2);
  await offer.getByRole('button', { name: 'No history for now', exact: true }).click();
  const done = p.locator('[data-notes-done="report-only"]');
  await expect(done).toBeVisible();
  await expect(done).toContainText('No history, so the keeper only reports and changes no page.');
  expect(await h.asked(), 'no write was asked').toEqual([]);
  expect(existsSync(join(wiki, '.git')), 'no .git').toBe(false);
  const bytesAfter = snapshot(wiki);
  expect([...bytesAfter.keys()]).toEqual([...bytesBefore.keys()]);
  for (const [path, bytes] of bytesBefore) expect(bytesAfter.get(path)!.equals(bytes), path).toBe(true);
  expect(commitCount(wiki)).toBe(0);
});
