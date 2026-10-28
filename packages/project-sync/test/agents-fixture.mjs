// Shared fixtures for the team agent tests (spec 01a). Not a test file: npm test runs *.test.mjs only.
// A project here is made by the real startup, so `teams/first-team` is a real team folder, and other teams come from
// the product's own `team create`. Agent sources are hand placed, as a person places them.
import '../../../dist/tests/support/isolate-home.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planStartup, applyStartup } from '../../../dist/packages/startup/src/index.js';
import { discoverProject, withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate } from '../../../dist/packages/project-authoring/src/index.js';
import { planProjectApply, applyProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { renderApplyReview } from '../../../dist/apps/cli/src/apply.js';

export const hash = b => createHash('sha256').update(b).digest('hex');
export const signal = () => new AbortController().signal;

/** A startup project plus a private state root, both under a fresh folder in HOME. */
export async function agentProject(t, prefix = '.bowerloom-agents-') {
  const home = fs.realpathSync(os.homedir()), base = fs.mkdtempSync(path.join(home, prefix)); fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const projectDir = path.join(base, 'project'); fs.mkdirSync(projectDir, { mode: 0o755 });
  const startup = { mode: 'existing', targetDir: projectDir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(startup, (await planStartup(startup)).revision);
  const stateRoot = path.join(base, 'state', 'bowerloom'), project = () => discoverProject(projectDir, home);
  const input = (engines = ['claude-code', 'codex'], extra = {}) => ({ project: project(), stateRoot, engines, team: null, home, ...extra });
  const itemsRoot = path.join(stateRoot, project().projectId, 'items');
  return { home, base, projectDir, stateRoot, project, input, itemsRoot, bowerloom: path.join(projectDir, '.bowerloom') };
}

/** `team create <name>` through the product, under the project lock. */
export async function createTeam(f, name, profile = 'research') {
  const req = { kind: 'team', project: f.projectDir, name, profile }, plan = await planCreate(req);
  await withProjectLock(f.projectDir, signal(), held => applyCreate(req, plan.revision, held));
}
/** A registered prompt through `prompt create`. */
export async function createPrompt(f, name, text) {
  const req = { kind: 'prompt', project: f.projectDir, name, teams: [] }, plan = await planCreate(req);
  await withProjectLock(f.projectDir, signal(), held => applyCreate(req, plan.revision, held));
  if (text !== undefined) fs.writeFileSync(path.join(f.projectDir, '.bowerloom/prompts', name + '.md'), text);
}

/** The text of a valid agent file. `extra` is more frontmatter lines. */
export const agentText = (role, extra = '', body = 'Do the work.\n') => `---\nname: ${role}\ndescription: ${role} helps the team.\n${extra ? extra + '\n' : ''}---\n${body}`;
/** Writes `.bowerloom/teams/<team>/agents/<entry>` as a person would: plain file, mode 0644, folders 0755. */
export function agentSource(f, team, entry, text, mode = 0o644) {
  const dir = path.join(f.bowerloom, 'teams', team, 'agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = path.join(dir, entry); fs.writeFileSync(file, text, { mode }); fs.chmodSync(file, mode); return file;
}
export const agentDir = (f, team) => path.join(f.bowerloom, 'teams', team, 'agents');
/** A hand-made file at `.claude/agents/<name>`. */
export function claudeAgent(f, name, text, mode = 0o644) {
  const dir = path.join(f.projectDir, '.claude/agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = path.join(dir, name); fs.writeFileSync(file, text, { mode }); fs.chmodSync(file, mode); return file;
}
export const target = (f, role) => path.join(f.projectDir, '.claude/agents', role + '.md');

export const plan = (f, engines, extra) => planProjectApply(f.input(engines, extra));
export async function applied(f, engines, extra, deps) {
  const p = await plan(f, engines, extra);
  return { plan: p, result: await applyProjectApply(f.input(engines, extra), p.revision, signal(), deps) };
}
export const review = p => renderApplyReview(p);
export const byId = list => Object.fromEntries(list.map(i => [i.id, i]));
export const read = (f, rel) => fs.readFileSync(path.join(f.projectDir, rel), 'utf8');
export const exists = (f, rel) => fs.existsSync(path.join(f.projectDir, rel));
export const code = expected => e => { if (e?.code !== expected) throw new Error(`expected ${expected}, got ${e?.code ?? e} ${e?.message ?? ''}`); return true; };
/** Every entry under a folder with inode, mode, mtime and content hash: any write shows. */
export function exactTree(dir) {
  if (!fs.existsSync(dir)) return null;
  const rows = [];
  const visit = p => { const s = fs.lstatSync(p, { bigint: true }); rows.push([path.relative(dir, p), String(s.ino), Number(s.mode) & 0o7777, String(s.mtimeNs), s.isFile() ? hash(fs.readFileSync(p)) : s.isSymbolicLink() ? 'link' : 'dir']); if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); };
  visit(dir); return JSON.stringify(rows);
}
