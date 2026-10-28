/**
 * Claude Code 2.1.310 project files back to parts (definition spec 10.2; locked-in parts spec 5.2, 6.2, 7.2, 8.2):
 * `.claude/settings.json` (permissions, hooks, sandbox, model, and other keys), `.mcp.json`, and `.claude/agents/*.md`.
 * `.claude/settings.local.json` is local scope and is listed, not adopted (locked-in parts spec, decision 5).
 */
import { TOOL_CLASSES, isId, isPermissionKey, readFrontmatter } from '../../harness-definition/src/index.js';
import type { GuardrailEffect, JsonValue, ToolClass } from '../../harness-definition/src/index.js';
import { claudeRule } from './claude-rules.js';
import { place, type Context } from './context.js';
import { toLf, utf8 } from './files.js';
import { textSecretRule } from './secrets.js';
import { PERMISSION_REASON, blockOf, isObj, leftovers, oneLine, privateKeys, ptr, readHooks, readJson, readMcpServers } from './shared.js';
import type { Obj } from './shared.js';

const ENGINE = 'claude-code' as const;
const SETTINGS = '.claude/settings.json';

export const claudeProjectDir = (command: string): string => command.replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g, '${PROJECT_DIR}');

/** Rules of `permissions.allow`, `ask`, and `deny`, with a place pointer for each. */
export function readClaudeRules(ctx: Context, permissions: Obj, path: string, base: string, shape: string): void {
  for (const effect of ['allow', 'ask', 'deny'] as const satisfies readonly GuardrailEffect[]) {
    const list = permissions[effect];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { ctx.r.miss(path, 'guardrails', `permissions.${effect} is not a list of rules.`, `${base}/${effect}`); continue; }
    list.forEach((text, i) => {
      const pointer = `${base}/${effect}/${i}`;
      if (typeof text !== 'string') { ctx.r.miss(path, 'guardrails', 'This rule is not text.', pointer); return; }
      const got = claudeRule(text, effect);
      if ('reason' in got) { ctx.r.miss(path, 'guardrails', got.reason, pointer); return; }
      ctx.cands.push({ part: 'guardrails', id: '', rule: got.rule, place: place(path, [ENGINE], shape, ENGINE, { pointer }), blocks: {}, secrets: [], needsApproval: [], notes: got.note ? [got.note] : [] });
    });
  }
}

const MODES_REASON = 'Permission modes do not translate between engines (locked-in parts spec, section 8.3 rule 12). Bowerloom writes the engine default.';

function readSettings(ctx: Context): void {
  const s = readJson(ctx, SETTINGS, 'guardrails');
  if (!s) return;
  const shape = 'Claude Code settings.json';
  const rest: Obj = {};
  for (const [key, value] of Object.entries(s)) {
    if (key === 'permissions') {
      if (!isObj(value)) { ctx.r.miss(SETTINGS, 'guardrails', 'permissions is not an object.', '/permissions'); continue; }
      readClaudeRules(ctx, value, SETTINGS, '/permissions', shape);
      for (const k of Object.keys(value)) {
        if (k === 'allow' || k === 'ask' || k === 'deny') continue;
        ctx.r.miss(SETTINGS, 'guardrails', k === 'defaultMode' ? MODES_REASON : PERMISSION_REASON, `/permissions${ptr(k)}`);
      }
    } else if (key === 'hooks') readHooks(ctx, value, { path: SETTINGS, base: '/hooks', engine: ENGINE, shape, rewrite: claudeProjectDir });
    else if (key === 'sandbox') readSandbox(ctx, value);
    else if (key === 'model') {
      if (oneLine(value, 256)) ctx.models[ENGINE] = { model: value, path: SETTINGS };
      else ctx.r.miss(SETTINGS, null, 'The model is not one line of text.', '/model');
    } else rest[key] = value;
  }
  leftovers(ctx, ENGINE, SETTINGS, rest, 'settings.json', shape);
}

/** `sandbox.enabled: true` is a requirement for a file and a network sandbox. Claude Code's sandbox covers Bash commands. */
function readSandbox(ctx: Context, value: JsonValue): void {
  if (!isObj(value)) { ctx.r.miss(SETTINGS, 'guardrails', 'sandbox is not an object.', '/sandbox'); return; }
  const rest = privateKeys(ctx, Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'enabled')), SETTINGS, '/sandbox', 'guardrails');
  if (value.enabled !== true) {
    if (value.enabled !== undefined && value.enabled !== false) ctx.r.miss(SETTINGS, 'guardrails', 'sandbox.enabled is not true or false.', '/sandbox/enabled');
    if (Object.keys(rest).length) ctx.r.miss(SETTINGS, 'guardrails', 'The sandbox is not enabled, so its other settings have no requirement to belong to.', '/sandbox');
    return;
  }
  const { blocks, secrets } = blockOf([ENGINE], rest, SETTINGS, '/sandbox', 'sandbox');
  ctx.cands.push({
    part: 'guardrails', id: 'sandbox', sandbox: { files: true, network: true }, place: place(SETTINGS, [ENGINE], 'Claude Code settings.json', ENGINE, { pointer: '/sandbox' }),
    blocks, secrets, needsApproval: [], notes: ['Claude Code\'s sandbox covers Bash commands; it becomes a requirement for a file and a network sandbox.'],
  });
}

function readMcp(ctx: Context): void {
  const s = readJson(ctx, '.mcp.json', 'mcp');
  if (!s) return;
  for (const [key, value] of Object.entries(s)) {
    if (key === 'mcpServers') readMcpServers(ctx, value, { path: '.mcp.json', base: '/mcpServers', engines: [ENGINE], owner: ENGINE, shape: 'Claude Code .mcp.json' });
    else ctx.r.miss('.mcp.json', 'mcp', 'Adoption reads only mcpServers in .mcp.json.', ptr(key));
  }
}

// ---- subagents -----------------------------------------------------------------------------------------------------------

/** The Claude Code tools of each neutral class (locked-in parts spec, section 8.4). */
const CLASS_TOOLS: Readonly<Record<(typeof TOOL_CLASSES)[number], readonly string[]>> = {
  read: ['Read'], search: ['Grep', 'Glob'], edit: ['Edit'], write: ['Write'], shell: ['Bash'], web: ['WebFetch', 'WebSearch'], task: ['Agent', 'Task'], skill: ['Skill'],
};
const classOf = (tool: string): (typeof TOOL_CLASSES)[number] | null => TOOL_CLASSES.find(c => CLASS_TOOLS[c].includes(tool)) ?? null;

/**
 * A Claude Code tool list as neutral tool classes. A class is kept only when the list allows every tool of it, so the
 * limit never widens; a dropped tool makes it narrower, and the note says so. `Agent` and `Task` are one tool.
 */
export function toolClasses(allow: readonly string[] | null, deny: readonly string[]): { tools: ToolClass[]; narrowed: string[] } {
  const narrowed: string[] = [];
  const allowed = (tool: string): boolean => (allow === null || allow.includes(tool) || (tool === 'Task' && allow.includes('Agent')) || (tool === 'Agent' && allow.includes('Task'))) && !deny.includes(tool);
  const tools: ToolClass[] = [];
  for (const c of TOOL_CLASSES) {
    const all = CLASS_TOOLS[c].filter(t => t !== 'Task').every(allowed);
    if (all) tools.push(c);
    else if (CLASS_TOOLS[c].some(t => allow?.includes(t))) narrowed.push(`${c} (not every tool of the class is allowed)`);
  }
  for (const t of allow ?? []) {
    const m = /^mcp__([A-Za-z0-9][A-Za-z0-9_-]{0,63}?)(__\*)?$/.exec(t);
    if (m && !deny.some(d => d === t || d.startsWith(`mcp__${m[1]}__`))) tools.push(`mcp:${m[1]}`);
    else if (t.startsWith('mcp__')) narrowed.push(`${t} (one MCP tool has no neutral class; the server is left out)`);
    else if (classOf(t) === null) narrowed.push(`${t} (no neutral class)`);
  }
  if (allow === null && deny.some(d => d.startsWith('mcp__'))) narrowed.push('MCP tools (a deny list of MCP tools has no neutral form; every MCP server is left out)');
  return { tools: [...new Set(tools)], narrowed };
}

const toolNames = (v: unknown): string[] | null => {
  if (Array.isArray(v)) return v.every(x => typeof x === 'string') ? (v as string[]).map(x => x.trim()).filter(Boolean) : null;
  if (typeof v === 'string') return v.split(',').map(x => x.trim()).filter(Boolean);
  return null;
};

function readAgents(ctx: Context): void {
  const { r } = ctx;
  const root = '.claude/agents';
  const listed = r.list(root, 'subagents');
  if (listed === null) return;
  r.consumed.add(root);
  for (const { name, kind } of listed) {
    const rel = `${root}/${name}`;
    if (kind !== 'file' || !name.endsWith('.md')) continue;
    const f = r.file(rel, 'subagents');
    if (!f) continue;
    const text = utf8(f.bytes);
    if (text === null) { r.miss(rel, 'subagents', 'This file is not UTF-8 text.'); continue; }
    const rule = textSecretRule('agents/x.md', f.bytes);
    if (rule) { r.miss(rel, 'subagents', `This file holds a value that looks like a secret (${rule}). Adoption never copies a secret value, and one inside an agent file cannot be replaced with a reference safely.`); continue; }
    const fm = readFrontmatter(text);
    if (!fm.ok) { r.miss(rel, 'subagents', fm.message); continue; }
    const d = fm.data;
    if (!isId(d.name)) { r.miss(rel, 'subagents', 'The agent has no name that is a valid id: lowercase letters, digits, and single hyphens.'); continue; }
    if (!(typeof d.description === 'string' && d.description.trim() !== '' && [...d.description].length <= 1024)) { r.miss(rel, 'subagents', 'The agent has no description of 1 to 1,024 characters.'); continue; }
    if (fm.body.trim() === '') { r.miss(rel, 'subagents', 'The agent has no instructions in its body, which a subagent needs.'); continue; }
    const notes: string[] = [];
    const extra: Obj = {};
    let tools: ToolClass[] | undefined, skills: string[] | undefined;
    const models: { 'claude-code'?: string } = {};
    const allowList = d.tools === undefined ? null : toolNames(d.tools);
    const denyList = d.disallowedTools === undefined ? [] : toolNames(d.disallowedTools);
    if ((d.tools !== undefined && allowList === null) || denyList === null) { r.miss(rel, 'subagents', 'The tool list is not a list of tool names. Without it the subagent would be wider than the source, so it is not adopted.'); continue; }
    if (d.tools !== undefined || denyList.length) {
      const got = toolClasses(allowList, denyList);
      tools = got.tools;
      if (got.narrowed.length) notes.push(`The tool limit is narrower than the source: ${got.narrowed.join('; ')}.`);
    }
    if (d.skills !== undefined) {
      if (Array.isArray(d.skills) && d.skills.every(isId)) skills = [...new Set(d.skills as string[])];
      else r.miss(rel, 'subagents', 'skills is not a list of skill ids, so it is not adopted.', '/skills');
    }
    if (d.model !== undefined) {
      if (d.model === 'inherit') notes.push('The model is inherit: the subagent uses the caller\'s model, so no explicit model is set.');
      else if (oneLine(d.model, 256)) models['claude-code'] = d.model;
      else r.miss(rel, 'subagents', 'The model is not one line of text.', '/model');
    }
    for (const [k, v] of Object.entries(d)) {
      if (['name', 'description', 'tools', 'disallowedTools', 'skills', 'model'].includes(k)) continue;
      if (isPermissionKey(k)) { r.miss(rel, 'subagents', PERMISSION_REASON, ptr(k)); continue; }
      extra[k] = v;
    }
    const { blocks, secrets } = blockOf(ctx.engines.includes(ENGINE) ? [ENGINE] : [], privateKeys(ctx, extra, rel, '', 'subagents'), rel, '', d.name);
    ctx.cands.push({
      part: 'subagents', id: d.name, subagent: { description: d.description, body: toLf(fm.body), ...(tools ? { tools } : {}), ...(skills ? { skills } : {}) },
      models, place: place(rel, [ENGINE], 'Claude Code agent file', ENGINE), blocks, secrets, needsApproval: [], notes,
    });
  }
}

export function readClaudeCode(ctx: Context): void {
  if (!ctx.engines.includes(ENGINE)) return;
  readSettings(ctx);
  if (ctx.r.kind('.claude/settings.local.json') !== null) {
    ctx.r.consumed.add('.claude/settings.local.json');
    ctx.r.miss('.claude/settings.local.json', null, 'This is local scope. Bowerloom does not adopt local scope (locked-in parts spec, decision 5).');
  }
  readMcp(ctx);
  readAgents(ctx);
  for (const [path, part, reason] of [
    ['.claude/commands', 'commands', 'Commands are not adopted: a portable command is a skill, and turning one into a skill changes its argument syntax, so a person does it.'],
    ['.claude/rules', 'system-prompt', 'Scoped rule files have no neutral form: the definition holds one instructions file.'],
  ] as const) if (ctx.r.kind(path) !== null) { ctx.r.consumed.add(path); ctx.r.miss(path, part, reason); }
}
