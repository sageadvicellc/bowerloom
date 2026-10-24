/**
 * The projection plan (spec 6.5): what writing the harness to each installed interface would change, worked out before anything is written.
 *
 * `planProjection(committed, draft)` renders the files of both worlds and lists what was added, changed or removed. Rules:
 * - Every scope is written on its own: a project writes what it has after its hide and replace choices (a hidden item is not written,
 *   a replaced item writes the replacement), then its own items.
 * - Skills, agents, MCP servers and saved prompts are written. A library item is referenced, so it writes nothing. A hook is
 *   read-only in the app, so it writes nothing. A knowledge slice is not a file.
 * - An MCP file names the place that holds its secret and never carries the value or the state.
 *
 * THE PATHS ARE INVENTED. The Claude Code and Codex skill folders and the Claude Code agent folder follow the spec's proposal; every
 * other path (Codex and OpenCode agents, all tool paths) is made up for the prototype, and OpenCode's real layout is not known (spec 13, question 3).
 * Each path starts with the path of the scope that owns the file. Pure: no clock, no random number, no file.
 */
import type { AgentItem, HarnessItem, InterfaceId, Plan, PlanChange, World } from './types.js';
import { effectiveItems, effectiveResolver, fileSlug } from './common.js';

const ORDER: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];
const PREVIEW_LIMIT = 400;

/** Where each kind of file goes, per interface, below the scope's path. Invented, see above. */
const LAYOUT: Record<InterfaceId, { skill(n: string): string; agent(n: string): string; mcp(n: string): string; prompt(n: string): string }> = {
  'claude-code': { skill: n => `.claude/skills/${n}/SKILL.md`, agent: n => `.claude/agents/${n}.md`, mcp: n => `.claude/mcp/${n}.json`, prompt: n => `.claude/commands/${n}.md` },
  codex: { skill: n => `.agents/skills/${n}/SKILL.md`, agent: n => `.codex/agents/${n}.md`, mcp: n => `.codex/mcp/${n}.json`, prompt: n => `.codex/prompts/${n}.md` },
  opencode: { skill: n => `.opencode/skill/${n}.md`, agent: n => `.opencode/agent/${n}.md`, mcp: n => `.opencode/mcp/${n}.json`, prompt: n => `.opencode/command/${n}.md` },
};

interface Rendered { readonly interface: InterfaceId; readonly path: string; readonly content: string }

const joinPath = (base: string, rel: string): string => `${base.replace(/\/+$/, '')}/${rel}`;

/** The first `PREVIEW_LIMIT` characters, cut before a split pair of UTF-16 units. When something was cut, an ellipsis and a line say how many characters the whole file holds. */
function shorten(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  let end = PREVIEW_LIMIT;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…\n[Cut here. The whole file is ${text.length.toLocaleString('en-US')} characters.]`;
}

const textFor = (item: HarnessItem, iface: InterfaceId): string => (item.foundAt.find(f => f.interface === iface) ?? item.foundAt[0])?.text ?? '';

/** What a scope calls an id: the item itself, its replacement there, or nothing when the scope hides it or cannot reach it. */
type Resolve = (itemId: string) => HarnessItem | undefined;

function agentText(agent: AgentItem, iface: InterfaceId, world: World, resolve: Resolve): string {
  const d = agent.definition;
  const skills = d.skillIds.flatMap(s => resolve(s)?.name ?? []), tools = d.toolAttachments.flatMap(t => { const item = resolve(t.toolId); return item === undefined ? [] : [`${item.name} (${t.access})`]; });
  const lines = [`Agent: ${agent.name}`, `Role: ${d.role}`, `Instructions: ${d.instructions}`, `Skills: ${skills.join(', ') || 'none'}`, `Tools: ${tools.join(', ') || 'none'}`];
  if (d.sliceId !== undefined) lines.push(`Knowledge slice: ${world.slices.find(s => s.id === d.sliceId)?.name ?? d.sliceId}`);
  for (const e of agent.extras) if (e.interface === iface) lines.push(`${e.badge}: ${e.key} = ${e.value}`);
  return lines.join('\n');
}

function render(item: HarnessItem, iface: InterfaceId, scopePath: string, world: World, resolve: Resolve): Rendered | null {
  if (item.library !== null) return null;
  const layout = LAYOUT[iface], slug = fileSlug(item.name);
  switch (item.kind) {
    case 'skill': return { interface: iface, path: joinPath(scopePath, layout.skill(slug)), content: `Skill: ${item.name}\n${item.description}\n\n${textFor(item, iface)}` };
    case 'agent': return { interface: iface, path: joinPath(scopePath, layout.agent(slug)), content: agentText(item, iface, world, resolve) };
    case 'tool':
      if (item.toolKind === 'hook') return null;
      if (item.toolKind === 'prompt') return { interface: iface, path: joinPath(scopePath, layout.prompt(slug)), content: `Saved prompt: ${item.name}\n\n${textFor(item, iface)}` };
      return { interface: iface, path: joinPath(scopePath, layout.mcp(slug)), content: `MCP server: ${item.name}\n${item.secret === null ? 'Needs no secret.' : `Secret held in: ${item.secret.kind} ${item.secret.name}`}` };
    case 'context-slice': return null;
  }
}

/** Every file a world would write, keyed by interface and path. Where two items share a path, the later one (the project's own) wins. */
function filesOf(world: World): Map<string, Rendered> {
  const files = new Map<string, Rendered>();
  const installed = world.interfaces.filter(i => i.installed === 'installed').map(i => i.id);
  for (const scope of world.scopes) {
    const items = effectiveItems(world, scope.id), resolve = effectiveResolver(world, scope.id);
    for (const iface of installed) for (const item of items) {
      const file = render(item, iface, scope.path, world, resolve);
      if (file !== null) files.set(`${iface}\u0000${file.path}`, file);
    }
  }
  return files;
}

/** What projecting `draft` would change compared with `committed`, for every installed interface, sorted by interface and then path. */
export function planProjection(committed: World, draft: World): Plan {
  const before = filesOf(committed), after = filesOf(draft), changes: PlanChange[] = [];
  for (const [key, file] of after) {
    const old = before.get(key);
    if (old === undefined) changes.push({ interface: file.interface, path: file.path, action: 'add', preview: shorten(file.content) });
    else if (old.content !== file.content) changes.push({ interface: file.interface, path: file.path, action: 'change', preview: shorten(file.content) });
  }
  for (const [key, file] of before) if (!after.has(key)) changes.push({ interface: file.interface, path: file.path, action: 'remove', preview: shorten(file.content) });
  changes.sort((a, b) => (ORDER.indexOf(a.interface) - ORDER.indexOf(b.interface)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { changes };
}
