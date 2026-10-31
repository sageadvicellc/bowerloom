/**
 * Journey 5 (spec section 12): "Notes and the wiki keeper", in its two runs, on the made-up home (tools/made-up-home.ts, real git from the machine, no engine and no model).
 *
 * Create: Hanna follows the tour with no wiki. She creates the starter wiki and builds the wiki keeper harness from the kit. She saves it to her interfaces. In one interface, she asks an agent
 * to add a source and to write a refinement report. Each action makes one commit, and the report run changes no page outside the reports folder.
 *   Runs here: the tour, the starter wiki (one commit, the kit's own bytes), the keeper build, the save, the install to Claude Code and Codex.
 *   NEEDS LIVE APPROVAL (a test.fixme below): asking an agent to add a source and to write a report. It needs a live engine session and a model, which this lane must not start. The skills' own
 *   text is checked on disk where it was installed (one commit, a clean tree first), and `tools/test/wiki-keeper-kit.test.mjs` runs the skills' git commands without a model. Neither is the live run.
 * Link: Hanna links a wiki that already has a git history. The dashboard page count matches a count made from the files, and its last-commit date matches `git log`. The test reads both itself.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleOnce } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { GIT, KIT_DIR, NO_GIT_REASON, commitCount, countMarkdown, git, kitSkillIds, kitStarter, lastCommitDay, walkFiles } from './harness-notes-support.js';
import { installSheet, newMadeUpHome, readTree, saveSheet, startApp } from './journey-support.js';
import { removeTempDirs } from './temp-dirs.js';

test.skip(GIT === null, NO_GIT_REASON);

let h: RealHarness;
test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

const tour = (p: Page): Locator => p.getByRole('dialog', { name: 'Tour' });

/** From the first screen to the notes step, the way a person goes: Find my files, Looks right, Yes read them, Set up my notes. */
async function toNotesStep(p: Page): Promise<void> {
  await p.getByRole('button', { name: 'Find my files', exact: true }).click();
  await p.getByRole('button', { name: 'Looks right', exact: true }).click();
  await p.getByRole('button', { name: 'Yes, read them', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: /^Read \d+ sources?\. Make a harness from each\.$/ })).toBeVisible({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Set up my notes', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'Your notes' })).toBeVisible();
}

/** Every file of a folder, hidden names included and `.git` left out: path to bytes. */
const snapshot = (root: string): Map<string, Buffer> => new Map([...walkFiles(root)].filter(([path]) => path !== '.git' && !path.startsWith('.git/')));

test('Journey 5, create: the tour, the starter wiki with one commit, the Notes keeper built from the kit, saved, and installed to Claude Code and Codex', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome(), notes = join(home.home, 'Documents', 'field-notes'), harnessDir = home.rope, def = join(harnessDir, '.bowerloom');
  mkdirSync(notes, { recursive: true });
  const starter = kitStarter(), skills = kitSkillIds();
  expect(starter.size).toBeGreaterThan(3);
  expect(existsSync(join(notes, '.git'))).toBe(false);
  h = await startApp(home, '', { freshTour: true });
  const p = h.page;

  await test.step('5.1 no wiki: the first run leads to "Your notes" after the read', async () => {
    await toNotesStep(p);
    await expect(p.getByRole('button', { name: 'Start fresh', exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Use my notes', exact: true })).toBeVisible();
  });

  await test.step('5.2 create the starter wiki: the step lists every file, nothing is written while she reads, then the folder holds the kit\'s starter bytes and exactly one commit', async () => {
    await h.pick(notes);
    await p.getByRole('button', { name: 'Start fresh', exact: true }).click();
    const step = p.locator('[data-notes-step="starter"]');
    await expect(step).toBeVisible();
    expect(await step.locator('[data-starter-file]').evaluateAll(els => els.map(e => e.getAttribute('data-starter-file')).sort())).toEqual([...starter.keys()].sort());
    await expect(p.locator('[data-home]')).not.toContainText(home.home);
    expect(readdirSync(notes), 'nothing is written while the person reads').toEqual([]);
    await step.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(p.locator('[data-notes-done="created"]')).toBeVisible();
    expect((await h.asked()).at(-1)!.message).toBe(`Write ${starter.size} files into ~/Documents/field-notes and start its history?`);
    const onDisk = snapshot(notes);
    expect([...onDisk.keys()].sort()).toEqual([...starter.keys()].sort());
    for (const [path, bytes] of starter) expect(onDisk.get(path)!.equals(bytes), path).toBe(true);
    expect(existsSync(join(notes, '.git'))).toBe(true);
    expect(commitCount(notes), 'the create makes one commit').toBe(1);
    expect(git(notes, ['status', '--porcelain'])).toBe('');
    expect(git(notes, ['ls-files']).split('\n').filter(Boolean).sort()).toEqual([...starter.keys()].sort());
  });

  await test.step('5.3 follow the tour and build the keeper from the kit: seven steps, and the shelves fill from the kit\'s own skills', async () => {
    await p.getByRole('button', { name: 'Build my Notes keeper', exact: true }).click();
    const s = saveSheet(p);
    await expect(s).toBeVisible();
    await h.pick(harnessDir);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await expect(s.locator('.hxi-card', { hasText: 'rope-yard' })).toHaveAttribute('aria-pressed', 'true');
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    const t = tour(p);
    const steps = [
      'These are your AI agents, from every tool.', 'Your notes are what your agents can read.', 'This agent looks after your notes.', 'Skills are what it knows how to do.',
      'Changes wait here until you press Save.', 'Replay this tour any time.', 'What next? Three ideas for your Notes keeper.',
    ];
    for (let i = 0; i < 3; i++) { await expect(t).toContainText(`Step ${i + 1} of 7`); await expect(t).toContainText(steps[i]!); await t.getByRole('button', { name: 'Next', exact: true }).click(); }
    await expect(t).toContainText('Step 4 of 7');
    await expect(t).toContainText(steps[3]!);
    const tray = s.locator('[data-section="keeper-build"]'), skillsShelf = s.locator('[data-shelf="skills"]'), notesShelf = s.locator('[data-shelf="notes"]');
    await tray.locator('[data-card="add-source"]').dragTo(skillsShelf);
    await expect(skillsShelf.locator('[data-on-shelf="add-source"]')).toBeVisible();
    await s.getByRole('button', { name: 'Add the other skills', exact: true }).click();
    expect(await skillsShelf.locator('[data-on-shelf]').evaluateAll(els => els.map(e => e.getAttribute('data-on-shelf')).sort())).toEqual(skills);
    await tray.locator('[data-kind="notes"]').dragTo(notesShelf);
    await expect(notesShelf.locator('[data-on-shelf]')).toHaveCount(1);
    // The tour moves on by itself when the keeper is built, and the rest of it is Next.
    await expect(t).toContainText('Step 5 of 7');
    await expect(t).toContainText(steps[4]!);
    expect(existsSync(join(def, 'knowledge.json')), 'nothing is written while the person builds').toBe(false);
    for (let i = 4; i < 6; i++) { await t.getByRole('button', { name: 'Next', exact: true }).click(); await expect(t).toContainText(`Step ${i + 2} of 7`); await expect(t).toContainText(steps[i + 1]!); }
    // The last step names the next steps in words, and no command.
    await expect(t).toContainText('Ask the keeper to add a first source.');
    await expect(t).toContainText('Ask the keeper for a tidy-up report.');
    await expect(t).toContainText('Run that report on a schedule with a tool such as n8n.');
    expect(await t.innerText()).not.toMatch(/\bnpm\b|\bnpx\b|\bbowerloom (?:harness|skills)\b|\$ /);
    await t.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(t).toHaveCount(0);
  });

  const source = { kind: '', name: '', path: '' };
  await test.step('5.4 save: the review lists the keeper and the source, and the files on disk are the kit\'s bytes with the source pointing at the notes folder', async () => {
    const s = saveSheet(p);
    await s.getByRole('button', { name: 'Review the save', exact: true }).click();
    const review = s.locator('[data-save-review="save"]');
    await expect(review.locator('[data-file=".bowerloom/knowledge.json"]')).toHaveAttribute('data-action', 'create');
    await expect(review.locator('[data-file=".bowerloom/agents/notes-keeper.md"]')).toHaveAttribute('data-action', 'create');
    await expect(s).not.toContainText(home.home);
    await review.locator('[data-approve-plan] input').check();
    await s.getByRole('button', { name: /^Save \d+ files$/ }).click();
    await expect(s.locator('[data-version-kept]')).toBeVisible();
    const saved = readTree(def);
    const knowledge = JSON.parse(saved['knowledge.json']!) as { sources: { kind: string; name: string; path: string }[] };
    expect(knowledge.sources).toHaveLength(1);
    Object.assign(source, knowledge.sources[0]);
    expect(source.kind).toBe('wiki-folder');
    expect(source.name).toBe('field-notes');
    expect(source.path.startsWith('~/') ? join(home.home, source.path.slice(2)) : resolve(harnessDir, source.path)).toBe(notes);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(saved['agents/notes-keeper.md']!)![1]!;
    expect(front).toMatch(/^notes:\n {2}- field-notes$/m);
    for (const id of skills) {
      expect(front, id).toMatch(new RegExp(`^ {2}- ${id}$`, 'm'));
      for (const [rel, bytes] of walkFiles(join(KIT_DIR, 'skills', id))) expect(saved[`skills/${id}/${rel}`], `${id}/${rel}`).toBe(bytes.toString('utf8'));
    }
    expect(commitCount(notes), 'saving the harness does not touch the wiki').toBe(1);
    expect(git(notes, ['status', '--porcelain'])).toBe('');
  });

  await test.step('5.5 save it to Claude Code and Codex: the written files are the planned files, the kit skills are there byte for byte, and each agent carries the notes section', async () => {
    await saveSheet(p).locator('[data-install-next]').click();
    const install = installSheet(p);
    await install.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(install.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
    await expect(install.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
    await install.getByRole('button', { name: 'Next', exact: true }).click();
    // Codex has no per-tool list, so the keeper's tool limit is a weaker rule the person reads and ticks before the plan.
    const weaker = install.locator('[data-section="approve-lines"]');
    await expect(weaker).toContainText('notes-keeper (tools)');
    for (const box of await weaker.locator('input').all()) await box.check();
    await install.getByRole('button', { name: 'Plan with these approvals', exact: true }).click();
    const planned = (await install.locator('[data-file]').evaluateAll(els => els.map(e => e.getAttribute('data-file') ?? ''))).sort();
    const before = Object.keys(readTree(harnessDir)).filter(f => !f.startsWith('.bowerloom/'));
    expect(before).toEqual([]);
    await install.locator('[data-approve-plan] input').check();
    await install.getByRole('button', { name: /^Write \d+ files$/ }).click();
    await expect(install.locator('[data-done]')).toBeVisible();
    const projected = Object.fromEntries(Object.entries(readTree(harnessDir)).filter(([f]) => !f.startsWith('.bowerloom/')));
    expect(Object.keys(projected).sort(), 'the files on disk are the files in the plan').toEqual(planned);
    for (const id of skills) {
      const kit = readFileSync(join(KIT_DIR, 'skills', id, 'SKILL.md'), 'utf8');
      expect(projected[`.claude/skills/${id}/SKILL.md`], `Claude Code skill ${id}`).toBe(kit);
      expect(projected[`.agents/skills/${id}/SKILL.md`], `Codex skill ${id}`).toBe(kit);
    }
    const notesSection = (text: string): void => {
      expect(text).toContain('## Notes');
      expect(text).toContain(`- ${source.name}: `);
      expect(text).toContain(`\`${source.path}\``);
      expect(text).toContain(`\`${source.path}/AGENTS.md\``);
    };
    notesSection(projected['.claude/agents/notes-keeper.md']!);
    notesSection(projected['.codex/agents/notes-keeper.toml']!);
    expect(projected['.claude/agents/foreman.md'], 'an agent that does not list the notes has no section').not.toContain('## Notes');
    // The installed skills say what the live run must do. This is the text on disk, not a run.
    for (const id of ['add-source', 'refine-report']) {
      expect(projected[`.claude/skills/${id}/SKILL.md`]).toMatch(/one commit/i);
      expect(projected[`.claude/skills/${id}/SKILL.md`]).toMatch(/working tree of the wiki is not empty/);
    }
    expect(projected['.claude/skills/refine-report/SKILL.md']).toContain('reports/YYYY-MM-DD-refine.md');
    expect(commitCount(notes), 'the install does not touch the wiki').toBe(1);
  });
});

test.fixme('Journey 5, create, step 5.6: in one interface, ask an agent to add a source and to write a refinement report; each makes one commit, and the report changes no page outside reports/ (NEEDS LIVE APPROVAL: it needs a live engine session and a model)', () => {
  // Not run by this lane: it starts no model and no engine session. After the owner approves the live check, the test is: open Claude Code (or Codex) in the project, ask the Notes keeper to add a
  // source, then to write the report, and read the wiki's own git: two commits more than before, and `git diff --name-only HEAD~1 HEAD` of the report commit lists only `reports/<date>-refine.md`.
});

test('Journey 5, link: a wiki with a git history is linked; the dashboard page count matches a count from the files, the last-commit date matches git log, and nothing in the wiki changes', async () => {
  test.setTimeout(240_000);
  const home = newMadeUpHome({ history: true }), wiki = home.wiki, harnessDir = home.rope;
  const filesBefore = snapshot(wiki), headBefore = git(wiki, ['rev-parse', 'HEAD']).trim(), commitsBefore = commitCount(wiki);
  expect(commitsBefore).toBe(3);
  const pages = countMarkdown(wiki);                  // the test's own walk of the files: every *.md outside hidden folders
  const day = lastCommitDay(wiki);                    // the test's own `git log`, UTC day
  expect(pages).toBe(7);
  h = await startApp(home, '', { freshTour: true });
  const p = h.page;

  await test.step('5.7 link her own wiki: it already has a history, so no offer is made and nothing is asked or written', async () => {
    await toNotesStep(p);
    await h.pick(wiki);
    await p.getByRole('button', { name: 'Use my notes', exact: true }).click();
    await expect(p.locator('[data-notes-done="ready"]')).toBeVisible();
    await expect(p.locator('[data-notes-offer]')).toHaveCount(0);
    expect(await h.asked(), 'no write was asked').toEqual([]);
  });

  await test.step('5.8 the dashboard: page count from file names, last-commit date, the path only behind Show details', async () => {
    await p.getByRole('button', { name: 'Build my Notes keeper', exact: true }).click();
    const s = saveSheet(p);
    await h.pick(harnessDir);
    await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
    await s.getByRole('button', { name: 'Next', exact: true }).click();
    await tour(p).getByRole('button', { name: 'Skip tour', exact: true }).click();
    const card = s.locator('[data-section="notes"] [data-card]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('tide-notes');
    await expect(card.locator('[data-pages]')).toHaveText(`${pages} pages`);
    await expect(card.locator('[data-last-change]')).toHaveText(`Last change ${day}`);
    await expect(card.locator('[data-last-change]')).toHaveText(`Last change ${git(wiki, ['log', '-1', '--format=%cs']).trim()}`);
    await expect(s).toContainText('More kinds of notes are coming.');
    await expect(s).not.toContainText(home.home);
    await card.getByRole('button', { name: 'Show details' }).click();
    await expect(card).toContainText('~/Documents/tide-notes');
  });

  await test.step('5.9 linking and reading the dashboard changed nothing in the wiki', async () => {
    expect(git(wiki, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    expect(commitCount(wiki)).toBe(commitsBefore);
    expect(git(wiki, ['status', '--porcelain'])).toBe('');
    const after = snapshot(wiki);
    expect([...after.keys()]).toEqual([...filesBefore.keys()]);
    for (const [path, bytes] of filesBefore) expect(after.get(path)!.equals(bytes), path).toBe(true);
  });
});
