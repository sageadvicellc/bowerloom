/**
 * The adoption plan (definition spec, sections 8, 10, 11, and 13). It reads the project's engine files and the 0.7
 * files, and proposes the `.bowerloom` definition. It writes nothing in the project.
 *
 * - Identical items from several places merge into one item that lists every place (section 10, rule 4). Identity is
 *   meaning: the neutral content, then the private blocks.
 * - Items with the same part and id that differ are a conflict, shown side by side in path order (rules 5 and 6). A
 *   person picks one or keeps them under distinct ids. Apply refuses while a conflict has no choice.
 * - Guardrail rules for one action and pattern whose effect differs between engines are both kept, each with the
 *   engines that had it, and listed as a difference.
 * - An item's engine filter is the engines that read its places. With every engine of the harness, it has no filter.
 * - The planned files are loaded with the contract's loader in a scratch folder outside the project. A problem there is
 *   a problem of the plan, and apply refuses it.
 */
import fs from 'node:fs';
import os from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { stringify } from 'yaml';
import { canonicalJson } from '../../contracts/src/index.js';
import {
  ENGINE_IDS, HARNESS_FORMAT, LEGACY_NAMES, isEngineId, isId, isServerName, loadDefinition,
} from '../../harness-definition/src/index.js';
import type { EngineId, JsonValue, Problem } from '../../harness-definition/src/index.js';
import { byBytes, revisionOf, sha } from '../../project-sync/src/portable-files.js';
import { DEFAULT_ENGINES } from '../../skill-manifest/src/engine.js';
import { DSH_PINNED_TAG, READER_VERSIONS, type Context } from './context.js';
import { ENGINE_READERS, detectEngines, sweep } from './engines.js';
import { ProjectReader } from './files.js';
import { readLegacy } from './legacy.js';
import {
  ADOPTION_PLAN_FORMAT, type AdoptionChoice, type AdoptionPlan, type Candidate, type Conflict, type Difference, type ItemPart,
  type ManagedConversion, type Place, type PlanEngine, type PlanItem, type PlannedFile, type SecretLine, type SourceShape, type Unmapped,
} from './model.js';
import { readInstructions, readSkillPlaces } from './portable-readers.js';
import { refuse } from './refusal.js';
import { skillMarkdown } from './skills.js';

export interface AdoptionInput {
  /** The real absolute path of the project folder. */
  readonly projectDir: string;
  /** The engines of the harness. Default: the engines whose files the project holds, else the 0.7 default. */
  readonly engines?: readonly { readonly id: EngineId; readonly version?: string; readonly model?: string }[];
  readonly harness?: { readonly id?: string; readonly description?: string };
  /** A choice for each conflict, by conflict key. */
  readonly choices?: Readonly<Record<string, AdoptionChoice>>;
}

/** A plan with the bytes of each planned file, for apply. */
export interface PlanWithBytes { readonly plan: AdoptionPlan; readonly bytes: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly mode: number }>; readonly definitionRevision: string | null }

const sha8 = (v: unknown): string => sha(canonicalJson(v)).slice(0, 8);
const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hook';
const placeKey = (p: Place): string => p.pointer !== undefined ? `${p.path}#${p.pointer}` : p.path;
const comparePlaces = (a: Place, b: Place): number => byBytes(placeKey(a), placeKey(b));
const json = (v: unknown): Uint8Array => Buffer.from(JSON.stringify(v, null, 2) + '\n');
const CONTROL = /[\0-\x08\x0a-\x1f\x7f]/;

export function planAdoption(input: AdoptionInput): AdoptionPlan { return planWithBytes(input).plan; }

export function planWithBytes(input: AdoptionInput): PlanWithBytes {
  const { projectDir, wanted, harnessId, description, choices } = checkInput(input);
  const definitionFolder = join(projectDir, '.bowerloom');
  const r = new ProjectReader(projectDir);
  const authored = checkDefinitionFolder(r);

  // Engines: the input, else the engine files and the 0.7 files, else the 0.7 default.
  const warnings: string[] = [];
  const legacyEngines = readLegacy.engines(r);
  const detected = detectEngines(r);
  let engines: EngineId[];
  if (wanted) engines = ENGINE_IDS.filter(e => wanted.some(w => w.id === e));
  else {
    engines = ENGINE_IDS.filter(e => detected.has(e) || legacyEngines.has(e));
    if (engines.length === 0) { engines = [...DEFAULT_ENGINES]; warnings.push(`No engine file names an engine, so the harness lists the 0.7 default: ${engines.join(', ')}. Name the engines in the input to change it.`); }
  }
  const versions: Partial<Record<EngineId, string>> = {};
  for (const w of wanted ?? []) if (w.version !== undefined) versions[w.id] = w.version;
  if (engines.includes('deepseek-harness')) versions['deepseek-harness'] = DSH_PINNED_TAG;

  const ctx: Context = { r, engines, versions, cands: [], warnings, managed: [], models: {} };
  readInstructions(ctx);
  readSkillPlaces(ctx);
  readLegacy.skills(ctx, authored);
  readLegacy.managed(ctx);
  for (const read of ENGINE_READERS) read(ctx);
  sweep(ctx);

  // Ids that come from content, so identical entries merge and others never clash.
  const cands = ctx.cands.map(withId);
  const unmapped: Unmapped[] = [...r.unmapped];
  const { items, conflicts, kept } = group(cands, engines, choices, unmapped);
  const differences = differencesOf(kept);

  // Explicit models of each engine: the input wins; an engine file gives one otherwise.
  const models: Partial<Record<EngineId, string>> = {};
  for (const e of engines) {
    const w = wanted?.find(x => x.id === e)?.model;
    if (w !== undefined) models[e] = w;
    else if (ctx.models[e]) models[e] = ctx.models[e].model;
  }
  const planEngines: PlanEngine[] = engines.map(id => ({
    id, version: versions[id] ?? null, model: models[id] ?? null, detected: detected.has(id) || legacyEngines.has(id),
    shapes: shapesOf(id, cands),
  }));

  const built = buildFiles({ harnessId, description, engines: planEngines, items: kept, unmapped, warnings });
  const files: PlannedFile[] = [...built.entries()].sort(([a], [b]) => byBytes(a, b))
    .map(([path, f]) => ({ path, sha256: sha(f.bytes), bytes: f.bytes.length, mode: f.mode }));
  const ready0 = conflicts.every(c => c.choice !== null);
  const validated = validate(built, kept);
  const secrets: SecretLine[] = kept.flatMap(k => k.secrets.map(s => ({ ...s, part: k.item.part, id: k.item.id })))
    .sort((a, b) => byBytes(`${a.path}#${a.pointer}`, `${b.path}#${b.pointer}`));

  const body = {
    format: ADOPTION_PLAN_FORMAT, projectDir, definitionFolder, harness: { id: harnessId, description }, engines: planEngines,
    read: [...r.read.entries()].sort(([a], [b]) => byBytes(a, b)).map(([path, sha256]) => ({ path, sha256 })),
    items, conflicts, differences, unmapped: dedupeUnmapped(unmapped), secrets, managed: managedOf(ctx.managed, kept, conflicts), warnings,
    files, problems: validated.problems, ready: ready0 && validated.problems.length === 0, writesAuthorized: false as const,
  };
  const plan: AdoptionPlan = { ...body, revision: revisionOf(body) };
  return { plan, bytes: built, definitionRevision: validated.revision };
}

// ---- input -------------------------------------------------------------------------------------------------------------

function checkInput(input: AdoptionInput) {
  if (input === null || typeof input !== 'object') return refuse('ADOPTION_USAGE');
  const allowed = new Set(['projectDir', 'engines', 'harness', 'choices']);
  if (Object.keys(input).some(k => !allowed.has(k))) refuse('ADOPTION_USAGE');
  const { projectDir } = input;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir) || projectDir.includes('\0')) refuse('ADOPTION_USAGE');
  let real: string, st: fs.Stats;
  try { real = fs.realpathSync(projectDir); st = fs.lstatSync(projectDir); } catch { return refuse('ADOPTION_PROJECT_UNSAFE'); }
  if (real !== projectDir || !st.isDirectory() || st.uid !== process.getuid?.()) refuse('ADOPTION_PROJECT_UNSAFE');
  let wanted: { id: EngineId; version?: string; model?: string }[] | undefined;
  if (input.engines !== undefined) {
    if (!Array.isArray(input.engines) || input.engines.length === 0) refuse('ADOPTION_USAGE');
    wanted = [];
    for (const e of input.engines) {
      if (e === null || typeof e !== 'object' || Object.keys(e).some(k => !['id', 'version', 'model'].includes(k))) refuse('ADOPTION_USAGE');
      if (!isEngineId(e.id) || wanted.some(w => w.id === e.id)) refuse('ADOPTION_USAGE');
      if (e.version !== undefined && (typeof e.version !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(e.version))) refuse('ADOPTION_USAGE');
      if (e.model !== undefined && (typeof e.model !== 'string' || e.model.trim() === '' || e.model.length > 256 || CONTROL.test(e.model))) refuse('ADOPTION_USAGE');
      if (e.id === 'opencode' && e.version !== undefined && !/^1\./.test(e.version)) refuse('ADOPTION_OPENCODE_VERSION', ['opencode']);
      if (e.id === 'deepseek-harness' && e.version !== undefined && e.version !== DSH_PINNED_TAG && e.version !== `dsh-v${DSH_PINNED_TAG}`) refuse('ADOPTION_DSH_TAG', ['deepseek-harness']);
      wanted.push({ id: e.id, ...(e.version !== undefined ? { version: e.id === 'deepseek-harness' ? DSH_PINNED_TAG : e.version } : {}), ...(e.model !== undefined ? { model: e.model } : {}) });
    }
  }
  const h = input.harness;
  if (h !== undefined && (h === null || typeof h !== 'object' || Object.keys(h).some(k => k !== 'id' && k !== 'description'))) refuse('ADOPTION_USAGE');
  if (h?.id !== undefined && !isId(h.id)) refuse('ADOPTION_USAGE');
  if (h?.description !== undefined && (typeof h.description !== 'string' || h.description.trim() === '' || [...h.description].length > 1024 || CONTROL.test(h.description))) refuse('ADOPTION_USAGE');
  const slug = basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  const harnessId = h?.id ?? (isId(slug) ? slug : 'adopted');
  const description = h?.description ?? 'Adopted from the engine files of this project.';
  const choices = input.choices ?? {};
  if (choices === null || typeof choices !== 'object' || Array.isArray(choices)) refuse('ADOPTION_USAGE');
  return { projectDir, wanted, harnessId, description, choices };
}

/**
 * The `.bowerloom` folder: none, or a 0.7 folder. A folder with `harness.json` is a definition already. A name that is
 * neither a 0.7 name nor the 0.7 skills folder would make the definition fail to load. Returns the 0.7 skill folders.
 */
function checkDefinitionFolder(r: ProjectReader): string[] {
  const k = r.kind('.bowerloom');
  if (k === null) return [];
  if (k !== 'dir') refuse('ADOPTION_PROJECT_UNSAFE', ['.bowerloom']);
  const listed = r.list('.bowerloom', 'legacy') ?? [];
  if (listed.some(e => e.name === 'harness.json')) refuse('ADOPTION_DEFINED', ['.bowerloom/harness.json']);
  const legacy = new Set<string>(LEGACY_NAMES);
  const odd = listed.filter(e => !legacy.has(e.name) && !(e.name === 'skills' && e.kind === 'dir') && !((e.name === '.DS_Store' || e.name === '.gitkeep') && e.kind === 'file'));
  if (odd.length) refuse('ADOPTION_FOLDER_OCCUPIED', odd.map(e => `.bowerloom/${e.name}`));
  return listed.some(e => e.name === 'skills') ? ['.bowerloom/skills'] : [];
}

// ---- ids and grouping ----------------------------------------------------------------------------------------------------

function withId(c: Candidate): Candidate {
  if (c.part === 'guardrails' && 'rule' in c) return { ...c, id: `${c.rule.effect}-${c.rule.action}-${sha8(c.rule)}` };
  if (c.part === 'hooks') return { ...c, id: `${kebab(c.hook.event).slice(0, 40).replace(/-+$/, '')}-${sha8(c.hook)}` };
  return c;
}

/** The content that decides whether two candidates are the same item, without private blocks and models. */
function neutralOf(c: Candidate): unknown {
  switch (c.part) {
    case 'system-prompt': return { text: c.text };
    case 'skills': return { data: c.skill.data, body: c.skill.body, main: c.skill.rawExecutable, files: c.skill.files.map(f => ({ p: f.path, s: sha(f.bytes), x: f.executable })) };
    case 'subagents': return c.subagent;
    case 'guardrails': return 'rule' in c ? c.rule : { sandbox: c.sandbox };
    case 'hooks': return c.hook;
    case 'mcp': return c.server;
    case 'engine-private': return { engine: c.engine, value: c.value };
  }
}
const modelsOf = (c: Candidate): Partial<Record<EngineId, string>> => c.part === 'subagents' ? c.models : {};

/** A merged variant: the candidates that are the same item. */
export interface Kept {
  readonly item: PlanItem;
  readonly lead: Candidate;
  readonly blocks: Partial<Record<EngineId, JsonValue>>;
  readonly models: Partial<Record<EngineId, string>>;
  readonly secrets: readonly Omit<SecretLine, 'part' | 'id'>[];
  readonly fixed: boolean;
}
interface Variant { key: string; cands: Candidate[]; places: Place[]; blocks: Partial<Record<EngineId, JsonValue>>; models: Partial<Record<EngineId, string>>; sha256: string; fixed: boolean }

function mergeable(cands: readonly Candidate[]): { blocks: Partial<Record<EngineId, JsonValue>>; models: Partial<Record<EngineId, string>> } | null {
  const blocks: Partial<Record<EngineId, JsonValue>> = {}, models: Partial<Record<EngineId, string>> = {};
  for (const c of cands) {
    for (const [e, b] of Object.entries(c.blocks) as [EngineId, JsonValue][]) { if (blocks[e] !== undefined && canonicalJson(blocks[e]) !== canonicalJson(b)) return null; blocks[e] = b; }
    for (const [e, m] of Object.entries(modelsOf(c)) as [EngineId, string][]) { if (models[e] !== undefined && models[e] !== m) return null; models[e] = m; }
  }
  return { blocks, models };
}

function variantsOf(cands: readonly Candidate[]): Variant[] {
  const byNeutral = new Map<string, Candidate[]>();
  for (const c of cands) { const k = sha(canonicalJson(neutralOf(c))); byNeutral.set(k, [...(byNeutral.get(k) ?? []), c]); }
  const out: Variant[] = [];
  const make = (list: Candidate[], m: { blocks: Partial<Record<EngineId, JsonValue>>; models: Partial<Record<EngineId, string>> }): void => {
    const places = list.map(c => c.place).sort(comparePlaces);
    out.push({ key: placeKey(places[0]!), cands: list, places, ...m, sha256: sha(canonicalJson({ n: neutralOf(list[0]!), b: m.blocks, m: m.models })), fixed: list.some(c => c.part === 'skills' && c.fixed) });
  };
  for (const list of byNeutral.values()) {
    const m = mergeable(list);
    if (m) { make(list, m); continue; }
    const byFull = new Map<string, Candidate[]>();
    for (const c of list) { const k = sha(canonicalJson({ b: c.blocks, m: modelsOf(c) })); byFull.set(k, [...(byFull.get(k) ?? []), c]); }
    for (const sub of byFull.values()) make(sub, mergeable(sub)!);
  }
  return out.sort((a, b) => byBytes(a.key, b.key));
}

const OPTIONS: Readonly<Record<ItemPart, readonly ('pick' | 'rename')[]>> = {
  'system-prompt': ['pick'], skills: ['pick', 'rename'], subagents: ['pick', 'rename'], guardrails: ['pick'], hooks: ['pick'], mcp: ['pick', 'rename'], 'engine-private': ['pick'],
};
const validId = (part: ItemPart, id: unknown): id is string => part === 'mcp' ? isServerName(id) : isId(id);

function engineFilter(places: readonly Place[], harness: readonly EngineId[]): EngineId[] | null {
  if (places.some(p => p.engines.length === 0)) return null;
  const set = new Set(places.flatMap(p => p.engines).filter(e => harness.includes(e)));
  const list = ENGINE_IDS.filter(e => set.has(e));
  return list.length === harness.length ? null : list;
}

function group(cands: readonly Candidate[], harness: readonly EngineId[], choices: Readonly<Record<string, AdoptionChoice>>, unmapped: Unmapped[]) {
  const groups = new Map<string, Candidate[]>();
  for (const c of cands) { const k = `${c.part}/${c.id}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const conflicts: Conflict[] = [];
  const kept: Kept[] = [];
  const keys = [...groups.keys()].sort(byBytes);
  const known = new Set<string>();
  const taken = new Map<ItemPart, Set<string>>();
  const use = (part: ItemPart, id: string): void => { const s = taken.get(part) ?? new Set(); s.add(id); taken.set(part, s); };
  for (const k of keys) { const [part, ...rest] = k.split('/'); use(part as ItemPart, rest.join('/')); }

  const keep = (v: Variant, id: string, engines: EngineId[] | null, extraNotes: readonly string[] = []): void => {
    const lead = v.cands.slice().sort((a, b) => comparePlaces(a.place, b.place))[0]!;
    const needs = [...new Set(v.cands.flatMap(c => c.needsApproval))];
    const notes = [...new Set([...v.cands.flatMap(c => c.notes), ...extraNotes])];
    const source = v.cands.find((c): c is Extract<Candidate, { part: 'skills' }> => c.part === 'skills' && c.source !== undefined)?.source;
    const secrets = v.cands.flatMap(c => c.secrets);
    const item: PlanItem = {
      part: lead.part, id, places: v.places, engines, privateBlocks: ENGINE_IDS.filter(e => v.blocks[e] !== undefined),
      needsApproval: [...needs, ...(secrets.length ? ['A literal secret was replaced with a ${NAME} reference. A person checks that the engine sets that variable.'] : [])],
      notes, ...(source ? { source } : {}),
    };
    kept.push({ item, lead, blocks: v.blocks, models: v.models, secrets, fixed: v.fixed });
  };

  for (const k of keys) {
    const list = groups.get(k)!;
    const part = list[0]!.part as ItemPart, id = list[0]!.id;
    const variants = variantsOf(list);
    if (variants.length === 1) { keep(variants[0]!, id, engineFilter(variants[0]!.places, harness)); continue; }
    const choice = Object.hasOwn(choices, k) ? choices[k]! : null;
    known.add(k);
    const conflict: Conflict = {
      key: k, part, id, variants: variants.map(v => ({ key: v.key, places: v.places, sha256: v.sha256, fixed: v.fixed })), options: OPTIONS[part], choice,
    };
    conflicts.push(conflict);
    if (choice === null) continue;
    applyChoice(conflict, choice, variants, harness, taken, keep, unmapped);
  }
  for (const k of Object.keys(choices)) if (!known.has(k)) refuse('ADOPTION_CHOICE_INVALID', [k.slice(0, 80)]);
  const items = kept.map(x => x.item).sort((a, b) => byBytes(`${a.part}/${a.id}`, `${b.part}/${b.id}`));
  kept.sort((a, b) => byBytes(`${a.item.part}/${a.item.id}`, `${b.item.part}/${b.item.id}`));
  return { items, conflicts, kept };
}

function applyChoice(
  c: Conflict, choice: AdoptionChoice, variants: readonly Variant[], harness: readonly EngineId[], taken: Map<ItemPart, Set<string>>,
  keep: (v: Variant, id: string, engines: EngineId[] | null, notes?: readonly string[]) => void, unmapped: Unmapped[],
): void {
  const bad = (): never => refuse('ADOPTION_CHOICE_INVALID', [c.key]);
  if (choice === null || typeof choice !== 'object' || Object.keys(choice).length !== 1) bad();
  if ('pick' in choice) {
    const v = variants.find(x => x.key === choice.pick) ?? bad();
    if (variants.some(x => x.fixed && x !== v)) bad();
    keep(v, c.id, engineFilter(variants.flatMap(x => x.places), harness), [`A person picked ${v.key} over the other variants.`]);
    for (const other of variants) if (other !== v) for (const p of other.places) unmapped.push({ path: p.path, ...(p.pointer !== undefined ? { pointer: p.pointer } : {}), part: c.part, reason: `Not adopted: a person picked ${v.key} for ${c.key}.` });
    return;
  }
  if (!('rename' in choice) || !c.options.includes('rename')) return bad();
  const rename = choice.rename;
  if (rename === null || typeof rename !== 'object' || Array.isArray(rename)) bad();
  const ids = new Map<Variant, string>();
  for (const [key, id] of Object.entries(rename)) {
    const v = variants.find(x => x.key === key) ?? bad();
    if (v.fixed || !validId(c.part, id) || id === c.id || taken.get(c.part)?.has(id)) bad();
    ids.set(v, id);
  }
  const final = variants.map(v => ids.get(v) ?? c.id);
  if (new Set(final).size !== final.length) bad();
  variants.forEach((v, i) => {
    const id = final[i]!;
    if (id !== c.id) { taken.get(c.part)?.add(id); }
    keep(v, id, engineFilter(v.places, harness), id === c.id ? [] : [`Kept under the id ${id}, as a person chose, because ${c.id} differs between places.`]);
  });
}

function differencesOf(kept: readonly Kept[]): Difference[] {
  const byPattern = new Map<string, Kept[]>();
  for (const k of kept) {
    if (k.lead.part !== 'guardrails' || !('rule' in k.lead)) continue;
    const key = `${k.lead.rule.action}\n${k.lead.rule.pattern}`;
    byPattern.set(key, [...(byPattern.get(key) ?? []), k]);
  }
  const out: Difference[] = [];
  for (const [key, list] of [...byPattern.entries()].sort(([a], [b]) => byBytes(a, b))) {
    const effects = new Set(list.map(k => (k.lead as Extract<Candidate, { rule: unknown }>).rule.effect));
    if (effects.size < 2) continue;
    const [action, pattern] = key.split('\n') as [Difference['action'], string];
    out.push({ action, pattern, rules: list.map(k => ({ id: k.item.id, effect: (k.lead as Extract<Candidate, { rule: unknown }>).rule.effect, engines: k.item.engines ?? [] })) });
  }
  return out;
}

function shapesOf(engine: EngineId, cands: readonly Candidate[]): PlanEngine['shapes'] {
  const seen = new Map<string, { path: string; shape: string; shapeVersion: string | null }>();
  for (const c of cands) {
    if (!c.place.engines.includes(engine) || c.place.kind !== 'engine') continue;
    const key = `${c.place.path}\n${c.place.shape}`;
    if (!seen.has(key)) seen.set(key, { path: c.place.path, shape: c.place.shape, shapeVersion: c.place.shapeVersion });
  }
  return [...seen.values()].sort((a, b) => byBytes(a.path, b.path) || byBytes(a.shape, b.shape));
}

/** Each 0.7 managed copy with the definition skill it became, found by the place of its canonical copy. */
function managedOf(list: readonly ManagedConversion[], kept: readonly Kept[], conflicts: readonly Conflict[]): ManagedConversion[] {
  return list.map(m => {
    if (m.kind !== 'skill' || m.copies.length === 0) return m;
    const canonical = m.copies.find(c => c.startsWith('.bowerloom/managed/skills/') || c.startsWith('.bowerloom-skills/skills/'));
    const k = kept.find(x => x.item.part === 'skills' && x.item.places.some(p => p.path === canonical));
    const copies = [...new Set([...m.copies, ...(k ? k.item.places.map(p => p.path) : [])])].sort(byBytes);
    if (k) return { ...m, skill: k.item.id, copies, reason: `Converted into the definition skill ${k.item.id}.${m.source ? '' : ` ${m.reason}`}` };
    const waiting = conflicts.some(c => c.choice === null && c.variants.some(v => v.places.some(p => p.path === canonical)));
    return { ...m, copies, reason: waiting ? 'Not converted yet: the copy is part of a conflict that waits for a choice.' : 'Not converted: the unmapped list says why.' };
  }).sort((a, b) => byBytes(a.catalog, b.catalog) || byBytes(a.id, b.id));
}

function dedupeUnmapped(list: readonly Unmapped[]): Unmapped[] {
  const seen = new Set<string>(), out: Unmapped[] = [];
  for (const u of list) { const k = canonicalJson(u); if (!seen.has(k)) { seen.add(k); out.push(u); } }
  return out.sort((a, b) => byBytes(a.path, b.path) || byBytes(a.pointer ?? '', b.pointer ?? '') || byBytes(a.reason, b.reason));
}

// ---- files -------------------------------------------------------------------------------------------------------------

interface BuildInput { harnessId: string; description: string; engines: readonly PlanEngine[]; items: readonly Kept[]; unmapped: Unmapped[]; warnings: string[] }

function xBlocks(blocks: Partial<Record<EngineId, JsonValue>>): Record<string, JsonValue> {
  return Object.fromEntries(ENGINE_IDS.filter(e => blocks[e] !== undefined).map(e => [`x-${e}`, blocks[e]!]));
}
const filterOf = (item: PlanItem): Record<string, JsonValue> => item.engines ? { engines: [...item.engines] } : {};

function buildFiles(b: BuildInput): Map<string, { bytes: Uint8Array; mode: number }> {
  const out = new Map<string, { bytes: Uint8Array; mode: number }>();
  const by = <P extends ItemPart>(part: P) => b.items.filter(k => k.item.part === part);
  const parts: Record<string, JsonValue> = {};
  const skillSettings: Record<string, JsonValue> = {};

  const prompt = by('system-prompt')[0];
  if (prompt && prompt.lead.part === 'system-prompt') { out.set('instructions/AGENTS.md', { bytes: prompt.lead.raw, mode: 0o644 }); parts['system-prompt'] = 'instructions/AGENTS.md'; }

  const skills = by('skills');
  for (const k of skills) {
    if (k.lead.part !== 'skills') continue;
    const id = k.item.id, copy = k.lead.skill;
    if (!k.fixed) {
      out.set(`skills/${id}/SKILL.md`, { bytes: skillMarkdown(copy, id), mode: copy.rawExecutable ? 0o755 : 0o644 });
      for (const f of copy.files) out.set(`skills/${id}/${f.path}`, { bytes: f.bytes, mode: f.executable ? 0o755 : 0o644 });
    }
    const settings = { ...filterOf(k.item), ...xBlocks(k.blocks) };
    if (Object.keys(settings).length) skillSettings[id] = settings;
  }
  if (skills.length) parts.skills = 'skills/';

  for (const k of by('subagents')) {
    if (k.lead.part !== 'subagents') continue;
    const s = k.lead.subagent;
    const fm: Record<string, JsonValue> = {
      name: k.item.id, description: s.description,
      ...(Object.keys(k.models).length ? { model: Object.fromEntries(ENGINE_IDS.filter(e => k.models[e] !== undefined).map(e => [e, k.models[e]!])) } : {}),
      ...(s.tools ? { tools: [...s.tools] } : {}), ...(s.skills ? { skills: [...s.skills] } : {}), ...filterOf(k.item), ...xBlocks(k.blocks),
    };
    out.set(`agents/${k.item.id}.md`, { bytes: Buffer.from(`---\n${stringify(fm, { aliasDuplicateObjects: false, lineWidth: 0 })}---\n${s.body}`), mode: 0o644 });
    parts.subagents = 'agents/';
  }

  const rules: Record<string, JsonValue>[] = [];
  let sandbox: Record<string, JsonValue> | null = null;
  for (const k of by('guardrails')) {
    if (k.lead.part !== 'guardrails') continue;
    if ('rule' in k.lead) rules.push({ id: k.item.id, ...k.lead.rule, ...filterOf(k.item), ...xBlocks(k.blocks) });
    else sandbox = { id: 'sandbox', files: k.lead.sandbox.files, network: k.lead.sandbox.network, strength: 'enforced', ...filterOf(k.item), ...xBlocks(k.blocks) };
  }
  if (rules.length || sandbox) { out.set('guardrails.json', { bytes: json({ rules, ...(sandbox ? { sandbox } : {}) }), mode: 0o644 }); parts.guardrails = 'guardrails.json'; }

  const hooks = by('hooks').flatMap(k => k.lead.part === 'hooks' ? [{ id: k.item.id, ...k.lead.hook, ...filterOf(k.item), ...xBlocks(k.blocks) }] : []);
  if (hooks.length) { out.set('hooks.json', { bytes: json({ hooks }), mode: 0o644 }); parts.hooks = 'hooks.json'; }

  const servers = by('mcp').flatMap(k => k.lead.part === 'mcp' ? [{ name: k.item.id, ...k.lead.server, ...filterOf(k.item), ...xBlocks(k.blocks) }] : []);
  if (servers.length) { out.set('mcp.json', { bytes: json({ servers }), mode: 0o644 }); parts.mcp = 'mcp.json'; }

  for (const k of by('engine-private')) if (k.lead.part === 'engine-private') out.set(k.item.id, { bytes: json(k.lead.value), mode: 0o644 });

  // sources.json: the npm and git sources of converted 0.7 managed copies, one record per package.
  const sources = new Map<string, { source: SourceShape; items: { part: 'skills'; id: string }[] }>();
  for (const k of skills) {
    const s = k.item.source;
    if (!s) continue;
    const key = `${s.marketplace}\n${s.name}`, at = sources.get(key);
    if (at && at.source.version !== s.version) { b.unmapped.push({ path: k.item.places[0]!.path, part: 'plugins', reason: `The source of ${k.item.id} names another pinned version of a package that another skill names too. sources.json holds one version per package, so this source is not recorded.` }); continue; }
    if (at) at.items.push({ part: 'skills', id: k.item.id }); else sources.set(key, { source: s, items: [{ part: 'skills', id: k.item.id }] });
  }
  if (sources.size) {
    const list = [...sources.values()].sort((a, c) => byBytes(`${a.source.marketplace}\n${a.source.name}`, `${c.source.marketplace}\n${c.source.name}`))
      .map(x => ({ name: x.source.name, marketplace: x.source.marketplace, version: x.source.version, items: x.items }));
    out.set('sources.json', { bytes: json({ sources: list }), mode: 0o644 }); parts.plugins = 'sources.json';
  }

  const harness = {
    format: HARNESS_FORMAT, id: b.harnessId, description: b.description,
    engines: b.engines.map(e => ({ id: e.id, ...(e.version !== null ? { version: e.version } : {}), ...(e.model !== null ? { model: e.model } : {}) })),
    parts: Object.fromEntries(['system-prompt', 'skills', 'subagents', 'guardrails', 'plugins', 'hooks', 'mcp'].filter(p => parts[p] !== undefined).map(p => [p, parts[p]!])),
    ...(Object.keys(skillSettings).length ? { skills: Object.fromEntries(Object.keys(skillSettings).sort(byBytes).map(id => [id, skillSettings[id]!])) } : {}),
  };
  out.set('harness.json', { bytes: json(harness), mode: 0o644 });
  return out;
}

/**
 * Loads the planned files with the contract's loader, in a scratch folder outside the project. The 0.7 skills already in
 * `.bowerloom/skills` join them, since the loader reads them as definition skills.
 */
function validate(files: ReadonlyMap<string, { bytes: Uint8Array; mode: number }>, kept: readonly Kept[]): { problems: Problem[]; revision: string | null } {
  const scratch = fs.mkdtempSync(join(os.tmpdir(), 'bowerloom-adoption-check-'));
  try {
    const root = join(scratch, '.bowerloom');
    const put = (rel: string, bytes: Uint8Array, mode: number): void => { const at = join(root, rel); fs.mkdirSync(dirname(at), { recursive: true, mode: 0o700 }); fs.writeFileSync(at, bytes, { mode }); fs.chmodSync(at, mode); };
    for (const [rel, f] of files) put(rel, f.bytes, f.mode);
    for (const k of kept) {
      if (!k.fixed || k.lead.part !== 'skills') continue;
      put(`skills/${k.item.id}/SKILL.md`, k.lead.skill.raw, k.lead.skill.rawExecutable ? 0o755 : 0o644);
      for (const f of k.lead.skill.files) put(`skills/${k.item.id}/${f.path}`, f.bytes, f.executable ? 0o755 : 0o644);
    }
    const r = loadDefinition(root);
    return r.ok ? { problems: [], revision: r.definition.revision } : { problems: [...r.problems], revision: null };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
