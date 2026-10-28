/**
 * OpenCode 1.18.30 project files back to parts (locked-in parts spec 5.2, 6.2, 8.2 to 8.4): `opencode.json` or
 * `opencode.jsonc` (permission, mcp, agent, model, and other keys) and `.opencode/agents/*.md`. Adoption reads the 1.x
 * shape only. A 2.x shape (`shell`, or a list of rules) refuses with ADOPTION_OPENCODE_VERSION (check 6).
 *
 * OpenCode reads the last matching rule of a key; the neutral rules have a fixed precedence. A later, less strict rule
 * that can overlap an earlier one is kept, and the plan warns that the definition then blocks more on the overlap.
 */
import { OPENCODE_AGENT_MODES, openCodeFromConfig } from '../../fidelity/src/index.js';
import { GUARDRAIL_EFFECTS, isId, isPermissionKey, readFrontmatter, safeName } from '../../harness-definition/src/index.js';
import type { GuardrailAction, GuardrailEffect, JsonValue } from '../../harness-definition/src/index.js';
import { patternProblem } from '../../fidelity/src/index.js';
import { lose, place, type Context, type LostAction } from './context.js';
import { toLf, utf8 } from './files.js';
import type { Candidate } from './model.js';
import { refuse } from './refusal.js';
import { secretName, textSecretRule } from './secrets.js';
import { PERMISSION_REASON, addServer, blockOf, isObj, leftovers, kp, oneLine, privateKeys, readJson } from './shared.js';
import type { Obj } from './shared.js';

const ENGINE = 'opencode' as const;
const ACTIONS: Readonly<Record<string, GuardrailAction>> = { bash: 'shell', read: 'read', edit: 'edit', webfetch: 'web', task: 'subagent', skill: 'skill' };
const RANK: Readonly<Record<GuardrailEffect, number>> = { allow: 0, ask: 1, deny: 2 };
/** The neutral action an OpenCode permission key limits, for a deny or ask that cannot be carried (ruling A2). */
const LOST: Readonly<Record<string, LostAction>> = {
  '*': '*', bash: 'shell', read: 'read', grep: 'read', glob: 'read', list: 'read', external_directory: 'read', edit: 'edit', webfetch: 'web', websearch: 'web', task: 'subagent', skill: 'skill',
};
function lostOf(ctx: Context, key: string): void {
  const action = LOST[key] ?? (/^[A-Za-z0-9-]+_/.test(key) ? 'mcp' : undefined);
  if (action !== undefined) lose(ctx, ENGINE, action);
}
const isEffect = (v: unknown): v is GuardrailEffect => typeof v === 'string' && (GUARDRAIL_EFFECTS as readonly string[]).includes(v);

/** True when the 1.x reader does not apply: a `shell` key or a list of rules is the 2.x shape. */
export function isOpenCode2Shape(permission: JsonValue): boolean {
  return isObj(permission) && (Object.hasOwn(permission, 'shell') || Object.values(permission).some(v => Array.isArray(v)));
}

function readPermission(ctx: Context, value: JsonValue, path: string, shape: string): void {
  const { r } = ctx;
  if (isOpenCode2Shape(value)) refuse('ADOPTION_OPENCODE_VERSION', [path]);
  if (!isObj(value)) { r.miss(path, 'guardrails', 'permission is not an object of keys.', '/permission', 'acknowledge'); lose(ctx, ENGINE, '*'); return; }
  const valid: Obj = {};
  for (const [k, v] of Object.entries(value)) {
    if (isEffect(v) || (isObj(v) && Object.values(v).every(isEffect))) valid[k] = v;
    else {
      // It could be a deny or an ask that cannot be read, so it needs acknowledgement, and its action loses its allows.
      r.miss(path, 'guardrails', 'This permission key is not an action word or an object of patterns and action words.', `/permission${kp(value, k)}`, 'acknowledge');
      lostOf(ctx, k);
    }
  }
  for (const { key, rules } of openCodeFromConfig(valid as Parameters<typeof openCodeFromConfig>[0])) {
    const base = `/permission${kp(value, key)}`;
    const action = ACTIONS[key];
    if (action === undefined) {
      const strict = rules.some(x => x.action !== 'allow');
      r.miss(path, 'guardrails', key === '*' ? 'A rule for every permission has no neutral form: the neutral rules name an action. The projection writes Bowerloom\'s own default for OpenCode.' : 'The neutral guardrail actions have no form for this OpenCode permission.', base, strict ? 'acknowledge' : 'none');
      if (strict) lostOf(ctx, key);
      continue;
    }
    const single = typeof valid[key] === 'string';
    const kept: { pattern: string; effect: GuardrailEffect; index: number }[] = [];
    rules.forEach((rule, index) => {
      const pointer = single ? base : `${base}${kp(value[key] as Obj, rule.pattern)}`;
      const effect = rule.action, strength = effect === 'allow' ? 'advisory' as const : 'enforced' as const;
      let pattern = rule.pattern;
      const notes: string[] = [];
      const miss = (reason: string): void => {
        r.miss(path, 'guardrails', reason, pointer, effect === 'allow' ? 'none' : 'acknowledge');
        if (effect !== 'allow') lose(ctx, ENGINE, action);
      };
      if (secretName(pattern)) { miss('The pattern looks like a secret, so the rule is not adopted.'); return; }
      if (action === 'read' || action === 'edit') {
        if (pattern !== '*') { miss('OpenCode reads * across folders, and the neutral path language does not. Adoption does not guess a translation of this path rule.'); return; }
        pattern = '**';
      } else if (action === 'web') {
        if (!single) { miss('OpenCode 1.x takes one action for webfetch, so a pattern here has no meaning adoption can carry.'); return; }
        if (effect === 'allow') { miss('The neutral web pattern * also allows web search, which is wider than a webfetch allow.'); return; }
        notes.push('The web pattern * also covers web search, so this blocks more than the source.');
      } else if (pattern.includes('?')) { miss('OpenCode reads ? as one character, and the neutral pattern reads it as itself, so the rule has no exact neutral form.'); return; }
      const shaped = { action, pattern, effect, strength };
      const problem = patternProblem(shaped);
      if (problem) { miss(problem); return; }
      kept.push({ pattern, effect, index });
      ctx.cands.push({ part: 'guardrails', id: '', rule: shaped, place: place(path, [ENGINE], shape, ENGINE, { pointer }), blocks: {}, secrets: [], needsApproval: [], notes } satisfies Candidate);
    });
    const literal = (p: string) => !/[*?]/.test(p);
    for (let j = 0; j < kept.length; j++) for (let i = 0; i < j; i++) {
      const a = kept[i]!, b = kept[j]!;
      if (RANK[a.effect] > RANK[b.effect] && !(literal(a.pattern) && literal(b.pattern) && a.pattern !== b.pattern)) {
        ctx.warnings.push(`${path} permission ${safeName(key)}: OpenCode reads the last match, so rule ${b.index + 1} overrides the stricter rule ${a.index + 1} where both match. Under the fixed precedence (deny, then ask, then allow) rule ${a.index + 1} wins there, so the definition blocks more than the source.`);
      }
    }
  }
}

const ENV_REF = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** OpenCode's `{env:NAME}` as `${NAME}`. Any other `{...:...}` form is not portable. */
function refs(v: Obj): Obj | null {
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') return null;
    const y = x.replace(ENV_REF, (_m, n: string) => `\${${n}}`);
    if (/\{[a-z]+:[^}]*\}/.test(y)) return null;
    out[k] = y;
  }
  return out;
}

function readMcp(ctx: Context, value: JsonValue, path: string, shape: string): void {
  if (!isObj(value)) { ctx.r.miss(path, 'mcp', 'mcp is not an object of servers.', '/mcp'); return; }
  for (const [name, s] of Object.entries(value)) {
    const base = `/mcp${kp(value, name)}`;
    if (!isObj(s) || (s.type !== 'local' && s.type !== 'remote')) { ctx.r.miss(path, 'mcp', 'This server is not an object with type local or remote.', base); continue; }
    const env = s.environment === undefined ? undefined : isObj(s.environment) ? refs(s.environment) : null;
    const headers = s.headers === undefined ? undefined : isObj(s.headers) ? refs(s.headers) : null;
    if (env === null || headers === null) { ctx.r.miss(path, 'mcp', 'An environment value or header is not text, or uses a form other than {env:NAME}, such as {file:...}. It is not portable.', base); continue; }
    let command: JsonValue | undefined, args: JsonValue | undefined;
    if (s.type === 'local') {
      if (!Array.isArray(s.command) || s.command.length === 0 || !s.command.every(c => typeof c === 'string')) { ctx.r.miss(path, 'mcp', 'A local server needs its command as a list of text.', `${base}/command`); continue; }
      command = s.command[0]; args = s.command.slice(1);
    }
    const known = new Set(['type', 'command', 'environment', 'url', 'headers', 'timeout', 'enabled']);
    if (s.timeout !== undefined && typeof s.timeout !== 'number') ctx.r.miss(path, 'mcp', 'The timeout is not a number, so the server is adopted without it.', `${base}/timeout`);
    addServer(ctx, {
      path, base, engines: [ENGINE], owner: ENGINE, shape, name, transport: s.type === 'local' ? 'stdio' : 'http',
      ...(command !== undefined ? { command } : {}), ...(args !== undefined && (args as string[]).length ? { args } : {}), ...(s.url !== undefined ? { url: s.url } : {}),
      ...(env ? { env } : {}), ...(headers ? { headers } : {}), ...(typeof s.timeout === 'number' ? { timeout: s.timeout } : {}), ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
      extra: Object.fromEntries(Object.entries(s).filter(([k]) => !known.has(k))),
      notes: s.type === 'local' ? ['OpenCode keeps the command and its arguments in one list.'] : [],
    });
  }
}

const LIMIT_REASON = 'This agent sets a tool limit (tools or permission) that the neutral tool list cannot carry exactly. Without it the subagent would be wider than the source, so it is not adopted.';
const MODE_REASON = 'The agent mode is not primary, subagent, or all, the modes of OpenCode 1.x, so it is not adopted.';

function addAgent(ctx: Context, id: string, d: Obj, body: string, path: string, base: string, shape: string): void {
  const { r } = ctx;
  if (d.tools !== undefined || d.permission !== undefined) { r.miss(path, 'subagents', LIMIT_REASON, base || undefined); return; }
  if (!isId(id)) { r.miss(path, 'subagents', 'The agent name is not a valid id: lowercase letters, digits, and single hyphens.', base || undefined); return; }
  if (!(typeof d.description === 'string' && d.description.trim() !== '' && [...d.description].length <= 1024)) { r.miss(path, 'subagents', 'The agent has no description of 1 to 1,024 characters.', base || undefined); return; }
  if (body.trim() === '') { r.miss(path, 'subagents', 'The agent has no instructions, which a subagent needs.', base || undefined); return; }
  const models: { opencode?: string } = {};
  if (d.model !== undefined) { if (oneLine(d.model, 256)) models.opencode = d.model; else r.miss(path, 'subagents', 'The model is not one line of text.', `${base}/model`); }
  const extra: Obj = {};
  for (const [k, v] of Object.entries(d)) {
    if (['description', 'model', 'prompt'].includes(k)) continue;
    if (k === 'mode' && !OPENCODE_AGENT_MODES.includes(v as string)) { r.miss(path, 'subagents', MODE_REASON, `${base}/mode`); continue; }
    if (isPermissionKey(k)) { r.miss(path, 'subagents', PERMISSION_REASON, `${base}${kp(d, k)}`); continue; }
    extra[k] = v;
  }
  const found = { secret: false };
  const kept = privateKeys(ctx, extra, path, base, 'subagents', 'none', found);
  if (found.secret) return;
  const { blocks, secrets } = blockOf([ENGINE], kept, path, base, id);
  ctx.cands.push({
    part: 'subagents', id, subagent: { description: d.description, body }, models, blocks, secrets, needsApproval: [], notes: [],
    place: place(path, [ENGINE], shape, ENGINE, base ? { pointer: base } : {}),
  });
}

function readConfig(ctx: Context): void {
  const path = ctx.r.kind('opencode.json') !== null ? 'opencode.json' : ctx.r.kind('opencode.jsonc') !== null ? 'opencode.jsonc' : null;
  if (path === null) return;
  if (path === 'opencode.json' && ctx.r.kind('opencode.jsonc') !== null) { ctx.r.consumed.add('opencode.jsonc'); ctx.r.miss('opencode.jsonc', null, 'opencode.json is read; adoption reads one OpenCode settings file.'); }
  const c = readJson(ctx, path, 'guardrails', path.endsWith('c'), { engine: ENGINE, action: '*' });
  if (!c) return;
  const shape = `OpenCode 1.x ${path}`;
  const rest: Obj = {};
  for (const [key, value] of Object.entries(c)) {
    if (key === 'permission') readPermission(ctx, value, path, shape);
    else if (key === 'mcp') readMcp(ctx, value, path, shape);
    else if (key === 'agent') {
      if (!isObj(value)) { ctx.r.miss(path, 'subagents', 'agent is not an object.', '/agent'); continue; }
      for (const [id, a] of Object.entries(value)) {
        const base = `/agent${kp(value, id)}`;
        if (!isObj(a)) { ctx.r.miss(path, 'subagents', 'This agent is not an object.', base); continue; }
        if (a.prompt !== undefined && (typeof a.prompt !== 'string' || /\{file:/.test(a.prompt))) { ctx.r.miss(path, 'subagents', 'The prompt is not inline text: a {file:...} prompt is a path that adoption does not follow.', `${base}/prompt`); continue; }
        if (typeof a.prompt === 'string' && textSecretRule('agents/x.md', Buffer.from(a.prompt))) { ctx.r.miss(path, 'subagents', 'The prompt holds a value that looks like a secret.', `${base}/prompt`); continue; }
        const body = typeof a.prompt === 'string' ? toLf(a.prompt) : '';
        addAgent(ctx, id, a, body.endsWith('\n') || body === '' ? body : `${body}\n`, path, base, shape);
      }
    } else if (key === 'model') { if (oneLine(value, 256)) ctx.models[ENGINE] = { model: value, path }; else ctx.r.miss(path, null, 'The model is not one line of text.', '/model'); }
    else if (key === 'plugin') ctx.r.miss(path, 'plugins', 'An OpenCode plugin is a package of JavaScript code, not a part. Bowerloom does not convert it (locked-in parts spec, section 9.5).', '/plugin');
    else if (key === 'instructions') ctx.r.miss(path, 'system-prompt', 'Extra instruction files have no neutral form: the definition holds one instructions file.', '/instructions');
    else if (key === 'command') ctx.r.miss(path, 'commands', 'Commands are not adopted: a portable command is a skill, and a person makes that change.', '/command');
    else rest[key] = value;
  }
  leftovers(ctx, ENGINE, path, rest, 'opencode.json', shape);
}

function readAgentFiles(ctx: Context): void {
  const { r } = ctx;
  const root = '.opencode/agents';
  const listed = r.list(root, 'subagents');
  if (listed === null) return;
  for (const { name, kind } of listed) {
    const rel = `${root}/${name}`;
    if (kind !== 'file' || !name.endsWith('.md')) continue;
    const f = r.file(rel, 'subagents');
    if (!f) continue;
    const text = utf8(f.bytes);
    if (text === null) { r.miss(rel, 'subagents', 'This file is not UTF-8 text.'); continue; }
    if (textSecretRule('agents/x.md', f.bytes)) { r.miss(rel, 'subagents', 'This file holds a value that looks like a secret. Adoption never copies a secret value.'); continue; }
    const fm = readFrontmatter(text);
    if (!fm.ok) { r.miss(rel, 'subagents', fm.message); continue; }
    addAgent(ctx, name.slice(0, -3), { ...fm.data }, toLf(fm.body), rel, '', 'OpenCode agent file');
  }
  r.rest(root, listed, 'subagents');
}

export function readOpenCode(ctx: Context): void {
  if (!ctx.engines.includes(ENGINE)) return;
  readConfig(ctx);
  readAgentFiles(ctx);
  for (const [path, part, reason] of [
    ['.opencode/plugins', 'plugins', 'OpenCode plugins are JavaScript code. Bowerloom does not convert code into parts (locked-in parts spec, section 9.5).'],
    ['.opencode/commands', 'commands', 'Commands are not adopted: a portable command is a skill, and a person makes that change.'],
  ] as const) if (ctx.r.kind(path) !== null) { ctx.r.consumed.add(path); ctx.r.miss(path, part, reason); }
}
