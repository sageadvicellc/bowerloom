/**
 * Shared set-up for the harness-first preview on the person's own folders (Electron started with no flag and HOME pointed at a made-up folder). Nothing of the person's own folders
 * is read: the launched app sees only the folder it is given. The system folder chooser cannot be driven from a test, so the main process gets one that answers with the folder set by `pick`.
 * The specs run one at a time on this machine: take the lock before a run (`until mkdir /tmp/bowerloom-test.lock 2>/dev/null; do sleep 5; done`) and release it after.
 */
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TOUR_SEEN_KEY } from '../renderer/harness/tour/seen.js';
import { desktop } from './harness-page.js';
import { tempDir } from './temp-dirs.js';

export interface RealHarness {
  app: ElectronApplication; page: Page; pick(folder: string | null): Promise<void>; dialogs: string[];
  /** The answer main's write question gets (true: Write), and the questions main asked. */
  confirm(yes: boolean): Promise<void>;
  asked(): Promise<{ message: string; detail: string }[]>;
  /** The paths main passed to its file opener (`shell.openPath`, stubbed: it opens nothing), in order. */
  opened(): Promise<string[]>;
}

/** Builds the bundle fresh from the source in this folder. `launchReal` does it first, unless a spec that starts one app per test did it once already. */
export function bundleOnce(): void {
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'main.mjs'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
}

/**
 * Starts the app with no flag on the given HOME (and any other variable given, such as XDG_STATE_HOME) and waits for the first window. It builds
 * the bundle first unless `bundle` is false. The guided tour starts on its own at first use; a spec that is not about it starts with the tour seen, in the
 * window's session store, unless `freshTour` is true.
 */
export async function launchReal(home: string, env: Record<string, string> = {}, bundle = true, { freshTour = false }: { freshTour?: boolean } = {}): Promise<RealHarness> {
  if (bundle) bundleOnce();
  const userData = tempDir('bowerloom-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, `--user-data-dir=${userData}`], env: { ...process.env, HOME: home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env } });
  await app.evaluate(({ dialog }) => {
    (globalThis as unknown as { __pick: string | null }).__pick = null;
    dialog.showOpenDialog = (async () => { const pick = (globalThis as unknown as { __pick: string | null }).__pick; return pick === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [pick] }; }) as unknown as typeof dialog.showOpenDialog;
    // Main's own question before a write (U16): the test answers it (1 is "Write", 0 is "Cancel") and keeps each question main asked.
    const g = globalThis as unknown as { __answer: number; __asked: { message: string; detail: string }[] };
    g.__answer = 1; g.__asked = [];
    dialog.showMessageBox = (async (...args: unknown[]) => { const o = (args.length > 1 ? args[1] : args[0]) as { message: string; detail: string }; g.__asked.push({ message: o.message, detail: o.detail }); return { response: g.__answer, checkboxChecked: false }; }) as unknown as typeof dialog.showMessageBox;
  });
  // Main's file opener: the test keeps each path main passed and opens nothing.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] };
    g.__opened = [];
    shell.openPath = (async (path: string) => { g.__opened.push(path); return ''; }) as typeof shell.openPath;
  });
  const page = await app.firstWindow();
  const dialogs: string[] = [];
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
  if (!freshTour) await page.evaluate(key => sessionStorage.setItem(key, '1'), TOUR_SEEN_KEY);
  return {
    app, page, dialogs, pick: folder => app.evaluate((_e, f) => { (globalThis as unknown as { __pick: string | null }).__pick = f; }, folder),
    opened: () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened),
    confirm: yes => app.evaluate((_e, y) => { (globalThis as unknown as { __answer: number }).__answer = y ? 1 : 0; }, yes),
    asked: () => app.evaluate(() => (globalThis as unknown as { __asked: { message: string; detail: string }[] }).__asked),
  };
}
