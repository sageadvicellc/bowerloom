/**
 * The Builder on a real folder (Electron started with --prototype-v3-real, HOME and XDG_STATE_HOME pointed at a made-up folder). The main process runs the
 * packages: open the folder in the Builder from the folder list, drag the skill `outline` onto the agent `reader` with real pointer events, save through the
 * save sheet's review, install to Claude Code and Codex, close the app, start it again on the same home, open the folder again, go back to the "as it was"
 * save point from the Builder's Save points drawer, and compare the definition bytes with the bytes before the edit.
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

/** Starts the app on the made-up home, on the Harness list. A second start with the same home is a restart: the state folder under it stays. */
async function start(): Promise<void> {
  h = await launchReal(home, { XDG_STATE_HOME: join(home, '.local', 'state') }, false);
  await page().emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page().evaluate(() => { location.hash = '#prototype-v3-real/harnesses'; location.reload(); });
  await page().waitForLoadState('domcontentloaded');
  await page().waitForSelector('[data-home]');
}

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

/** Chooses the folder in the folder list with main's own chooser, and opens it in the Builder. */
async function openInBuilder(p: Page, dir: string): Promise<void> {
  const folders = p.locator('[data-section="folders"]');
  await h.pick(dir);
  await folders.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await folders.getByRole('button', { name: 'Open team in the builder', exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name: 'team' })).toBeVisible();
  await expect(node(p, 'agent:reader')).toBeVisible();
}
const node = (p: Page, id: string): Locator => p.locator(`.hx-node[data-node="${id}"]`);

test('the Builder on a real folder: drag a skill onto an agent, save, install to Claude Code and Codex, restart, go back, and the definition is byte for byte as it was', async () => {
  test.setTimeout(180_000);
  home = realpathSync(tempDir('bowerloom-builder-home-'));
  chmodSync(home, 0o700);
  const dir = teamFolder(home), def = join(dir, '.bowerloom');
  const original = readTree(def);
  expect(original['agents/reader.md']).not.toContain('outline');
  await start();
  const p = page();

  // 1. Open the folder in the Builder.
  await openInBuilder(p, dir);
  await expect(p.locator('[data-draft]')).toContainText('No change yet.');
  await expect(p.locator('main')).not.toContainText(home);

  // 2. Drag the skill `outline` onto the agent `reader`, with real pointer events.
  const skill = (await node(p, 'skill:outline').boundingBox())!, agent = (await node(p, 'agent:reader').boundingBox())!;
  await p.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await p.mouse.down();
  await p.mouse.move(skill.x + skill.width / 2 - 10, skill.y + skill.height / 2 + 4, { steps: 4 });
  await p.mouse.move(agent.x + agent.width / 2, agent.y + agent.height / 2, { steps: 12 });
  await p.mouse.up();
  await expect(p.locator('[data-draft]')).toContainText('1 change, not saved yet.');
  await expect(p.locator('[data-agent="reader"]').getByRole('checkbox', { name: 'outline: reader' })).toBeChecked();
  expect(readTree(def), 'a draft writes nothing').toEqual(original);

  // 3. Save: the save sheet opens on its review step with the Builder's draft. Then install to Claude Code and Codex.
  await p.locator('[data-builder-save]').click();
  const s = p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
  const review = s.locator('[data-save-review="save"]');
  await expect(review.locator('[data-file]')).toHaveCount(1);
  await expect(review.locator('[data-file=".bowerloom/agents/reader.md"]')).toHaveAttribute('data-action', 'update');
  await expect(s).not.toContainText(home);
  expect(readTree(def), 'nothing is written while the person reads').toEqual(original);
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: 'Save 1 file', exact: true }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toMatch(/^Change 1 file in ~\/Projects\/team\/\.bowerloom\?$/);

  // 4. The bytes, read by the test: the agent file lists the skill, every other file is as it was, and the package loads the definition.
  const saved = readTree(def);
  expect(saved['agents/reader.md']).toMatch(/^skills:\n {2}- outline$/m);
  expect(Object.keys(saved)).toEqual(Object.keys(original));
  for (const [path, text] of Object.entries(original)) if (path !== 'agents/reader.md') expect(saved[path], path).toBe(text);
  const loaded = loadDefinition(def);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.definition.entries.subagents.find(a => a.id === 'reader')?.skills).toEqual(['outline']);
  expect(loaded.definition.entries.subagents.find(a => a.id === 'writer')?.skills).toEqual(['review']);

  await s.locator('[data-install-next]').click();
  const install = p.getByRole('dialog', { name: 'Install a folder\'s harness' });
  await expect(install).toBeVisible();
  await install.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(install.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
  await expect(install.getByRole('checkbox', { name: 'Codex' })).toBeChecked();
  await install.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(install.locator('[data-approve-plan] input')).toBeVisible();
  expect(Object.keys(filesOf(dir)).filter(f => !f.startsWith('.bowerloom/')), 'nothing is projected while the person reads').toEqual([]);
  await install.locator('[data-approve-plan] input').check();
  await install.getByRole('button', { name: /^Write \d+ files$/ }).click();
  await expect(install.locator('[data-done]')).toBeVisible();
  expect((await h.asked()).at(-1)!.message).toMatch(/^Write \d+ files in ~\/Projects\/team\?$/);
  const projected = readTree(dir);
  expect(projected['.claude/agents/reader.md']).toMatch(/^skills: \["outline"\]$/m);
  expect(projected['.claude/agents/writer.md']).toMatch(/^skills: \["review"\]$/m);
  for (const id of ['outline', 'review']) {
    expect(projected[`.claude/skills/${id}/SKILL.md`], `.claude/skills/${id}`).toBe(saved[`skills/${id}/SKILL.md`]);
    expect(projected[`.agents/skills/${id}/SKILL.md`], `.agents/skills/${id}`).toBe(saved[`skills/${id}/SKILL.md`]);
  }
  expect(projected['.codex/agents/reader.toml']).toContain('name = "reader"');
  const afterInstall = filesOf(dir);

  // 5. Close the app and start it again on the same home. The folder id of the last start is not known: the Builder goes back to the folder list.
  await h.app.close();
  await start();
  const q = page();
  await q.evaluate(() => { location.hash = '#prototype-v3-real/builder/folder-1'; });
  await expect(q.getByRole('heading', { level: 1, name: 'Harnesses', exact: true })).toBeVisible();

  // 6. Open the folder again, and go back to the save point kept as it was before the first save.
  await openInBuilder(q, dir);
  await expect(q.locator('[data-agent="reader"]').getByRole('checkbox', { name: 'outline: reader' })).toBeChecked();
  await q.getByRole('button', { name: 'Save points', exact: true }).click();
  const drawer = q.getByRole('dialog', { name: 'Save points' });
  await expect(drawer.locator('[data-version]')).toHaveCount(2);
  const asItWas = drawer.locator('[data-version]', { hasText: /as it was/i });
  await expect(asItWas).toHaveCount(1);
  const id = (await asItWas.getAttribute('data-version'))!;
  await asItWas.getByRole('button', { name: `Go back to ${id}`, exact: true }).click();
  const t = q.getByRole('dialog', { name: 'Edit a folder\'s harness' });
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
  const again = loadDefinition(def);
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(again.definition.entries.subagents.find(a => a.id === 'reader')?.skills ?? []).toEqual([]);
  const rest = (files: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(files).filter(([f]) => !f.startsWith('.bowerloom/')));
  expect(rest(filesOf(dir))).toEqual(rest(afterInstall));
  // The Builder reads the folder again once the sheet closes: the link is gone.
  await t.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(q.locator('[data-agent="reader"]').getByRole('checkbox', { name: 'outline: reader' })).not.toBeChecked();
  await expect(q.locator('[data-draft]')).toContainText('No change yet.');
});
