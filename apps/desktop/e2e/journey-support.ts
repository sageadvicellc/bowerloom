/**
 * Shared set-up for the acceptance journeys (spec section 12, pass 1). Each journey runs on the default launch, with HOME pointed at a made-up home that
 * tools/made-up-home.ts builds in a temporary folder, hidden (e2e/hidden.ts). The app is driven as a person drives it: buttons, ticks and the pointer. The test uses no terminal,
 * opens no folder window and edits no settings file inside a journey. Only the native dialogs are stubbed (the folder chooser, main's own question, the file opener), as in
 * every real spec. Every expected value is read by the test from the files, never from the app's code or its answers.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildMadeUpHome } from '../tools/made-up-home.js';
import type { MadeUpHome } from '../tools/made-up-home.js';
import { GIT } from './harness-notes-support.js';
import { launchReal } from './harness-real-page.js';
import type { RealHarness } from './harness-real-page.js';
import { tempDir } from './temp-dirs.js';

/** A new made-up home in its own temporary folder (removed by `removeTempDirs`). With `history`, the wiki folder has a git history; that needs a plain git program. */
export function newMadeUpHome({ history = false }: { history?: boolean } = {}): MadeUpHome {
  if (history && GIT === null) throw new Error('A git program is needed for the wiki history, and none is installed where Bowerloom looks.');
  return buildMadeUpHome(tempDir('bowerloom-journey-'), { git: history ? GIT : null });
}

/**
 * Starts the app on the made-up home and opens a route of the real launch. A second start with the same home is a restart: the state folder under it stays.
 * The guided tour is marked as seen unless `freshTour` is set.
 */
export async function startApp(home: MadeUpHome, route: string, { freshTour = false }: { freshTour?: boolean } = {}): Promise<RealHarness> {
  const h = await launchReal(home.home, { XDG_STATE_HOME: join(home.home, '.local', 'state') }, false, { freshTour });
  await h.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await h.page.waitForLoadState('load');
  await h.page.evaluate(r => { location.hash = `#app/${r}`; location.reload(); }, route);
  await h.page.waitForLoadState('domcontentloaded');
  await h.page.waitForSelector('[data-home]');
  return h;
}

/** Every file under a folder, relative path to text, read by the test itself. Hidden names are walked too. A missing folder is empty. It records file contents only: for folders and modes, use `treeShape`. */
export function readTree(root: string, { skip = [] as string[] } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (skip.includes(entry.name)) continue;
      if (entry.isDirectory()) walk(r); else out[r] = readFileSync(join(root, r), 'utf8');
    }
  };
  if (existsSync(root)) walk('');
  return out;
}
/** Every folder (with a trailing slash) and every file under a root, each with its mode, so an empty folder or a changed mode left behind shows. A missing root is empty. */
export function treeShape(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const mode = (lstatSync(join(root, r)).mode & 0o777).toString(8);
      if (entry.isDirectory()) { out.push(`${r}/ ${mode}`); walk(r); } else out.push(`${r} ${mode}`);
    }
  };
  if (existsSync(root)) walk('');
  return out;
}
/** The tree without the files under a prefix, such as `.bowerloom/`. */
export const without = (tree: Record<string, string>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(tree).filter(([path]) => !path.startsWith(prefix)));
export const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** The sheets, by their names. */
export const saveSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Edit a folder\'s harness' });
export const installSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Install a folder\'s harness' });
export const adoptSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'New harness from a folder' });
export const node = (p: Page, id: string): Locator => p.locator(`.hx-node[data-node="${id}"]`);

/** Chooses the folder in the folder list with main's own chooser, and opens it in the Builder. `name` is the folder's last name. */
export async function openInBuilder(h: RealHarness, dir: string, name: string): Promise<void> {
  const p = h.page, folders = p.locator('[data-section="folders"]');
  await h.pick(dir);
  await folders.getByRole('button', { name: 'Choose a folder', exact: true }).click();
  await folders.getByRole('button', { name: `Open ${name} in the builder`, exact: true }).click();
  await expect(p.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Drags the skill node onto the agent node with real pointer events, as a person does. */
export async function dragSkillToAgent(p: Page, skillId: string, agentId: string): Promise<void> {
  // Wait until both nodes have stopped moving: the same box on 10 reads in a row.
  const boxes = async (): Promise<string> => JSON.stringify([await node(p, `skill:${skillId}`).boundingBox(), await node(p, `agent:${agentId}`).boundingBox()]);
  let last = '', same = 0;
  await expect.poll(async () => { const now = await boxes(); same = now === last ? same + 1 : 0; last = now; return same; }, { intervals: [50], timeout: 15_000 }).toBeGreaterThanOrEqual(10);
  const skill = (await node(p, `skill:${skillId}`).boundingBox())!, agent = (await node(p, `agent:${agentId}`).boundingBox())!;
  await p.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await p.mouse.down();
  await p.mouse.move(skill.x + skill.width / 2 - 10, skill.y + skill.height / 2 + 4, { steps: 4 });
  await p.mouse.move(agent.x + agent.width / 2, agent.y + agent.height / 2, { steps: 12 });
  await p.mouse.up();
}

/** Joins a skill to an agent the second way the Builder offers: press the agent, press its circle, then press the skill. */
export async function linkSkillToAgent(p: Page, skillId: string, agentId: string): Promise<void> {
  await node(p, `agent:${agentId}`).click();
  await node(p, `agent:${agentId}`).getByRole('button', { name: 'Link from this agent', exact: true }).click();
  await expect(p.locator('.hx-linkbar')).toBeVisible();
  await node(p, `skill:${skillId}`).click();
}

/** Reviews, approves and writes the save the Builder holds. Returns the paths the review listed, with their actions. */
export async function saveFromBuilder(h: RealHarness): Promise<Record<string, string>> {
  const p = h.page;
  await p.locator('[data-builder-save]').click();
  const s = saveSheet(p), review = s.locator('[data-save-review="save"]');
  await expect(review).toBeVisible();
  const listed = await review.locator('[data-file]').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('data-file') ?? '', e.getAttribute('data-action') ?? ''])));
  await review.locator('[data-approve-plan] input').check();
  await s.getByRole('button', { name: /^Save \d+ files?$/ }).click();
  await expect(s.locator('[data-version-kept]')).toBeVisible();
  return listed;
}

/**
 * Main's save dialog, answered by the test (the system dialog cannot be driven). `saveAt(h, path)` sets the path it answers; `saveAt(h, null)` closes it. The dialog the
 * Export sheet opens is the only one stubbed, and main's own write question stays the one `launchReal` records.
 */
export async function stubSaveDialog(h: RealHarness): Promise<void> {
  await h.app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __save: string | null };
    g.__save = null;
    dialog.showSaveDialog = (async () => (g.__save === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: g.__save })) as unknown as typeof dialog.showSaveDialog;
  });
}
export const saveAt = (h: RealHarness, path: string | null): Promise<void> => h.app.evaluate((_e, p) => { (globalThis as unknown as { __save: string | null }).__save = p; }, path);

/** Starts a second app on a second made-up computer: its own HOME, state folder and data folder. The save dialog is stubbed. The caller closes it. */
export async function startSecondApp(route = 'harnesses'): Promise<{ home: MadeUpHome; h: RealHarness }> {
  const home = newMadeUpHome();
  const h = await startApp(home, route);
  try { await stubSaveDialog(h); } catch (error) { await h.app.close().catch(() => undefined); throw error; }
  return { home, h };
}

/** The sheets of journey 4, by their names. */
export const exportSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Export a harness' });
export const importSheet = (p: Page): Locator => p.getByRole('dialog', { name: 'Import a harness' });
