// Runs a latebrake command inside this process. It starts no child process, so input, output, signals and the exit code stay
// the same as in a direct run. It reads no state folder, no store and no project file, and it sets no environment variable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The one version of latebrake that this package runs. It is the version of the dependency in package.json. */
export const LATEBRAKE_VERSION = '0.9.0-beta.1';

/**
 * Finds the folder of the `latebrake` package, starting from `startDir` and walking up. It checks a copy nested under this
 * package, then the sibling in the first `node_modules` folder above, and stops there: a copy further up is never used.
 * Returns the folder, or throws.
 */
export function findLatebrake(startDir = HERE) {
  let dir = path.resolve(startDir);
  for (;;) {
    const inModules = path.basename(dir) === 'node_modules';
    const candidate = inModules ? path.join(dir, 'latebrake') : path.join(dir, 'node_modules', 'latebrake');
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    const parent = path.dirname(dir);
    if (inModules || parent === dir) throw new Error('latebrake is not installed');
    dir = parent;
  }
}

/** Reads the entry file of one command from the `bin` of latebrake. Refuses a path that leaves the latebrake folder. */
export function entryFor(latebrakeDir, command) {
  const manifest = JSON.parse(fs.readFileSync(path.join(latebrakeDir, 'package.json'), 'utf8'));
  if (manifest === null || typeof manifest !== 'object' || manifest.name !== 'latebrake') throw new Error('the latebrake package record is not valid');
  if (manifest.version !== LATEBRAKE_VERSION) throw new Error(`latebrake ${String(manifest.version)} is installed, and this package runs only ${LATEBRAKE_VERSION}`);
  const bin = typeof manifest.bin === 'string' ? { latebrake: manifest.bin } : manifest.bin;
  const relative = bin !== null && typeof bin === 'object' ? bin[command] : undefined;
  if (typeof relative !== 'string' || relative === '') throw new Error(`latebrake has no ${command} command`);
  const entry = fs.realpathSync(path.resolve(latebrakeDir, relative));
  if (!entry.startsWith(latebrakeDir + path.sep)) throw new Error(`the ${command} entry is outside the latebrake folder`);
  return entry;
}

/** Runs `command` of latebrake in this process. Throws when latebrake cannot be found or loaded. */
export async function forward(command, startDir = HERE) {
  const entry = entryFor(findLatebrake(startDir), command);
  await import(pathToFileURL(entry).href);
}
