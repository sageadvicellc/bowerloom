// Shared fixtures for the context slice tests (spec 05). Not a test file: npm test runs *.test.mjs only.
import fs from 'node:fs';
import path from 'node:path';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { planFolderAdd, applyFolderAdd, planFolderAllow, applyFolderAllow } from '../../../dist/packages/project-context/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { agentProject, agentText, agentSource, signal } from './agents-fixture.mjs';

export * from './agents-fixture.mjs';

/** `slice create <name>` through the product, under the project lock. `root` and `includes` are as the command takes them. */
export async function createSlice(f, name, { root = null, includes = null, registered = null } = {}) {
  const request = { kind: 'slice', project: f.projectDir, name, root: registered !== null ? { kind: 'registered', name: registered, path: root ?? '.' } : root === null ? null : { kind: 'project', path: root }, includes };
  await withProjectLock(f.projectDir, signal(), async held => applyCreate(request, (await planCreate(request)).revision, held));
}
/** Writes a file under the project as a person would: plain file, mode 0644, folders 0755. */
export function put(f, rel, text = '# Page\n') {
  const file = path.join(f.projectDir, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  for (let p = path.dirname(file); p !== f.projectDir && p.startsWith(f.projectDir); p = path.dirname(p)) fs.chmodSync(p, 0o755);
  fs.writeFileSync(file, text, { mode: 0o644 }); fs.chmodSync(file, 0o644); return file;
}
/** A project with a wiki of two pages and the slice `wiki` over it. */
export async function wikiProject(t, { slice = true, guard = null } = {}) {
  const f = await agentProject(t);
  put(f, 'wiki/a.md', '# Alpha\nbody a\n'); put(f, 'wiki/sub/b.md', '# Beta\nbody b\n');
  if (slice) { await createSlice(f, 'wiki', { root: 'wiki' }); if (guard !== null) rewriteSlice(f, 'wiki', s => s.replace('guard: root', `guard: ${guard}`)); }
  return f;
}
export const sliceFile = (f, name) => path.join(f.bowerloom, 'slices', name + '.yaml');
export function rewriteSlice(f, name, edit) { const file = sliceFile(f, name); fs.writeFileSync(file, edit(fs.readFileSync(file, 'utf8'))); }
/** An agent file in first-team whose skills list names these entries. */
export function sliceAgent(f, role, skills, extra = '') {
  return agentSource(f, 'first-team', role + '.md', agentText(role, `skills: [${skills.join(', ')}]${extra ? '\n' + extra : ''}`));
}
export const sliceLine = (id, text) => new RegExp(`^ {2}${id} +${text}$`, 'm');

/** The input of measureContext for a project made by wikiProject. */
export const measureInput = (f, extra = {}) => ({ project: f.project(), stateRoot: f.stateRoot, home: f.home, from: f.projectDir, ...extra });

let folders = 0;
/**
 * A folder in HOME, outside the project, with a wiki of two pages, registered in the store under a new name by the product's
 * own `folder add`. Both the folder and its record go when the test ends.
 */
export async function registeredFolder(f, t, { name = `kb${++folders}`, pages = { 'a.md': '# Alpha\nbody a\n', 'sub/b.md': '# Beta\nbody b\n' }, allow = true, prefix = 'folder-' } = {}) {
  const dir = fs.mkdtempSync(path.join(f.home, prefix)); fs.chmodSync(dir, 0o755);
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(f.home, '.bowerloom/folders', name + '.json'), { force: true }); });
  const wiki = path.join(dir, 'wiki');
  for (const [rel, text] of Object.entries(pages)) {
    const file = path.join(wiki, rel); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
    for (let p = path.dirname(file); p !== dir; p = path.dirname(p)) fs.chmodSync(p, 0o755);
    fs.writeFileSync(file, text, { mode: 0o644 });
  }
  const plan = planFolderAdd(f.home, f.home, name, dir);
  await applyFolderAdd(f.home, f.home, name, dir, plan.revision, signal());
  if (allow) await allowFolder(f, name);
  return { name, dir, wiki, record: path.join(f.home, '.bowerloom/folders', name + '.json'), display: path.relative(f.projectDir, wiki) };
}

/** `folder allow <name>` for the project of the fixture, through the product. */
export async function allowFolder(f, name) {
  const project = { dir: f.projectDir, projectId: f.project().projectId, birthtimeNs: f.project().identity.birthtimeNs }, plan = planFolderAllow(f.home, project, name);
  await applyFolderAllow(f.home, project, name, plan.revision, signal());
}
