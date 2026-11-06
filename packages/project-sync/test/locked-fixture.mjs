// Synthetic harnesses with locked-in parts (MCP servers, subagents, hooks, guardrails) for the step 3 writer tests.
// No private paths, no real rules, no real secrets.
import fs from 'node:fs';
import path from 'node:path';
import { entryHash, loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { json, project } from './portable-fixture.mjs';

export const PINNED = [
  { id: 'claude-code', version: '2.1.310' }, { id: 'codex', version: '0.157.0' }, { id: 'opencode', version: '1.18.30' },
  { id: 'pi', version: '1.4.0' }, { id: 'deepseek-harness', version: '0.2.2-alpha.2' },
];
export const LOCKED_PARTS = { mcp: 'mcp.json', subagents: 'agents/', hooks: 'hooks.json', guardrails: 'guardrails.json' };
export const agentFile = (id, front = '', body = `Act as ${id}.\n`) => `---\nname: ${id}\ndescription: The ${id} subagent.\n${front}---\n\n${body}`;
export const DOCS = { name: 'docs', transport: 'stdio', command: 'docs-mcp', args: ['--root', '.'], env: { DOCS_TOKEN: '${DOCS_TOKEN}' } };

/**
 * A project whose definition holds locked-in parts. `mcp`, `hooks`, `rules`, and `agents` replace the defaults; null
 * leaves that file out. `sandbox` adds a sandbox requirement.
 */
export function lockedProject(t, { engines = PINNED, mcp = [DOCS], hooks = [], rules = [], sandbox = null, agents = {}, files = {}, parts = {} } = {}) {
  const all = {
    ...(mcp === null ? {} : { 'mcp.json': json({ servers: mcp }) }),
    ...(hooks === null ? {} : { 'hooks.json': json({ hooks }) }),
    'guardrails.json': json({ rules, ...(sandbox ? { sandbox } : {}) }),
    ...Object.fromEntries(Object.entries(agents).map(([id, text]) => [`agents/${id}.md`, text])),
    ...files,
  };
  return project(t, { engines, parts: { ...LOCKED_PARTS, ...(Object.keys(agents).length ? {} : { subagents: undefined }), ...parts }, files: all });
}

/** The loaded entry of a part, for an approval. */
export function entryOf(p, part, id) {
  const r = loadDefinition(p.def);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const e = r.definition.entries;
  const list = { subagents: e.subagents, guardrails: [...e.rules, ...e.sandbox], hooks: e.hooks, mcp: e.mcp }[part];
  return list.find(x => x.id === id);
}
/** A recorded approval of one weakened or absent line. */
export function approve(p, part, id, engine, result, extra = {}) {
  return { part, entry: id, engine, result, entryHash: entryHash(entryOf(p, part, id)), who: 'Test Person', when: '2026-10-28T10:00:00Z', reason: 'Synthetic test approval.', ...extra };
}
/** Approvals for every refused line of a PORTABLE_FIDELITY refusal. */
export function approveAll(p, refusal) {
  return refusal.refused.map(l => approve(p, l.part, l.entry, l.engine, l.result, l.field !== undefined ? { field: l.field } : {}));
}

export const read = (p, rel) => fs.readFileSync(path.join(p.dir, rel), 'utf8');
export const exists = (p, rel) => fs.existsSync(path.join(p.dir, rel));
export function put(p, rel, text) { fs.mkdirSync(path.dirname(path.join(p.dir, rel)), { recursive: true }); fs.writeFileSync(path.join(p.dir, rel), text); }
