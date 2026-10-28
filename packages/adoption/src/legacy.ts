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
import { lose, place, type Context } from './context.js';
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

/**
 * The engines a 0.7 record names, through step 0's mapping, kept to the engines of the harness. Null when the record
 * names none, which means no restriction. An empty list means it names engines, none of them in the harness: the copy
 * is then not converted, never widened to every engine (ruling A12).
 */
const oldEngines = (ctx: Context, list: unknown): EngineId[] | null => {
  if (list === undefined || list === null) return null;
  const ids = (Array.isArray(list) ? list : [list]).map(x => parseEngineId(x)).filter((x): x is EngineId => x !== undefined);
  return ctx.engines.filter(e => ids.includes(e));
};

/** A copy path from a catalog: relative, with no empty, `.`, or `..` segment (ruling A8). */
const relativePath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= 512 && !p.startsWith('/') && !p.includes('\\') && !/[\0-\x1f\x7f]/.test(p)
  && p.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');

export const CLAIMED_APPROVAL = 'The source comes from what the 0.7 catalog claims. Bowerloom did not check it, and sources.json cannot mark it as claimed until the definition contract takes that field. A person checks it.';

/**
 * 0.7 managed copies: `.bowerloom/managed/catalog/<item>.json` with the canonical copy in `.bowerloom/managed/skills/<id>`,
 * and the v1 namespace `.bowerloom-skills/` with `catalog.json` and `skills/<id>`. A skill copy becomes a candidate whose
 * place is the canonical copy; the engine copies are read by the skill readers and merge with it when they are the same.
 * Other kinds (prompt, agent, slice) are listed: their engine copies are read by the engine readers. Every other entry
 * of these folders is listed (ruling A1).
 */
function managed(ctx: Context): void {
  const { r } = ctx;
  const named = new Set<string>();
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
    if (itemKind === 'skill') named.add(id);
    const surfaces = surfacePaths(c);
    if (surfaces === null) {
      r.miss(rel, 'legacy', 'A copy path in this catalog is not a relative path inside the project: it is absolute or holds an empty, . or .. segment. The copy is not converted.');
      ctx.managed.push({ catalog: rel, kind: /^[a-z]{1,16}$/.test(itemKind) ? itemKind : 'unknown', id, skill: null, source: null, copies: [], reason: 'A copy path in the catalog is not a relative path inside the project.' });
      continue;
    }
    if (itemKind !== 'skill') {
      ctx.managed.push({ catalog: rel, kind: /^[a-z]{1,16}$/.test(itemKind) ? itemKind : 'unknown', id, skill: null, source: null, copies: surfaces, reason: 'This 0.7 item is not a skill. Its engine copies are read by the engine readers like any engine file.' });
      continue;
    }
    convert(ctx, rel, id, `.bowerloom/managed/skills/${id}`, c.source, oldEngines(ctx, c.harnesses), surfaces);
  }
  if (listed) r.rest('.bowerloom/managed/catalog', listed, 'legacy');
  const copies = r.list('.bowerloom/managed/skills', 'legacy');
  if (copies) for (const { name } of copies) if (named.has(name)) r.consumed.add(`.bowerloom/managed/skills/${name}`);
  if (copies) for (const { name } of copies) {
    const rel = `.bowerloom/managed/skills/${name}`;
    if (!r.consumed.has(rel)) { r.consumed.add(rel); r.miss(rel, 'legacy', 'No 0.7 catalog names this managed copy, so it is not converted. It stays unchanged.'); }
  }
  if (r.kind('.bowerloom-skills') !== null) {
    const top = r.list('.bowerloom-skills', 'legacy');
    const c = readJson(ctx, '.bowerloom-skills/catalog.json', 'legacy');
    if (c && c.format === 'bowerloom/observed-managed-skill-catalog/v1beta1') {
      const skills = r.list('.bowerloom-skills/skills', 'legacy');
      for (const { name, kind } of skills ?? []) {
        if (kind !== 'dir' || !isId(name)) continue;
        convert(ctx, '.bowerloom-skills/catalog.json', name, `.bowerloom-skills/skills/${name}`, c.source, oldEngines(ctx, c.harness), []);
      }
      if (skills) r.rest('.bowerloom-skills/skills', skills, 'legacy');
    } else if (c) r.miss('.bowerloom-skills/catalog.json', 'legacy', 'This catalog is not a 0.7 v1 managed catalog adoption can read, so its copy is not converted. It stays unchanged.');
    if (top) r.rest('.bowerloom-skills', top, 'legacy');
  }
}

/** The copy paths of a catalog, or null when one is not a relative path inside the project. */
function surfacePaths(c: Obj): string[] | null {
  if (!Array.isArray(c.surfaces)) return [];
  const out: string[] = [];
  for (const s of c.surfaces) {
    if (!isObj(s) || s.id === 'catalog' || s.id === 'ignore') continue;
    if (!relativePath(s.path)) return null;
    out.push(s.path);
  }
  return out;
}

function convert(ctx: Context, catalog: string, id: string, canonical: string, source: JsonValue | undefined, engines: EngineId[] | null, copies: string[]): void {
  const { r } = ctx;
  const s = sourceOf(source);
  const claimed: SourceShape | null = s.source ? { ...s.source, claimed: true } : null;
  const record = { catalog, kind: 'skill', id, skill: null, source: claimed, copies, reason: s.reason };
  if (r.kind(canonical) !== 'dir') { r.miss(catalog, 'legacy', 'The canonical copy of this 0.7 item is missing, so it is not converted.'); ctx.managed.push({ ...record, reason: 'The canonical copy is missing.' }); return; }
  if (engines !== null && engines.length === 0) {
    r.consumed.add(canonical);
    r.miss(canonical, 'legacy', 'The 0.7 item names no engine of this harness, so it is not widened to every engine. It is not converted.');
    ctx.managed.push({ ...record, reason: 'The 0.7 item names no engine of this harness.' });
    return;
  }
  const reach = engines ?? [];
  const got = readSkillFolder(r, canonical, place(canonical, reach, '0.7 managed copy', null, { kind: 'managed-0.7' }), reach, claimed ? { source: claimed } : {});
  r.consumed.add(canonical);
  if (!got || 'fault' in got) { ctx.managed.push({ ...record, reason: 'The canonical copy cannot be adopted; the unmapped list says why.' }); return; }
  ctx.cands.push(claimed ? { ...got.skill, needsApproval: [...got.skill.needsApproval, CLAIMED_APPROVAL] } : got.skill, ...got.rules);
  for (const a of got.lost) for (const e of reach) lose(ctx, e, a);
  ctx.managed.push({ ...record, id, copies: [...new Set([...copies, canonical])] });
}

export const readLegacy = { engines, skills, managed };
