/**
 * Sample data. The sample files in apps/desktop/sample-data were made by the real Bowerloom commands. This module copies
 * them into the app's own folder and writes the few files that depend on where the copy sits: git settings, and the
 * folder grants (a grant names a project id and the folder's birth time, which a copy changes). It writes only below
 * `<appDir>/sample`, and it never touches the real store.
 */
import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GRANT_FORMAT, discoverProject, readFolderRecord, openStore } from '../../../packages/project-context/src/index.js';
import { isInside } from './safe.js';

export interface SampleWorld { home: string; projects: string; env: NodeJS.ProcessEnv; state: string }
interface SampleMeta { storeCommit: string; storeRemote: string; projectRemote: string; projects: string[]; grants: { folder: string; project: string }[] }

/** Folders Bowerloom makes (every `.bowerloom`) are private to the owner; everything else is an ordinary folder or file. */
function setModes(dir: string, inside: boolean): void {
  chmodSync(dir, inside ? 0o700 : 0o755);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), here = inside || entry.name === '.bowerloom';
    if (entry.isSymbolicLink()) throw new Error('The sample data holds a link.');
    if (entry.isDirectory()) setModes(path, here); else chmodSync(path, here ? 0o600 : 0o644);
  }
}
const put = (path: string, text: string): void => { mkdirSync(join(path, '..'), { recursive: true, mode: 0o755 }); writeFileSync(path, text, { mode: 0o644 }); };

/** Copies the sample into `<appDir>/sample` and returns where it is. Replaces an older copy. */
export function seedSample(appDir: string, sampleDir: string): SampleWorld {
  mkdirSync(appDir, { recursive: true, mode: 0o700 });
  const target = join(realpathSync(appDir), 'sample');
  if (!isInside(realpathSync(appDir), target)) throw new Error('The sample folder is outside the app folder.');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { mode: 0o755 });
  cpSync(join(sampleDir, 'home'), join(target, 'home'), { recursive: true, verbatimSymlinks: true });
  const meta = JSON.parse(readFileSync(join(sampleDir, 'sample.json'), 'utf8')) as SampleMeta;
  const home = join(target, 'home');
  setModes(home, false);
  // The git files of the store and of each project: the lock records this commit.
  const git = join(home, '.bowerloom', '.git');
  put(join(git, 'config'), `[remote "origin"]\n\turl = ${meta.storeRemote}\n`);
  put(join(git, 'HEAD'), 'ref: refs/heads/main\n');
  put(join(git, 'refs', 'remotes', 'origin', 'main'), `${meta.storeCommit}\n`);
  put(join(git, 'refs', 'heads', 'main'), `${meta.storeCommit}\n`);
  const projects = join(home, 'Projects');
  for (const name of meta.projects) put(join(projects, name, '.git', 'config'), `[remote "origin"]\n\turl = ${meta.projectRemote}\n`);
  // Grants: the sample file records which projects may read which registered folder.
  const store = openStore(home);
  for (const grant of meta.grants) {
    const dir = join(projects, grant.project), project = discoverProject(dir, home), record = readFolderRecord(store, grant.folder);
    const grants = join(store.dir, 'folders', `${grant.folder}.grants`);
    mkdirSync(grants, { recursive: true, mode: 0o700 });
    writeFileSync(join(grants, project.projectId), `{"format":"${GRANT_FORMAT}","record":"${record.sha256}","birth":"${project.identity.birthtimeNs}"}\n`, { mode: 0o644 });
  }
  const state = join(target, 'state');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  return { home: realpathSync(home), projects: realpathSync(projects), state, env: { HOME: realpathSync(home), XDG_STATE_HOME: state } };
}
export const sampleRoot = (appDir: string): string => resolve(appDir, 'sample');
