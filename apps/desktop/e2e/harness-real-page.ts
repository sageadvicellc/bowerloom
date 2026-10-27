/**
 * Shared set-up for the harness-first preview on the person's own folders (Electron started with --prototype-v3-real and HOME pointed at a made-up folder). Nothing of the person's own folders
 * is read: the launched app sees only the folder it is given. The system folder chooser cannot be driven from a test, so the main process gets one that answers with the folder set by `pick`.
 * The specs run one at a time on this machine: take the lock before a run (`until mkdir /tmp/bowerloom-test.lock 2>/dev/null; do sleep 5; done`) and release it after.
 */
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import electronPath from 'electron';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { desktop } from './harness-page.js';
import { tempDir } from './proto-temp.js';

export interface RealHarness { app: ElectronApplication; page: Page; pick(folder: string | null): Promise<void>; dialogs: string[] }

/** Builds the bundle fresh from the source in this folder, starts the app with --prototype-v3-real on the given HOME and waits for the first window. */
export async function launchReal(home: string): Promise<RealHarness> {
  const built = spawnSync(process.execPath, [join(desktop, 'tools', 'bundle.mjs')], { cwd: desktop, encoding: 'utf8' });
  if (built.status !== 0 || !existsSync(join(desktop, 'dist', 'main.mjs'))) throw new Error(`The bundle did not build.\n${built.stdout}\n${built.stderr}`);
  const userData = tempDir('bowerloom-prototype-e2e-');
  const app = await electron.launch({ executablePath: electronPath as unknown as string, args: [desktop, '--prototype-v3-real', `--user-data-dir=${userData}`], env: { ...process.env, HOME: home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  await app.evaluate(({ dialog }) => {
    (globalThis as unknown as { __pick: string | null }).__pick = null;
    dialog.showOpenDialog = (async () => { const pick = (globalThis as unknown as { __pick: string | null }).__pick; return pick === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [pick] }; }) as unknown as typeof dialog.showOpenDialog;
  });
  const page = await app.firstWindow();
  const dialogs: string[] = [];
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-home]');
  return { app, page, dialogs, pick: folder => app.evaluate((_e, f) => { (globalThis as unknown as { __pick: string | null }).__pick = f; }, folder) };
}
