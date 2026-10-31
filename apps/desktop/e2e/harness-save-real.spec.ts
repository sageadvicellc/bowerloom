/**
 * Journey 2 of the save step, on a real folder (Electron started with --prototype-v3-real, HOME and XDG_STATE_HOME pointed at a made-up folder). The main
 * process runs the packages: open a folder that holds a harness definition, link a skill to an agent, save, install to Claude Code and Codex, close the app,
 * start it again on the same home, go back to the "as it was" save point, and compare the definition bytes with the bytes before the edit.
 * Every expected value below is read from the files by this test, never from the app's code or its answers.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { filesOf, teamFolder } from '../tests/helpers-engine/folders.js';
import { bundleOnce, launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { removeTempDirs, tempDir } from './proto-temp.js';

let h: RealHarness, home: string;
const page = (): Page => h.page;

test.beforeAll(() => { test.setTimeout(240_000); bundleOnce(); });
test.afterAll(() => { removeTempDirs(); });
test.afterEach(async () => { await h?.app.close().catch(() => undefined); });

/** Starts the app on the made-up home, on the Projects page. A second start with the same home is a restart: the state folder under it stays. */
async function start(): Promise<void> {
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(() => { location.hash = '#prototype-v3-real/projects'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
}

const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });

/** Every file under a folder, relative path to its text, read by the test itself. */
function readTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(r); else out[r] = readFileSync(join(root, r), 'utf8');
    }
  };
  if (existsSync(root)) walk('');
  return out;
}

test('Journey 2: link a skill to an agent and save, install to Claude Code and Codex, restart, go back, and the definition is byte for byte as it was', async () => {
  test.setTimeout(180_000);
  home = realpathSync(tempDir('bowerloom-save-home-'));
  chmodSync(home, 0o700);
  const dir = teamFolder(home), def = join(dir, '.bowerloom');
  const original = readTree(def);
  expect(original['agents/reader.md']).not.toContain('outline');
  await start();
  const p = page();

  // 1. Open the folder, link the skill `outline` to the agent `reader`, and save.
  await p.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  const s = saveSheet(p);
  await h.pick(dir);
  await s.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(s.locator('.hxi-card', { hasText: 'team' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Next', exact: true }).click();
  const link = s.locator('[data-agent="reader"]').getByRole('checkbox', { name: 'outline: reader' });
  await expect(link).not.toBeChecked();
  await link.check();
  await s.getByRole('button', { name: 'Review the save', exact: true }).click();
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file]')).toHaveCount(1);
  await expect(review.locator('[data-file=".bowerloom/agents/reader.md"]')).toHaveAttribute('data-action', 'update');
  await expect(s).not.toContainText(home);
  expect(readTree(def), 'nothing is written while the person reads').toEqual(original);
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Save 1 file', exact: true }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();

  // 2. The agent file on disk lists the skill, the other files are as they were, and the package loads the definition.
  const saved = readTree(def);
  expect(saved['agents/reader.md']).toMatch(/^skills:\n {2}- outline$/m);
  expect(Object.keys(saved)).toEqual(Object.keys(original));
  for (const [path, text] of Object.entries(original)) if (path !== 'agents/reader.md') expect(saved[path], path).toBe(text);
  const loaded = loadDefinition(def);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const agents = loaded.definition.entries.subagents;
  expect(agents.find(a => a.id === 'reader')?.skills).toEqual(['outline']);
  expect(agents.find(a => a.id === 'writer')?.skills).toEqual(['review']);
  expect((await h.asked()).at(-1)!.message).toMatch(/^Change 1 file in ~\/Projects\/team\/\.bowerloom\?$/);

  // 3. Install it, to Claude Code and Codex.
  await s.locator('[data-install-next]').click();
  const install = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(install).toBeVisible();
  await install.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(install.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
  await expect(install.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
  await install.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(install.locator('[data-approve-plan] input')).toBeVisible();
  const beforeInstall = filesOf(dir);
  expect(Object.keys(beforeInstall).filter(f => !f.startsWith('.bowerloom/')), 'nothing is projected while the person reads').toEqual([]);
  await install.locator('[data-approve-plan] input').check();
  await install.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(install.locator('[data-done]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toMatch(/^Write 9 files in ~\/Projects\/team\?$/);

  // 4. The projected files carry the skill. Claude Code lists it in the agent file; Codex has no skill list per agent, so it carries the skill file itself.
  const projected = readTree(dir);
  expect(projected['.claude/agents/reader.md']).toMatch(/^skills: \["outline"\]$/m);
  expect(projected['.claude/agents/writer.md']).toMatch(/^skills: \["review"\]$/m);
  for (const id of ['outline', 'review']) {
    const source = saved[`skills/${id}/SKILL.md`];
    expect(projected[`.claude/skills/${id}/SKILL.md`], `.claude/skills/${id}`).toBe(source);
    expect(projected[`.agents/skills/${id}/SKILL.md`], `.agents/skills/${id}`).toBe(source);
  }
  expect(projected['.codex/agents/reader.toml']).toContain('name = "reader"');
  expect(Object.keys(projected).filter(f => f.startsWith('.bowerloom/')).sort()).toEqual(Object.keys(saved).map(f => `.bowerloom/${f}`).sort());
  const afterInstall = filesOf(dir);

  // 5. Close the app and start it again on the same home.
  await h.app.close();
  await start();
  const q = page();

  // 6. The save points are still there. Go back to the one kept as it was before the first save.
  await q.getByRole('button', { name: 'Edit from a folder', exact: true }).click();
  const t = saveSheet(q);
  await h.pick(dir);
  await t.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await expect(t.locator('.hxi-card', { hasText: 'team' })).toHaveAttribute('aria-pressed', 'true');
  await t.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(t.locator('[data-agent="reader"]').getByRole('checkbox', { name: 'outline: reader' })).toBeChecked();
  const points = t.locator('[data-section="save-points"]');
  await expect(points.locator('[data-version]')).toHaveCount(2);
  const asItWas = points.locator('[data-version]', { hasText: /as it was/i });
  await expect(asItWas).toHaveCount(1);
  const id = (await asItWas.getAttribute('data-version'))!;
  await expect(asItWas).not.toHaveAttribute('data-current', '');
  await asItWas.getByRole('button', { name: `Go back to ${id}`, exact: true }).click();
  const back = t.locator('[data-save-review="restore"]');
  await expect(back.locator('[data-file]')).toHaveCount(1);
  await expect(back.locator('[data-file=".bowerloom/agents/reader.md"]')).toHaveAttribute('data-action', 'update');
  expect(readTree(def), 'nothing is written while the person reads').toEqual(saved);
  await back.locator('[data-approve-plan] input').check();
  await t.getByRole('button', { name: `Go back to ${id}`, exact: true }).click();
  await expect(t.locator('[data-version-kept]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toContain(id);

  // 7. The definition is byte for byte as it was before the edit; the files projected earlier are not touched by a go-back.
  expect(readTree(def)).toEqual(original);
  const loadedAgain = loadDefinition(def);
  expect(loadedAgain.ok).toBe(true);
  if (!loadedAgain.ok) return;
  expect(loadedAgain.definition.entries.subagents.find(a => a.id === 'reader')?.skills ?? []).toEqual([]);
  expect(loadedAgain.definition.entries.subagents.find(a => a.id === 'writer')?.skills).toEqual(['review']);
  const rest = (files: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(files).filter(([f]) => !f.startsWith('.bowerloom/')));
  expect(rest(filesOf(dir))).toEqual(rest(afterInstall));
});
