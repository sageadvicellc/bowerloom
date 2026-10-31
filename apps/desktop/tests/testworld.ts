// A small invented World for the prototype store, plan and bundle tests. Built here with createEmptyWorld and hand-made items.
import { createEmptyWorld } from '../renderer/common/fakeApi.js';
import type { AgentItem, FoundAt, McpTool, PromptTool, HookTool, SkillItem, WikiPage, World } from '../shared/world/types.js';

export const found = (iface: FoundAt['interface'], path: string, text: string, hash = `h-${text}`): FoundAt => ({ interface: iface, path, contentHash: hash, text });

export const skill = (id: string, name: string, scopeId = 'global', text = `Steps for ${name}.`): SkillItem =>
  ({ id, kind: 'skill', name, scopeId, foundAt: [found('claude-code', `/sample/found/${id}/SKILL.md`, text)], library: null, description: `About ${name}` });

export const agent = (id: string, name: string, skillIds: string[] = [], scopeId = 'global'): AgentItem =>
  ({ id, kind: 'agent', name, scopeId, foundAt: [], library: null, definition: { name, role: `${name} role`, instructions: `Do the ${name} work.`, skillIds, toolAttachments: [] }, extras: [] });

export const mcp = (id: string, name: string, secretName: string | null = 'SEARCH_TOKEN', scopeId = 'global'): McpTool =>
  ({ id, kind: 'tool', toolKind: 'mcp', name, scopeId, foundAt: [], library: null, secret: secretName === null ? null : { kind: 'env', name: secretName, state: 'missing' } });

export const prompt = (id: string, name: string, text = 'Summarize this.', scopeId = 'global'): PromptTool =>
  ({ id, kind: 'tool', toolKind: 'prompt', name, scopeId, foundAt: [found('claude-code', `/sample/found/${id}.md`, text)], library: null });

export const hook = (id: string, name: string, scopeId = 'global'): HookTool =>
  ({ id, kind: 'tool', toolKind: 'hook', name, scopeId, foundAt: [found('claude-code', `/sample/found/${id}.sh`, 'echo hook')], library: null, runsCode: true });

export const page = (id: string, folder: string, type: string, tags: string[], links: string[] = []): WikiPage =>
  ({ id, title: `Title ${id}`, folder, type, tags, summary: `Private summary text of ${id}`, bytes: 400, links, joinedSinceVisit: false });

/** Three interfaces, all installed; a global scope and one project scope; a few items of each kind; six pages. */
export function makeWorld(): World {
  const base = createEmptyWorld();
  return {
    ...base,
    interfaces: base.interfaces.map(i => ({ ...i, installed: 'installed' as const })),
    scopes: [...base.scopes, { id: 'proj', kind: 'project', name: 'Project one', parentId: 'global', path: '/sample/projects/one' }],
    items: [
      skill('s1', 'Review'), skill('s2', 'Plan'), skill('s3', 'Local', 'proj'),
      { ...skill('l1', 'Library skill'), library: { library: 'example-lib', pinnedVersion: '1.0.0' } },
      agent('a1', 'Planner', ['s1']), agent('a2', 'Checker'),
      mcp('t1', 'Search'), prompt('t2', 'Summarize'), hook('t3', 'Format hook'),
    ],
    libraries: [{ id: 'example-lib', name: 'Example lib', installedVersion: '1.0.0' }],
    wikiPages: [
      page('p1', 'notes', 'concept', ['a'], ['p2']), page('p2', 'notes', 'concept', ['b'], ['p3']), page('p3', 'ideas', 'idea', ['a'], ['p4']),
      page('p4', 'ideas/deep', 'idea', [], ['p5']), page('p5', 'misc', 'log', ['c'], []), page('p6', 'misc', 'log', [], []),
    ],
  };
}

/** A deep copy through JSON, so a test can show that an input was left alone. */
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
