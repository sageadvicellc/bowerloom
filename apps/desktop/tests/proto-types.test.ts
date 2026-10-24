// The prototype's data model: shared/proto/types.ts is types only, and createEmptyWorld makes a valid, plain-JSON World.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as typesModule from '../shared/proto/types.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';
import type {
  AccessClass, AgentDefinition, AgentItem, Bundle, BundleItem, ContextSliceItem, Enforcement, FoundAt, HarnessItem, HarnessItemKind, HookTool,
  ImportClash, ImportFile, ImportGrant, ImportPreview, InstalledState, InterfaceExtra, InterfaceId, InterfaceInfo, LibraryRef, LibrarySource, McpTool,
  Override, OverrideMode, Plan, PlanChange, PromptTool, Scope, ScopeKind, SecretRef, SecretSlot, SkillItem, Slice, SliceRule, ToolAttachment,
  ToolItem, ToolKind, ToolReference, Version, WikiPage, World,
} from '../shared/proto/types.js';
import { DESKTOP } from './support.js';

const secret: SecretRef = { kind: 'env', name: 'EXAMPLE_TOKEN', state: 'missing' };
const found: FoundAt = { interface: 'claude-code', path: '/sample/a/SKILL.md', contentHash: 'h1', text: 'one' };
const lib: LibraryRef = { library: 'example-lib', pinnedVersion: '1.0.0', newerVersion: '1.1.0' };
const rule: SliceRule = { folders: ['notes'], pageTypesAndTags: { types: ['concept'], tags: ['a'] }, linksFromSeeds: { hops: 2 } };
const skill: SkillItem = { id: 's1', kind: 'skill', name: 'Skill', scopeId: 'global', foundAt: [found], library: lib, description: 'd' };
const attachment: ToolAttachment = { toolId: 't1', access: 'read-only' };
const definition: AgentDefinition = { name: 'A', role: 'r', instructions: 'i', skillIds: ['s1'], toolAttachments: [attachment], sliceId: 'sl1' };
const extra: InterfaceExtra = { interface: 'codex', badge: 'Codex only', key: 'k', value: 'v' };
const agent: AgentItem = { id: 'a1', kind: 'agent', name: 'Agent', scopeId: 'global', foundAt: [], library: null, definition, extras: [extra] };
const mcp: McpTool = { id: 't1', kind: 'tool', toolKind: 'mcp', name: 'Mcp', scopeId: 'global', foundAt: [], library: null, secret };
const prompt: PromptTool = { id: 't2', kind: 'tool', toolKind: 'prompt', name: 'Prompt', scopeId: 'global', foundAt: [], library: null };
const hook: HookTool = { id: 't3', kind: 'tool', toolKind: 'hook', name: 'Hook', scopeId: 'global', foundAt: [], library: null, runsCode: true };
const contextSlice: ContextSliceItem = { id: 'c1', kind: 'context-slice', name: 'Slice item', scopeId: 'global', foundAt: [], library: null, sliceId: 'sl1' };
const slice: Slice = { id: 'sl1', name: 'Slice', seeds: ['p1'], rule, pinned: true, pinnedPageIds: ['p1'] };
const page: WikiPage = { id: 'p1', title: 'T', folder: 'notes', type: 'concept', tags: ['a'], summary: 's', bytes: 10, links: ['p2'], joinedSinceVisit: false };
const scope: Scope = { id: 'global', kind: 'global', name: 'Global', parentId: null, path: '/sample/harness' };
const override: Override = { scopeId: 'p', itemId: 's1', mode: 'replace', replacementItemId: 's2' };
const version: Version = { id: 'v1', parentId: null, counter: 1, label: 'first', snapshotJson: '{}' };
const info: InterfaceInfo = { id: 'opencode', installed: 'installed', notice: null, enforcement: 'advisory only' };
const source: LibrarySource = { id: 'example-lib', name: 'Example', installedVersion: '1.0.0', newerVersion: '1.1.0' };
const change: PlanChange = { interface: 'codex', path: '/sample/x', action: 'add', preview: 'text' };
const plan: Plan = { changes: [change] };
const slot: SecretSlot = { kind: 'keychain', name: 'EXAMPLE' };
const toolRef: ToolReference = { toolId: 't1', name: 'Mcp', toolKind: 'mcp', secret: slot };
const bundleItem: BundleItem = skill;
const bundle: Bundle = { scopeIds: ['global'], items: [bundleItem, agent], toolRefs: [toolRef], sliceRules: [{ sliceId: 'sl1', name: 'Slice', rule }] };
const importFile: ImportFile = { path: '/sample/y', action: 'change', characters: 12 };
const grant: ImportGrant = { agent: 'Planner', tool: 'Mcp', access: 'read-only' };
const clash: ImportClash = { itemId: 's1', name: 'Skill', reason: 'different-text' };
const importPreview: ImportPreview = { files: [importFile], secretsToAdd: [slot], clashes: [clash], grants: [grant], missingRefs: ['skill lib-skill, used by Planner'] };
const world: World = { interfaces: [info], items: [skill, agent, mcp, prompt, hook, contextSlice], scopes: [scope], overrides: [override], wikiPages: [page], slices: [slice], versions: [version], libraries: [source] };

// One entry per exported type name. A name in the file but not here, or here but not in the file, fails the test below.
const SAMPLES: Record<string, unknown> = {
  AccessClass: 'read-write' satisfies AccessClass, AgentDefinition: definition, AgentItem: agent, Bundle: bundle, BundleItem: bundleItem, ContextSliceItem: contextSlice,
  Enforcement: 'blocks reads' satisfies Enforcement, FoundAt: found, HarnessItem: skill satisfies HarnessItem, HarnessItemKind: 'context-slice' satisfies HarnessItemKind,
  HookTool: hook, ImportClash: clash, ImportFile: importFile, ImportGrant: grant, ImportPreview: importPreview, InstalledState: 'not-installed' satisfies InstalledState,
  InterfaceExtra: extra, InterfaceId: 'claude-code' satisfies InterfaceId, InterfaceInfo: info, LibraryRef: lib, LibrarySource: source, McpTool: mcp,
  Override: override, OverrideMode: 'hide' satisfies OverrideMode, Plan: plan, PlanChange: change, PromptTool: prompt, Scope: scope, ScopeKind: 'project' satisfies ScopeKind,
  SecretRef: secret, SecretSlot: slot, SkillItem: skill, Slice: slice, SliceRule: rule, ToolAttachment: attachment, ToolItem: hook satisfies ToolItem,
  ToolKind: 'hook' satisfies ToolKind, ToolReference: toolRef, Version: version, WikiPage: page, World: world,
};

const typesSource = readFileSync(join(DESKTOP, 'shared', 'proto', 'types.ts'), 'utf8');
const exportedNames = [...typesSource.matchAll(/^export (?:type|interface) (\w+)/gm)].map(m => m[1]!).sort();

test('shared/proto/types.ts holds types only: no runtime export, no import, no Date, no class', () => {
  assert.deepEqual(Object.keys(typesModule), []);
  assert.doesNotMatch(typesSource, /^\s*import\s/m);
  assert.doesNotMatch(typesSource, /^export (const|let|var|function|class|enum)\b/m);
  assert.doesNotMatch(typesSource.replace(/\/\*[\s\S]*?\*\//g, ''), /\bDate\b|\bclass\b/, 'code only: comments may use the words');
});

test('every exported type name has a compile-time sample, and every sample names an exported type', () => {
  assert.ok(exportedNames.length > 0);
  assert.deepEqual(Object.keys(SAMPLES).sort(), exportedNames);
  for (const name of exportedNames) assert.notEqual(SAMPLES[name], undefined, name);
});

test('every exported type has a doc comment on the line above it', () => {
  const lines = typesSource.split('\n');
  lines.forEach((line, i) => { if (/^export (type|interface) /.test(line)) assert.match(lines[i - 1] ?? '', /\*\/\s*$/, line); });
});

test('the placeholder access class names are marked as open in the doc comment', () => {
  assert.match(typesSource, /\/\*\*(?:(?!\*\/)[\s\S])*(placeholder|still open)(?:(?!\*\/)[\s\S])*\*\/\s*export type AccessClass/i);
});

test('createEmptyWorld returns a World with one global scope, three interfaces and empty collections', () => {
  const w = createEmptyWorld();
  assert.deepEqual(Object.keys(w).sort(), ['interfaces', 'items', 'libraries', 'overrides', 'scopes', 'slices', 'versions', 'wikiPages']);
  assert.deepEqual(w.interfaces.map(i => i.id).sort(), ['claude-code', 'codex', 'opencode']);
  for (const i of w.interfaces) {
    assert.ok(['installed', 'not-installed', 'unknown'].includes(i.installed), i.id);
    assert.ok(i.notice === null || typeof i.notice === 'string');
    assert.ok(['blocks reads', 'advisory only'].includes(i.enforcement), i.id);
  }
  assert.equal(w.scopes.filter(s => s.kind === 'global').length, 1);
  assert.equal(w.scopes.filter(s => s.kind === 'project').length, 0);
  assert.equal(w.scopes[0]?.parentId, null);
  for (const key of ['items', 'overrides', 'wikiPages', 'slices', 'versions', 'libraries'] as const) assert.deepEqual(w[key], [], key);
});

test('createEmptyWorld is plain JSON: it round-trips unchanged, and each call returns a fresh object', () => {
  const w = createEmptyWorld();
  assert.deepEqual(JSON.parse(JSON.stringify(w)), w);
  const other = createEmptyWorld();
  assert.notEqual(w, other); assert.notEqual(w.interfaces, other.interfaces); assert.notEqual(w.scopes[0], other.scopes[0]);
  assert.deepEqual(w, other);
});

test('a full sample World round-trips as JSON unchanged', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(world)), world);
});

test('a hook runs code, and an MCP tool carries a secret reference with a name and a state, never a value', () => {
  assert.equal(hook.runsCode, true);
  assert.deepEqual(Object.keys(mcp.secret!).sort(), ['kind', 'name', 'state']);
  assert.deepEqual(Object.keys(toolRef.secret!).sort(), ['kind', 'name']);
});
