/**
 * Shared set-up for the notes specs (journey 5). Every expected value is read here from files and from the version history by the test itself: the kit's own
 * files on disk, a walk of the notes folder, and the test's own history tool run with a scrubbed environment. Nothing is taken from the app's code or its answers.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { desktop } from './harness-page.js';

/** The shipped kit, read straight from the repository's `kits/` folder. */
export const KIT_DIR = join(desktop, '..', '..', 'kits', 'wiki-keeper');

/** Every file under a folder: relative path (with `/`) to its bytes, in path order. Hidden folders are walked too unless `skipHidden` is set. */
export function walkFiles(root: string, { skipHidden = false }: { skipHidden?: boolean } = {}): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (!(skipHidden && entry.name.startsWith('.'))) walk(r); } else if (entry.isFile()) out.set(r, readFileSync(join(root, r)));
    }
  };
  if (existsSync(root)) walk('');
  return out;
}

/** The names of the kit's skill folders, read from disk. */
export function kitSkillIds(): string[] { return readdirSync(join(KIT_DIR, 'skills')).filter(n => lstatSync(join(KIT_DIR, 'skills', n)).isDirectory()).sort(); }
/** The kit's starter wiki files, read from disk. */
export function kitStarter(): Map<string, Buffer> { return walkFiles(join(KIT_DIR, 'starter')); }

/** The count of `*.md` files under a folder by the test's own walk, hidden folders left out. */
export function countMarkdown(root: string): number { return [...walkFiles(root, { skipHidden: true }).keys()].filter(p => p.endsWith('.md')).length; }

// ---- the test's own history tool ---------------------------------------------------------------------------------------------

/** Where a plain copy is looked for by the test itself: the macOS developer tools, then the usual Linux places. Never the macOS installer shim. */
const TOOL_PLACES = ['/Library/Developer/CommandLineTools/usr/bin/git', '/Applications/Xcode.app/Contents/Developer/usr/bin/git', '/usr/bin/git', '/bin/git'];
/** A copy the app will find as well, or null. On macOS `/usr/bin/git` is an installer shim and never counts. */
export function ownGit(): string | null {
  for (const p of TOOL_PLACES) {
    if (process.platform === 'darwin' && p === '/usr/bin/git') continue;
    if (existsSync(p)) return p;
  }
  return null;
}
export const GIT = ownGit();
export const NO_GIT_REASON = 'Git is not installed where Bowerloom looks for it, so the history steps cannot run on this computer.';

/** Runs the test's own git in a folder with a scrubbed environment (no user or system configuration, no prompt, and no variable of the caller). */
export function git(dir: string, args: readonly string[], extraEnv: Record<string, string> = {}): string {
  if (GIT === null) throw new Error(NO_GIT_REASON);
  const r = spawnSync(GIT, ['-C', dir, ...args], {
    encoding: 'utf8', shell: false,
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extraEnv },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
/** The number of commits on the current branch, or 0 when there is no commit (or no repository). */
export function commitCount(dir: string): number {
  try { return Number(git(dir, ['rev-list', '--count', 'HEAD']).trim()); } catch { return 0; }
}
/** The day (UTC, YYYY-MM-DD) of the last commit, from the test's own `git log`. */
export function lastCommitDay(dir: string): string { return new Date(Number(git(dir, ['log', '-1', '--format=%ct']).trim()) * 1000).toISOString().slice(0, 10); }
/** Commits everything in a folder as the test, on a given day (UTC noon), so the day is not today's. */
export function commitAll(dir: string, message: string, day: string): void {
  const when = `${day}T12:00:00Z`;
  const who = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  git(dir, ['add', '-A'], who);
  git(dir, ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', message], who);
}

// ---- the keyboard ------------------------------------------------------------------------------------------------------------

/** Presses Tab until the control has the focus, then returns. Fails with the name of the control when it is not reached in `limit` presses. */
export async function tabTo(page: Page, control: Locator, limit = 150): Promise<void> {
  const visited: string[] = [];
  const here = (): Promise<string> => page.evaluate(() => { const a = document.activeElement; return a === null ? 'nothing' : `${a.tagName.toLowerCase()} ${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 40)}`; });
  for (let i = 0; i < limit; i++) {
    if (await control.evaluate(el => el === document.activeElement).catch(() => false)) return;
    visited.push(await here());
    await page.keyboard.press('Tab');
  }
  if (!(await control.evaluate(el => el === document.activeElement).catch(() => false))) throw new Error(`The keyboard did not reach the control in ${limit} presses. It visited: ${[...new Set(visited)].join(' | ')}`);
}
/** Reaches a control with Tab and presses Enter on it. */
export async function keyPress(page: Page, control: Locator): Promise<void> {
  await tabTo(page, control);
  await page.keyboard.press('Enter');
}
