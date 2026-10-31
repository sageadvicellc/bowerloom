/**
 * The parts of e2e/packaged-app.spec.ts that need no browser and no build, so tests/packaged-support.test.ts can hold them: which files make a build stale, how long the spec
 * waits for the app to end, and what counts as a clean end.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The newest change time, in milliseconds, of any file under `dir` (a missing folder counts as 0). Dotfiles and dot folders (`.DS_Store`, editor swap files) are not changes of the source. */
export function newestChange(dir: string): number {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.build' || entry.name === 'release') continue;
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestChange(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * The sources that the build holds: the app, the packages that tools/bundle.mjs bundles into it, and the kits that electron-builder copies into its resources (`extraResources`).
 * A build made before the newest of them does not show what the source says.
 */
export function newestSourceOf(desktop: string): number {
  const packages = join(desktop, '..', '..', 'packages');
  return Math.max(
    ...['main', 'preload', 'renderer', 'shared'].map(dir => newestChange(join(desktop, dir))),
    newestChange(join(desktop, '..', '..', 'kits')),
    statSync(join(desktop, 'tools', 'bundle.mjs')).mtimeMs,
    ...(existsSync(packages) ? readdirSync(packages) : []).map(name => newestChange(join(packages, name, 'src'))),
    statSync(join(desktop, 'package.json')).mtimeMs,
  );
}

export interface Ended { readonly code: number | null; readonly signal: NodeJS.Signals | null }
interface Child { once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown; off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown; readonly exitCode?: number | null; readonly signalCode?: NodeJS.Signals | null }

/** How the child ended, or `'timeout'` after `ms` milliseconds. A child that has ended already answers at once. Nothing is left listening. */
export function waitForExit(child: Child, ms: number): Promise<Ended | 'timeout'> {
  if ((child.exitCode ?? null) !== null || (child.signalCode ?? null) !== null) return Promise.resolve({ code: child.exitCode ?? null, signal: child.signalCode ?? null });
  return new Promise(resolve => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => { clearTimeout(timer); resolve({ code, signal }); };
    const timer = setTimeout(() => { child.off('exit', onExit); resolve('timeout'); }, ms);
    child.once('exit', onExit);
  });
}

/** A clean end is code 0. A process that a SIGTERM ended before it could answer has code null and signal SIGTERM: that is clean only when the spec itself sent the SIGTERM. */
export function isCleanExit(ended: Ended | 'timeout', sentSigterm: boolean): boolean {
  if (ended === 'timeout') return false;
  return ended.code === 0 || (sentSigterm && ended.code === null && ended.signal === 'SIGTERM');
}
