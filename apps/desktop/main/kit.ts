/**
 * The ready-made kits that ship with Bowerloom (0.8 spec, section 6.9), as main reads them. A kit is a read-only library in the repository's `kits/`
 * folder; electron-builder copies that folder into the app's resources (apps/desktop/package.json, `extraResources`).
 *  - In development the kit is read from the repository; in a packaged build from `<resources>/kits`.
 *  - Every byte a save or a starter wiki writes from a kit is read here, from the kit's own files. The window names a kit by id and sends no text.
 *  - The kit is validated at every load: `kit.json` as strict JSON with exactly its five fields and a pinned version; the agent and the skills through the
 *    harness definition loader, which also scans them for secrets; the starter template as plain, visible files with no secret. A link anywhere is refused.
 *  - A kit that fails any check is refused with KIT_INVALID and words that name the reason and no absolute path. There is never an empty kit.
 * Nothing here writes a file.
 */
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { HARNESS_FORMAT, loadDefinitionFiles, parseStrictJson, scanSecrets } from '../../../packages/harness-definition/src/index.js';
import type { DefinitionFile } from '../../../packages/harness-definition/src/index.js';
import { STARTER_LIMITS } from '../../../packages/notes-source/src/index.js';
import type { TemplateFile } from '../../../packages/notes-source/src/index.js';
import { KIT_IDS, KIT_INVALID, KIT_MAIN_WORDS } from '../shared/engine/types.js';
import type { KitId } from '../shared/engine/types.js';

/** The format of `kit.json`. */
export const KIT_FORMAT = 'bowerloom/kit/v1beta1';
/** The bounds of one kit: files across its three folders, and bytes per file. */
export const KIT_LIMITS = Object.freeze({ files: 512, fileBytes: 1024 * 1024, depth: 8 });

/** One kit, as main loaded it. Frozen: nothing changes a kit after its load. */
export interface Kit {
  readonly id: KitId;
  readonly name: string;
  readonly description: string;
  /** The pinned version from `kit.json`, recorded in `sources.json` when the kit is added. */
  readonly version: string;
  /** The kit's one agent: its id and the whole text of `agents/<id>.md`. */
  readonly agent: { readonly id: string; readonly text: string };
  /** The skills, in id order, each with its files relative to the skill folder. */
  readonly skills: readonly { readonly id: string; readonly files: readonly DefinitionFile[] }[];
  /** The starter wiki template, in path order. */
  readonly starter: readonly TemplateFile[];
}

/** Where the kits are: `<resources>/kits` in a packaged build, the repository's `kits/` in development (`appRoot` is apps/desktop/dist). */
export function kitsFolder(o: { readonly packaged: boolean; readonly resourcesPath: string; readonly appRoot: string }): string {
  return o.packaged ? join(o.resourcesPath, 'kits') : join(o.appRoot, '..', '..', '..', 'kits');
}

/**
 * The kits folder of this app, each kit checked once now. A broken kit is told on the console; every call that needs it loads it again and refuses with
 * words. Returns the folder for the engine service, which loads the kit each time it needs one.
 */
export function shippedKits(o: Parameters<typeof kitsFolder>[0], tell: (message: string) => void = message => console.error(message)): () => string {
  const dir = kitsFolder(o);
  for (const id of KIT_IDS) {
    try { loadKit(dir, id); } catch (error) { tell(`Bowerloom could not load its ${id} kit. ${error instanceof Error ? error.message : 'FAILED'}`); }
  }
  return () => dir;
}

const refuse = (why: string): never => { throw new DefinitionError(KIT_INVALID, `${KIT_MAIN_WORDS.KIT_INVALID} (${why})`); };
const byBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const PINNED = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** True for a plain folder that is not a link. */
function realFolder(abs: string): boolean {
  try { const st = lstatSync(abs); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; }
}

/** Every plain file under `rel` of the kit folder, relative to the kit, in path order. A link, or anything that is not a file or a folder, is refused. */
function filesUnder(kit: string, rel: string, count: { n: number }): { path: string; bytes: Buffer }[] {
  const out: { path: string; bytes: Buffer }[] = [];
  const walk = (at: string, depth: number): void => {
    if (depth > KIT_LIMITS.depth) refuse(`${at} is nested too deep`);
    let names: string[];
    try { names = readdirSync(join(kit, at)); } catch { return refuse(`${at} cannot be read`); }
    for (const name of names.sort(byBytes)) {
      // The file a Mac's Finder leaves in a folder it showed is not part of the kit.
      if (name === '.DS_Store') continue;
      const child = `${at}/${name}`;
      let st;
      try { st = lstatSync(join(kit, child)); } catch { return refuse(`${child} cannot be read`); }
      if (st.isSymbolicLink()) refuse(`${child} is a link`);
      if (st.isDirectory()) { walk(child, depth + 1); continue; }
      if (!st.isFile()) refuse(`${child} is not a plain file`);
      if (++count.n > KIT_LIMITS.files) refuse('the kit holds too many files');
      if (st.size > KIT_LIMITS.fileBytes) refuse(`${child} is too large`);
      out.push({ path: child, bytes: readFileSync(join(kit, child)) });
    }
  };
  if (!realFolder(join(kit, rel))) refuse(`the ${rel} folder of the kit is missing or is a link`);
  walk(rel, 1);
  return out;
}

/** The fields of `kit.json`: exactly format, id, name, description and version, with a pinned version. */
function readKitJson(kit: string, id: KitId): { name: string; description: string; version: string } {
  let raw: string;
  try {
    const st = lstatSync(join(kit, 'kit.json'));
    if (!st.isFile() || st.isSymbolicLink() || st.size > 64 * 1024) return refuse('kit.json is not a plain file');
    raw = readFileSync(join(kit, 'kit.json'), 'utf8');
  } catch { return refuse('kit.json is missing'); }
  const parsed = parseStrictJson(raw);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return refuse('kit.json is not strict JSON');
  const v = parsed.value as Record<string, unknown>;
  const keys = ['format', 'id', 'name', 'description', 'version'];
  if (Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) return refuse('kit.json must hold exactly format, id, name, description and version');
  if (v.format !== KIT_FORMAT) return refuse(`kit.json format must be ${KIT_FORMAT}`);
  if (v.id !== id) return refuse(`kit.json id must be ${id}`);
  const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim() !== '' && x.length <= max && !/[\0-\x1f\x7f]/.test(x);
  if (!text(v.name, 64) || !text(v.description, 1024)) return refuse('kit.json name and description must be one line of text');
  if (typeof v.version !== 'string' || !PINNED.test(v.version)) return refuse('kit.json version must be one pinned version, such as 1.2.3');
  return { name: v.name, description: v.description, version: v.version };
}

/**
 * Loads one shipped kit, read-only, from `kitsDir`. Refuses KIT_INVALID, with words, for a kit that is missing or fails any check; it never returns an
 * empty or partial kit.
 */
export function loadKit(kitsDir: string, id: KitId): Kit {
  const kit = join(kitsDir, id);
  if (!realFolder(kitsDir) || !realFolder(kit)) refuse('the kit folder is missing or is a link');
  const meta = readKitJson(kit, id);
  const count = { n: 0 };
  const agents = filesUnder(kit, 'agents', count), skills = filesUnder(kit, 'skills', count), starter = filesUnder(kit, 'starter', count);

  // The agent and the skills load as one definition in memory, through the same loader a save uses, so a kit item is exactly what a harness accepts.
  const harness = { format: HARNESS_FORMAT, id: `kit-${id}`, description: meta.description, engines: [{ id: 'claude-code' }, { id: 'codex' }], parts: { skills: 'skills/', subagents: 'agents/' } };
  const files: DefinitionFile[] = [{ path: 'harness.json', bytes: Buffer.from(`${JSON.stringify(harness, null, 2)}\n`) }, ...agents, ...skills];
  const loaded = loadDefinitionFiles(files);
  if (!loaded.ok) return refuse(`an agent or skill file does not load: ${[...new Set(loaded.problems.map(p => `${p.path} ${p.code}`))].slice(0, 5).join(', ')}`);
  const def = loaded.definition;
  if (def.entries.subagents.length !== 1 || agents.length !== 1) return refuse('a kit holds one agent');
  const agent = def.entries.subagents[0]!;
  const skillIds = def.entries.skills.map(s => s.id).sort(byBytes);
  const linked = [...(agent.skills ?? [])].sort(byBytes);
  if (skillIds.length === 0 || JSON.stringify(skillIds) !== JSON.stringify(linked)) return refuse('the agent must use exactly the skills the kit holds');

  // The starter template: plain visible names, AGENTS.md at its root, within the starter bounds, and no secret.
  const template = starter.map(f => ({ path: f.path.slice('starter/'.length), bytes: f.bytes }));
  if (!template.some(f => f.path === 'AGENTS.md')) return refuse('the starter template has no AGENTS.md');
  if (template.length > STARTER_LIMITS.files || template.some(f => f.path.split('/').some(seg => seg.startsWith('.')))) return refuse('the starter template holds a hidden file or too many files');
  if (scanSecrets(template.map(f => ({ path: `starter/${f.path}`, bytes: f.bytes }))).length > 0) return refuse('the starter template holds a secret value');

  const freeze = <T>(x: T): T => Object.freeze(x);
  return freeze({
    id, name: meta.name, description: meta.description, version: meta.version,
    agent: freeze({ id: agent.id, text: agents[0]!.bytes.toString('utf8') }),
    skills: freeze(skillIds.map(sid => freeze({
      id: sid,
      files: freeze(skills.filter(f => f.path.startsWith(`skills/${sid}/`)).map(f => freeze({ path: f.path.slice(`skills/${sid}/`.length), bytes: Buffer.from(f.bytes), executable: false }))),
    }))),
    starter: freeze(template.map(f => freeze({ path: f.path, bytes: Buffer.from(f.bytes) }))),
  });
}
