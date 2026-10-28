/**
 * The 0.7 files (definition spec, sections 8 rule 6, 11, and decision 12). `skills.json` and `bowerloom.json` are read
 * through step 0's mapping of the old engine field and ids, and stay byte for byte unchanged. 0.7 skills already in
 * `.bowerloom/skills` become definition skills in place: adoption cannot change them, so one that the definition cannot
 * carry refuses the adoption with the reason.
 */
import { MANIFEST_LIMITS, parseManifest } from '../../skill-manifest/src/schema.js';
import { parseConfig } from '../../project-config/src/schema.js';
import { isId } from '../../harness-definition/src/index.js';
import type { EngineId, JsonValue } from '../../harness-definition/src/index.js';
import { parseEngineId } from '../../skill-manifest/src/engine.js';
import type { SourceShape } from './model.js';
import { isObj, oneLine, readJson } from './shared.js';
import type { Obj } from './shared.js';
import { place, type Context } from './context.js';
import type { ProjectReader } from './files.js';
import { refuse } from './refusal.js';
import { readSkillFolder } from './skills.js';

function engines(r: ProjectReader): Set<EngineId> {
  const out = new Set<EngineId>();
  const manifest = r.file('.bowerloom/skills.json', 'legacy');
  if (manifest) {
    try { for (const e of parseManifest(manifest.bytes, MANIFEST_LIMITS).engines) out.add(e); }
    catch { r.miss('.bowerloom/skills.json', 'legacy', 'This 0.7 manifest does not read as a valid skills.json, so its engines are not used. It stays unchanged.'); }
  }
  const config = r.file('.bowerloom/bowerloom.json', 'legacy');
  if (config) {
    try { for (const e of parseConfig(config.bytes).engines) out.add(e); }
    catch { r.miss('.bowerloom/bowerloom.json', 'legacy', 'This 0.7 project file does not read as a valid bowerloom.json, so its engines are not used. It stays unchanged.'); }
  }
  return out;
}

/** The 0.7 skills in `.bowerloom/skills`. Each is fixed: it is already where the definition keeps it. */
function skills(ctx: Context, authored: readonly string[]): void {
  const { r } = ctx;
  for (const root of authored) {
    for (const { name, kind } of r.list(root, 'legacy') ?? []) {
      const rel = `${root}/${name}`;
      if (kind === 'file' && (name === '.DS_Store' || (name === '.gitkeep' && r.size(rel) === 0))) continue;
      if (kind !== 'dir') refuse('ADOPTION_LEGACY_SKILL', [rel]);
      const got = readSkillFolder(r, rel, place(rel, [], '0.7 skill in .bowerloom/skills', null, { kind: 'authored-0.7' }), [], { fixed: true });
      if (got === null || 'fault' in got) refuse('ADOPTION_LEGACY_SKILL', [`${rel}: ${got === null ? 'it cannot be read' : got.fault}`]);
      ctx.cands.push(got.skill, ...got.rules);
    }
  }
}

// ---- 0.7 managed copies -------------------------------------------------------------------------------------------------

/** The source of a managed copy for `sources.json`: npm by package and version, git by repository and commit. */
function sourceOf(value: JsonValue | undefined): { source: SourceShape | null; reason: string } {
  if (isObj(value) && value.kind === 'npm' && oneLine(value.package, 256) && oneLine(value.registry, 256) && oneLine(value.version, 256)) {
    return { source: { name: value.package, marketplace: value.registry, version: value.version }, reason: '' };
  }
  if (isObj(value) && value.kind === 'git' && oneLine(value.repository, 256) && oneLine(value.host, 256) && typeof value.commit === 'string' && /^[a-f0-9]{40}$/.test(value.commit)) {
    return { source: { name: value.repository, marketplace: value.host, version: value.commit }, reason: '' };
  }
  const kind = isObj(value) && typeof value.kind === 'string' && /^[a-z-]{1,32}$/.test(value.kind) ? value.kind : 'unknown';
  return { source: null, reason: `Its 0.7 source is ${kind}, not a marketplace package, so sources.json records nothing; the plan records the managed copy.` };
}

const oldEngines = (ctx: Context, list: unknown): EngineId[] => {
  const ids = (Array.isArray(list) ? list : [list]).map(x => parseEngineId(x)).filter((x): x is EngineId => x !== undefined);
  return ctx.engines.filter(e => ids.includes(e));
};

/**
 * 0.7 managed copies: `.bowerloom/managed/catalog/<item>.json` with the canonical copy in `.bowerloom/managed/skills/<id>`,
 * and the v1 namespace `.bowerloom-skills/` with `catalog.json` and `skills/<id>`. A skill copy becomes a candidate whose
 * place is the canonical copy; the engine copies are read by the skill readers and merge with it when they are the same.
 * Other kinds (prompt, agent, slice) are listed: their engine copies are read by the engine readers.
 */
function managed(ctx: Context): void {
  const { r } = ctx;
  const listed = r.list('.bowerloom/managed/catalog', 'legacy');
  for (const { name, kind } of listed ?? []) {
    const rel = `.bowerloom/managed/catalog/${name}`;
    if (kind !== 'file' || !name.endsWith('.json')) continue;
    const c = readJson(ctx, rel, 'legacy');
    if (!c) continue;
    if (c.format !== 'bowerloom/managed-catalog/v1beta2' || !isObj(c.item) || typeof c.item.kind !== 'string' || !isId(c.item.id)) {
      r.miss(rel, 'legacy', 'This catalog is not a 0.7 managed catalog adoption can read, so its copy is not converted. It stays unchanged.'); continue;
    }
    const itemKind = c.item.kind, id = c.item.id;
    if (itemKind !== 'skill') {
      ctx.managed.push({ catalog: rel, kind: /^[a-z]{1,16}$/.test(itemKind) ? itemKind : 'unknown', id, skill: null, source: null, copies: surfacePaths(c), reason: 'This 0.7 item is not a skill. Its engine copies are read by the engine readers like any engine file.' });
      continue;
    }
    convert(ctx, rel, id, `.bowerloom/managed/skills/${id}`, c.source, oldEngines(ctx, c.harnesses), surfacePaths(c));
  }
  if (r.kind('.bowerloom-skills') !== null) {
    r.consumed.add('.bowerloom-skills');
    const c = readJson(ctx, '.bowerloom-skills/catalog.json', 'legacy');
    if (c && c.format === 'bowerloom/observed-managed-skill-catalog/v1beta1') {
      for (const { name, kind } of r.list('.bowerloom-skills/skills', 'legacy') ?? []) {
        if (kind !== 'dir' || !isId(name)) continue;
        convert(ctx, '.bowerloom-skills/catalog.json', name, `.bowerloom-skills/skills/${name}`, c.source, oldEngines(ctx, c.harness), []);
      }
    } else if (c) r.miss('.bowerloom-skills/catalog.json', 'legacy', 'This catalog is not a 0.7 v1 managed catalog adoption can read, so its copy is not converted. It stays unchanged.');
  }
}

function surfacePaths(c: Obj): string[] {
  if (!Array.isArray(c.surfaces)) return [];
  return c.surfaces.flatMap(s => isObj(s) && typeof s.path === 'string' && s.id !== 'catalog' && s.id !== 'ignore' && /^[A-Za-z0-9._/-]{1,512}$/.test(s.path) ? [s.path] : []);
}

function convert(ctx: Context, catalog: string, id: string, canonical: string, source: JsonValue | undefined, engines: EngineId[], copies: string[]): void {
  const { r } = ctx;
  const s = sourceOf(source);
  const record = { catalog, kind: 'skill', id, skill: null, source: s.source, copies, reason: s.reason };
  if (r.kind(canonical) !== 'dir') { r.miss(catalog, 'legacy', 'The canonical copy of this 0.7 item is missing, so it is not converted.'); ctx.managed.push({ ...record, reason: 'The canonical copy is missing.' }); return; }
  const got = readSkillFolder(r, canonical, place(canonical, engines, '0.7 managed copy', null, { kind: 'managed-0.7' }), engines, s.source ? { source: s.source } : {});
  r.consumed.add(canonical);
  if (!got || 'fault' in got) { ctx.managed.push({ ...record, reason: 'The canonical copy cannot be adopted; the unmapped list says why.' }); return; }
  ctx.cands.push(got.skill, ...got.rules);
  ctx.managed.push({ ...record, id, copies: [...new Set([...copies, canonical])] });
}

export const readLegacy = { engines, skills, managed };
