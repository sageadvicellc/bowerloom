/**
 * The seeded sample world of the Bowerloom 0.8 prototype (spec 11, "Prototype rules").
 * `generateWorld(seed)` builds the same World, byte for byte, for the same seed. It reads no file, no clock and no system random source.
 * Every name comes from the fixed lists in `SAMPLE_WORDS`. They are invented: no person, client, company, product, skill or project of the real
 * setup is named here. The scale is the one the spec asks for: 700 wiki pages, about 50 owned skills and 120 library agents.
 * Four cases are planted at fixed ids (`CASE_IDS`): a skill with three texts, a library item with a newer version, a hidden global skill,
 * and a hook plus an MCP server whose secret reference points at nothing.
 */
import { createRng } from './rng.js';
import type { Rng } from './rng.js';
import { matchPages } from './slicerule.js';
import { INTERFACE_WORDS } from './words.js';
import type {
  AccessClass, AgentItem, FoundAt, HarnessItem, InterfaceExtra, InterfaceId, InterfaceInfo, LibrarySource, McpTool, Override, PromptTool, Scope, SkillItem,
  Slice, ToolAttachment, ToolItem, WikiPage, World,
} from './types.js';

/** The invented word lists every name is made from. Folder names, tags and types are listed whole. Names are built from these words only. */
export const SAMPLE_WORDS = {
  adjectives: ['brisk', 'amber', 'mossy', 'quiet', 'tidal', 'velvet', 'copper', 'dusky', 'lunar', 'nimble', 'hollow', 'gentle', 'rustic', 'silken', 'frosty', 'sunlit', 'wintry', 'crisp', 'plucky', 'mellow', 'cobalt', 'ember', 'pebbled', 'fabled', 'gilded', 'humble', 'ivory', 'jaunty', 'knotted', 'lilting'],
  nouns: ['ledger', 'lantern', 'compass', 'kettle', 'anvil', 'beacon', 'thimble', 'quill', 'sprocket', 'satchel', 'pylon', 'ferry', 'mortar', 'bobbin', 'cobble', 'thistle', 'tallow', 'wicker', 'barrow', 'bellows', 'crucible', 'dovetail', 'gantry', 'hearth', 'inkwell', 'jetty', 'keystone', 'latch', 'mallet', 'nutmeg'],
  roles: ['cartographer', 'courier', 'warden', 'archivist', 'tinkerer', 'forager', 'scribe', 'navigator', 'steward', 'surveyor', 'weaver', 'cooper'],
  domains: ['brindle', 'sedgefield', 'quillmoor', 'tarnwick', 'marrowdeep', 'alderhythe', 'cinderlow', 'fennrow'],
  subfolders: ['tidepool', 'wicklow', 'harrow', 'pennon', 'dunlin', 'corbel', 'sallow', 'thrum', 'bracken', 'linnet', 'ostler', 'rushlight', 'kestrel', 'moorgate', 'yarrow', 'teasel', 'galley', 'fernhill', 'sloe', 'mizzen', 'cranny', 'dapple', 'eddy', 'furrow', 'gorse', 'heddle', 'inglenook', 'lumen', 'nettle', 'osier'],
  types: ['concept', 'guide', 'record', 'recipe', 'survey', 'sketch'],
  tags: ['fennel', 'cobweb', 'pennant', 'ripple', 'lattice', 'sundial', 'bramble', 'quartz', 'cinder', 'dewline', 'mosswork', 'fernside'],
  scopeNames: ['Studio', 'Reedmarsh', 'Copperfen', 'Tallowbrook'],
  libraryWords: ['Evergreen', 'Kit'],
} as const;

/** The fixed ids of the planted cases and of the scope and library they use. The same for every seed. */
export const CASE_IDS = {
  /** (a) A skill found in three interfaces with three different texts. */
  tripleSkill: 'skill-triple',
  /** (b) The one library item with a newer version waiting. */
  newerLibraryItem: 'agent-lib-newer',
  /** (b) The library that item belongs to. Its source also shows the newer version. */
  newerLibrary: 'evergreen-kit',
  /** (b) The global skill that a project hides. */
  hiddenSkill: 'skill-hidden',
  /** (b) The project scope that hides it. */
  hidingScope: 'scope-reedmarsh',
  /** (c) A hook, which runs code. */
  hook: 'tool-hook-guard',
  /** (d) An MCP server whose secret reference points at nothing. */
  mcpMissing: 'tool-mcp-missing',
  /** (d) An MCP server whose secret reference points at something. */
  mcpPresent: 'tool-mcp-present',
} as const;

const PAGE_COUNT = 700, LINKED_PAGES = PAGE_COUNT - Math.round(PAGE_COUNT * 2 / 3), LIBRARY_AGENTS = 120, OWNED_AGENTS = 10, GLOBAL_SKILLS = 44, PROJECT_SKILLS = 8;
const ROOT = '/Users/sample/Studio', CACHE = '/Users/sample/.cache/evergreen-kit/2.3.0';
const INTERFACES: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];
const FOLDER: Record<InterfaceId, string> = { 'claude-code': '.claude', codex: '.codex', opencode: '.opencode' };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const cap = (word: string): string => word.slice(0, 1).toUpperCase() + word.slice(1);
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** A short fingerprint of a text (two 32-bit FNV-1a passes, 16 hex digits). Not a security hash: it only tells two texts apart. */
export function hashText(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function sentence(rng: Rng): string {
  const a = (): string => rng.pick(SAMPLE_WORDS.adjectives), n = (): string => rng.pick(SAMPLE_WORDS.nouns);
  const options = [
    () => `Check the ${a()} ${n()} before you touch the ${n()}.`,
    () => `Keep the ${n()} close to the ${a()} ${n()}.`,
    () => `A ${a()} ${n()} tells you when the ${n()} is ready.`,
    () => `Write down what the ${a()} ${n()} did, then move the ${n()}.`,
    () => `Never leave a ${a()} ${n()} beside the ${n()}.`,
    () => `The ${n()} and the ${n()} share one ${a()} rule.`,
  ];
  return rng.pick(options)();
}
const paragraph = (rng: Rng, count: number): string => Array.from({ length: count }, () => sentence(rng)).join(' ');

/** The unique, shuffled list of every combination of two lists, used so that no two items share a name. */
function combos(rng: Rng, first: readonly string[], second: readonly string[]): string[] {
  return rng.shuffle(first.flatMap(a => second.map(b => `${a}-${b}`)));
}

function foundIn(scopePath: string, relative: (i: InterfaceId) => string, text: (i: InterfaceId) => string, interfaces: readonly InterfaceId[]): FoundAt[] {
  return interfaces.map(i => { const t = text(i); return { interface: i, path: `${scopePath}/${relative(i)}`, contentHash: hashText(t), text: t }; });
}

function someInterfaces(rng: Rng): InterfaceId[] {
  const r = rng.next(), n = r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
  const chosen = new Set(rng.shuffle(INTERFACES).slice(0, n));
  return INTERFACES.filter(i => chosen.has(i));
}

// ---- Wiki pages ----

function makePages(rng: Rng): Mutable<WikiPage>[] {
  const domains = rng.shuffle(SAMPLE_WORDS.domains);
  const folders: string[] = [];
  for (const d of domains) for (const s of rng.shuffle(SAMPLE_WORDS.subfolders).slice(0, rng.int(3, 6))) folders.push(`${d}/${s}`);
  // Every folder gets one page first, so the tree has no empty branch. The rest fall where they fall.
  const placed = rng.shuffle(Array.from({ length: PAGE_COUNT }, (_, i) => (i < folders.length ? folders[i]! : rng.pick(folders))));
  const titles = new Set<string>();
  const pages: Mutable<WikiPage>[] = placed.map((folder, i) => {
    let title = '';
    do { title = `${cap(rng.pick(SAMPLE_WORDS.adjectives))} ${rng.pick(SAMPLE_WORDS.nouns)} ${rng.pick(SAMPLE_WORDS.nouns)}`; } while (titles.has(title));
    titles.add(title);
    const tags = rng.shuffle(SAMPLE_WORDS.tags).slice(0, rng.int(0, 3));
    const bytes = 600 + Math.floor(rng.next() * rng.next() * 23400);
    return { id: `page-${pad(i + 1, 4)}`, title, folder, type: rng.pick(SAMPLE_WORDS.types), tags, summary: sentence(rng), bytes, links: [], joinedSinceVisit: false };
  });
  // About two thirds of the pages link to nothing. The rest link to 1 to 8 other pages, most of them in their own domain.
  const byDomain = new Map<string, Mutable<WikiPage>[]>();
  for (const p of pages) { const d = p.folder.split('/')[0]!; byDomain.set(d, [...(byDomain.get(d) ?? []), p]); }
  for (const index of rng.shuffle(pages.map((_, i) => i)).slice(0, LINKED_PAGES)) {
    const page = pages[index]!, near = byDomain.get(page.folder.split('/')[0]!)!, want = rng.int(1, 8), targets = new Set<string>();
    while (targets.size < want) {
      const other = rng.next() < 0.6 ? rng.pick(near) : rng.pick(pages);
      if (other.id !== page.id) targets.add(other.id);
    }
    page.links = [...targets];
  }
  return pages;
}

// ---- Items ----

const textOfSkill = (name: string, description: string, body: string): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

function makeSkills(rng: Rng, names: string[], scopes: readonly Scope[]): SkillItem[] {
  const global = scopes[0]!, projects = scopes.slice(1), skills: SkillItem[] = [];
  const total = GLOBAL_SKILLS + PROJECT_SKILLS;
  for (let i = 0; i < total; i += 1) {
    const isGlobal = i < GLOBAL_SKILLS, scope = isGlobal ? global : projects[(i - GLOBAL_SKILLS) % projects.length]!;
    const id = i === 0 ? CASE_IDS.tripleSkill : i === 1 ? CASE_IDS.hiddenSkill : isGlobal ? `skill-${pad(i + 1, 3)}` : `skill-proj-${i - GLOBAL_SKILLS + 1}`;
    const name = names.pop()!, description = sentence(rng), body = paragraph(rng, 3);
    const relative = (face: InterfaceId): string => `${FOLDER[face]}/skills/${name}/SKILL.md`;
    // The first skill is the planted case: three interfaces, three different texts.
    const text = i === 0
      ? (face: InterfaceId): string => textOfSkill(name, description, `${paragraph(rng, 2)}\nWritten for ${INTERFACE_WORDS[face]}.`)
      : (): string => textOfSkill(name, description, body);
    const foundAt = i === 0 ? foundIn(scope.path, relative, text, INTERFACES) : foundIn(scope.path, relative, text, someInterfaces(rng));
    skills.push({ id, kind: 'skill', name, scopeId: scope.id, foundAt, library: null, description });
  }
  return skills;
}

function makeTools(rng: Rng, names: string[], scopes: readonly Scope[]): ToolItem[] {
  const global = scopes[0]!, projects = scopes.slice(1), tools: ToolItem[] = [];
  const mcpSpecs: { id: string; secret: McpTool['secret']; scope: Scope }[] = [
    { id: CASE_IDS.mcpMissing, secret: null, scope: global },
    { id: CASE_IDS.mcpPresent, secret: null, scope: global },
    { id: 'tool-mcp-01', secret: null, scope: global },
    { id: 'tool-mcp-02', secret: null, scope: projects[0]! },
    { id: 'tool-mcp-03', secret: null, scope: projects[1]! },
  ];
  mcpSpecs.forEach((spec, i) => {
    const name = names.pop()!, envName = `${name.split('-')[1]!.toUpperCase()}_TOKEN`;
    const secret: McpTool['secret'] = spec.id === CASE_IDS.mcpMissing ? { kind: 'env', name: envName, state: 'missing' }
      : spec.id === CASE_IDS.mcpPresent ? { kind: 'keychain', name: `${name.split('-')[0]!.toUpperCase()}_KEY`, state: 'present' }
        : i === 2 ? null : { kind: 'env', name: envName, state: 'present' };
    const text = `{"server":"${name}","address":"local://${name}","secret":${secret === null ? 'null' : `"${secret.name}"`}}\n`;
    const foundAt = foundIn(spec.scope.path, face => (face === 'codex' ? `${FOLDER[face]}/config.toml` : face === 'opencode' ? 'opencode.json' : '.mcp.json'), () => text, i === 1 ? INTERFACES : ['claude-code']);
    tools.push({ id: spec.id, kind: 'tool', toolKind: 'mcp', name, scopeId: spec.scope.id, foundAt, library: null, secret });
  });
  for (let i = 0; i < 6; i += 1) {
    const name = names.pop()!, scope = i < 4 ? global : projects[i - 4]!;
    const promptText = `${paragraph(rng, 2)}\n`;
    const foundAt = foundIn(scope.path, face => (face === 'codex' ? `${FOLDER[face]}/prompts/${name}.md` : `${FOLDER[face]}/commands/${name}.md`), () => promptText, i % 2 === 0 ? ['claude-code', 'codex'] : ['claude-code']);
    const prompt: PromptTool = { id: `tool-prompt-${pad(i + 1, 2)}`, kind: 'tool', toolKind: 'prompt', name, scopeId: scope.id, foundAt, library: null };
    tools.push(prompt);
  }
  ['tool-hook-guard', 'tool-hook-02', 'tool-hook-03'].forEach((id, i) => {
    const name = names.pop()!, scope = i === 0 ? global : projects[i - 1]!;
    const foundAt = foundIn(scope.path, face => `${FOLDER[face]}/settings.json`, () => `{"hooks":{"after-edit":[{"run":"./hooks/${name}.sh"}]}}\n`, ['claude-code']);
    tools.push({ id, kind: 'tool', toolKind: 'hook', name, scopeId: scope.id, foundAt, library: null, runsCode: true });
  });
  return tools;
}

function makeAgents(rng: Rng, names: string[], skills: readonly SkillItem[], tools: readonly ToolItem[], scopes: readonly Scope[], sliceIds: readonly string[]): AgentItem[] {
  const agents: AgentItem[] = [];
  const attachable = tools.filter(t => t.toolKind !== 'hook');
  const globalSkills = skills.filter(s => s.scopeId === scopes[0]!.id);
  const access = (): AccessClass => rng.pick(['read-only', 'read-write'] as const);
  // Library agents: read-only copies from one installed library, found in one interface's cache.
  for (let i = 0; i < LIBRARY_AGENTS; i += 1) {
    const name = names.pop()!, role = name.split('-')[1]!;
    const newer = i === 0;
    const text = `# ${name}\nrole: ${role}\n\n${paragraph(rng, 2)}\n`;
    agents.push({
      id: newer ? CASE_IDS.newerLibraryItem : `agent-lib-${pad(i, 3)}`, kind: 'agent', name, scopeId: scopes[0]!.id,
      foundAt: [{ interface: 'claude-code', path: `${CACHE}/agents/${name}.md`, contentHash: hashText(text), text }],
      library: newer ? { library: CASE_IDS.newerLibrary, pinnedVersion: '2.3.0', newerVersion: '2.4.0' } : { library: CASE_IDS.newerLibrary, pinnedVersion: '2.3.0' },
      definition: { name, role, instructions: paragraph(rng, 2), skillIds: [], toolAttachments: [] }, extras: [],
    });
  }
  // Owned agents: they name skills, attach tools with an access class, and some read a slice.
  for (let i = 0; i < OWNED_AGENTS; i += 1) {
    const name = names.pop()!, role = name.split('-')[1]!, scope = i < 8 ? scopes[0]! : scopes[1 + (i - 8)]!;
    const skillIds = rng.shuffle(globalSkills.filter(s => s.id !== CASE_IDS.hiddenSkill)).slice(0, rng.int(2, 5)).map(s => s.id);
    const first = i === 0 ? CASE_IDS.mcpMissing : i === 1 ? CASE_IDS.mcpPresent : null;
    const pool = rng.shuffle(attachable.filter(t => t.id !== CASE_IDS.mcpMissing && t.id !== CASE_IDS.mcpPresent));
    const toolIds = [...(first === null ? [] : [first]), ...pool.slice(0, i % 3).map(t => t.id)];
    const toolAttachments: ToolAttachment[] = toolIds.map(toolId => ({ toolId, access: access() }));
    const definition = { name, role, instructions: paragraph(rng, 3), skillIds, toolAttachments, ...(i < 4 ? { sliceId: sliceIds[i % sliceIds.length]! } : {}) };
    const extras: InterfaceExtra[] = i % 3 === 0 ? [{ interface: INTERFACES[i % INTERFACES.length]!, badge: `${INTERFACE_WORDS[INTERFACES[i % INTERFACES.length]!]} only`, key: 'accent', value: rng.pick(SAMPLE_WORDS.adjectives) }] : [];
    const text = `# ${name}\nrole: ${role}\n\n${definition.instructions}\n`;
    const foundAt = foundIn(scope.path, face => `${FOLDER[face]}/agents/${name}.${face === 'codex' ? 'toml' : 'md'}`, () => text, someInterfaces(rng));
    agents.push({ id: `agent-${pad(i + 1, 2)}`, kind: 'agent', name, scopeId: scope.id, foundAt, library: null, definition, extras });
  }
  return agents;
}

// ---- Slices ----

function makeSlices(rng: Rng, pages: readonly WikiPage[]): Slice[] {
  const folders = [...new Set(pages.map(p => p.folder))].sort(), domains = [...new Set(folders.map(f => f.split('/')[0]!))].sort();
  const wholeDomain = domains[0]!, oneFolder = folders.find(f => !f.startsWith(`${wholeDomain}/`))!;
  const inFolders = pages.filter(p => p.folder === oneFolder || p.folder.startsWith(`${wholeDomain}/`));
  const mostLinked = [...pages].sort((x, y) => y.links.length - x.links.length || (x.id < y.id ? -1 : 1)).slice(0, 3).map(p => p.id);
  const adj = SAMPLE_WORDS.adjectives, noun = SAMPLE_WORDS.nouns;
  return [
    { id: 'slice-folders', name: `${cap(wholeDomain)} ${rng.pick(noun)}`, seeds: inFolders.slice(0, 2).map(p => p.id), rule: { folders: [wholeDomain, oneFolder], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false },
    { id: 'slice-kinds', name: `${cap(rng.pick(adj))} ${rng.pick(noun)}`, seeds: [], rule: { folders: [], pageTypesAndTags: { types: [SAMPLE_WORDS.types[1]], tags: [SAMPLE_WORDS.tags[0], SAMPLE_WORDS.tags[7]] }, linksFromSeeds: null }, pinned: false },
    { id: 'slice-seeds', name: `${cap(rng.pick(adj))} ${rng.pick(noun)}`, seeds: mostLinked, rule: { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: { hops: 2 } }, pinned: false },
  ];
}

/** Builds the whole sample world. The same seed gives the same JSON, byte for byte. */
export function generateWorld(seed = 1): World {
  const rng = createRng(seed);
  const interfaces: InterfaceInfo[] = [
    { id: 'claude-code', installed: 'installed', notice: null, enforcement: 'blocks reads' },
    { id: 'codex', installed: 'installed', notice: null, enforcement: 'advisory only' },
    { id: 'opencode', installed: 'installed', notice: null, enforcement: 'advisory only' },
  ];
  const [studio, reed, fen, brook] = SAMPLE_WORDS.scopeNames;
  const scopes: Scope[] = [
    { id: 'global', kind: 'global', name: studio, parentId: null, path: ROOT },
    ...([[CASE_IDS.hidingScope, reed], ['scope-copperfen', fen], ['scope-tallowbrook', brook]] as const).map(([id, name]): Scope => ({ id, kind: 'project', name, parentId: 'global', path: `${ROOT}/${name.toLowerCase()}` })),
  ];

  const pages = makePages(rng);
  const slices = makeSlices(rng, pages);
  // Three pages joined the first live slice since the last visit.
  const first = slices[0]!, inFirst = matchPages(first.rule, first.seeds, pages);
  for (const p of rng.shuffle(pages.filter(page => inFirst.has(page.id) && !first.seeds.includes(page.id))).slice(0, 3)) p.joinedSinceVisit = true;

  const names = combos(rng, SAMPLE_WORDS.adjectives, SAMPLE_WORDS.nouns);
  const agentNames = combos(rng, SAMPLE_WORDS.adjectives, SAMPLE_WORDS.roles);
  const skills = makeSkills(rng, names, scopes);
  const tools = makeTools(rng, names, scopes);
  const agents = makeAgents(rng, agentNames, skills, tools, scopes, slices.map(s => s.id));
  const sliceItems: HarnessItem[] = slices.map(s => ({ id: `item-${s.id}`, kind: 'context-slice', name: s.name, scopeId: 'global', foundAt: [], library: null, sliceId: s.id }));

  const projectSkill = skills.find(s => s.scopeId === 'scope-copperfen' && s.library === null && s.id.startsWith('skill-proj-'))!;
  const overrides: Override[] = [
    { scopeId: CASE_IDS.hidingScope, itemId: CASE_IDS.hiddenSkill, mode: 'hide' },
    { scopeId: 'scope-copperfen', itemId: 'skill-005', mode: 'replace', replacementItemId: projectSkill.id },
  ];
  const libraries: LibrarySource[] = [{ id: CASE_IDS.newerLibrary, name: SAMPLE_WORDS.libraryWords.join(' '), installedVersion: '2.3.0', newerVersion: '2.4.0' }];

  return { interfaces, items: [...skills, ...agents, ...tools, ...sliceItems], scopes, overrides, wikiPages: pages, slices, versions: [], libraries };
}

// ---- Reference check ----

/** Lists every problem in a world: a repeated id, a missing reference, a dangling link, a wrong hash. An empty list means the world is valid. */
export function validateWorld(world: World): string[] {
  const problems: string[] = [];
  const dup = (kind: string, ids: readonly string[]): void => { const seen = new Set<string>(); for (const id of ids) { if (seen.has(id)) problems.push(`${kind} id repeated: ${id}`); seen.add(id); } };
  dup('interface', world.interfaces.map(i => i.id)); dup('scope', world.scopes.map(s => s.id)); dup('item', world.items.map(i => i.id));
  dup('page', world.wikiPages.map(p => p.id)); dup('slice', world.slices.map(s => s.id)); dup('library', world.libraries.map(l => l.id)); dup('version', world.versions.map(v => v.id));

  const scopes = new Map(world.scopes.map(s => [s.id, s])), items = new Map(world.items.map(i => [i.id, i]));
  const pageIds = new Set(world.wikiPages.map(p => p.id)), sliceIds = new Set(world.slices.map(s => s.id)), libraries = new Map(world.libraries.map(l => [l.id, l]));
  const faces = new Set<string>(INTERFACES);

  if (world.scopes.filter(s => s.kind === 'global').length !== 1) problems.push('there must be exactly one global scope');
  for (const s of world.scopes) {
    if (s.kind === 'global' && s.parentId !== null) problems.push(`global scope ${s.id} has a parent`);
    if (s.kind === 'project' && (s.parentId === null || !scopes.has(s.parentId))) problems.push(`project scope ${s.id} has a missing parent ${s.parentId}`);
  }
  for (const i of world.interfaces) if (!faces.has(i.id)) problems.push(`unknown interface ${i.id}`);

  for (const item of world.items) {
    if (!scopes.has(item.scopeId)) problems.push(`item ${item.id} is in missing scope ${item.scopeId}`);
    const seen = new Set<string>();
    for (const f of item.foundAt) {
      if (!faces.has(f.interface)) problems.push(`item ${item.id} found in unknown interface ${f.interface}`);
      if (seen.has(f.interface)) problems.push(`item ${item.id} found twice in ${f.interface}`);
      seen.add(f.interface);
      if (f.path === '') problems.push(`item ${item.id} has an empty path`);
      if (f.contentHash !== hashText(f.text)) problems.push(`item ${item.id} has a wrong hash in ${f.interface}`);
    }
    if (item.library !== null) {
      const source = libraries.get(item.library.library);
      if (source === undefined) problems.push(`item ${item.id} names missing library ${item.library.library}`);
      else {
        if (item.library.pinnedVersion !== source.installedVersion) problems.push(`item ${item.id} is pinned to ${item.library.pinnedVersion}, not the installed ${source.installedVersion}`);
        if (item.library.newerVersion !== undefined && item.library.newerVersion !== source.newerVersion) problems.push(`item ${item.id} shows a newer version its library does not`);
      }
    }
    if (item.kind === 'context-slice' && !sliceIds.has(item.sliceId)) problems.push(`item ${item.id} names missing slice ${item.sliceId}`);
    if (item.kind === 'agent') {
      for (const id of item.definition.skillIds) if (items.get(id)?.kind !== 'skill') problems.push(`agent ${item.id} names ${id}, which is not a skill`);
      for (const t of item.definition.toolAttachments) if (items.get(t.toolId)?.kind !== 'tool') problems.push(`agent ${item.id} attaches ${t.toolId}, which is not a tool`);
      if (item.definition.sliceId !== undefined && !sliceIds.has(item.definition.sliceId)) problems.push(`agent ${item.id} names missing slice ${item.definition.sliceId}`);
    }
    if (item.kind === 'tool' && item.toolKind === 'hook' && item.runsCode !== true) problems.push(`hook ${item.id} does not run code`);
  }
  for (const source of world.libraries) if (source.newerVersion === source.installedVersion) problems.push(`library ${source.id} lists its own version as newer`);

  for (const o of world.overrides) {
    if (!scopes.has(o.scopeId)) problems.push(`override names missing scope ${o.scopeId}`);
    else if (scopes.get(o.scopeId)!.kind !== 'project') problems.push(`override is on non-project scope ${o.scopeId}`);
    if (!items.has(o.itemId)) problems.push(`override names missing item ${o.itemId}`);
    if (o.mode === 'replace' && (o.replacementItemId === undefined || !items.has(o.replacementItemId))) problems.push(`replace override on ${o.itemId} has no valid replacement`);
    if (o.mode !== 'replace' && o.replacementItemId !== undefined) problems.push(`override on ${o.itemId} has a replacement but is not a replace`);
  }

  for (const p of world.wikiPages) {
    if (!Number.isInteger(p.bytes) || p.bytes <= 0) problems.push(`page ${p.id} has bad bytes ${p.bytes}`);
    const seen = new Set<string>();
    for (const t of p.links) {
      if (!pageIds.has(t)) problems.push(`page ${p.id} links to missing page ${t}`);
      if (t === p.id) problems.push(`page ${p.id} links to itself`);
      if (seen.has(t)) problems.push(`page ${p.id} links to ${t} twice`);
      seen.add(t);
    }
  }
  for (const s of world.slices) {
    for (const id of s.seeds) if (!pageIds.has(id)) problems.push(`slice ${s.id} has missing seed ${id}`);
    for (const id of s.pinnedPageIds ?? []) if (!pageIds.has(id)) problems.push(`slice ${s.id} pins missing page ${id}`);
    const hops = s.rule.linksFromSeeds?.hops;
    if (s.rule.linksFromSeeds !== null && hops !== 1 && hops !== 2) problems.push(`slice ${s.id} has bad hops`);
    if (s.pinned && s.pinnedPageIds === undefined) problems.push(`slice ${s.id} is pinned without a page list`);
  }
  const versionIds = new Set(world.versions.map(v => v.id));
  for (const v of world.versions) if (v.parentId !== null && !versionIds.has(v.parentId)) problems.push(`version ${v.id} has missing parent ${v.parentId}`);
  return problems;
}
