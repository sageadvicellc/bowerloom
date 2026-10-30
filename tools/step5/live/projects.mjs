// Scratch-project builders and evidence readers for the step 5 live checks. Every builder returns plain data
// (`files`, a prompt, extra flags). Every reader takes the logged evidence and returns `{ result, observed, evidence }`.
// Neither calls an engine, so the offline test can run them all.
import fs from 'node:fs';
import path from 'node:path';
import { renderPlugin } from '../../../dist/packages/project-sync/src/index.js';
import { START_TABLE } from '../../../dist/packages/team/src/engines.js';
import { PROBE } from './lib.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const tomlList = words => `[${words.map(w => JSON.stringify(w)).join(', ')}]`;
// A reference written the way a config writes it. Kept in one place so no template literal expands it.
export const REF = '${PROBE}';
export const SECRET_MARK = 'live-secret-mark-91b2';
export const OPEN_MARK = 'live-open-mark-52c8';

const opencodeConfig = () => json({ $schema: 'https://opencode.ai/config.json', permission: { bash: 'allow' } });
const hookGroup = (matcher, command) => ({ hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command }] }] } });

/** The OpenCode plugin Bowerloom would write, with one hook per event. */
function plugin(hooks) {
  return renderPlugin(hooks.map(h => ({ engine: 'opencode', entry: h.entry, event: h.event, hook: h.event === 'PreToolUse' ? 'tool.execute.before' : 'tool.execute.after', tools: { bash: 'Bash' }, command: h.command, timeoutMs: 30_000, enforced: false })));
}

// ---- g4: Codex expansion of ${NAME} -------------------------------------------------------------------------------
export function g4Project(sc, port) {
  const config = [
    '[mcp_servers.probe_cmd]',
    'command = "node"',
    `args = ${tomlList(sc.stubArgs('g4-cmd', REF))}`,
    'env_vars = ["PROBE"]',
    '',
    '[mcp_servers.probe_cmd.env]',
    `LITERAL_REF = ${JSON.stringify(REF)}`,
    '',
    '[mcp_servers.probe_url]',
    `url = ${JSON.stringify(`http://127.0.0.1:${port}/${REF}/mcp`)}`,
    '',
    '[mcp_servers.probe_url.http_headers]',
    `X-Probe-Literal = ${JSON.stringify(REF)}`,
    '',
  ].join('\n');
  return { files: { '.codex/config.toml': config }, prompt: 'Reply OK', env: { PROBE } };
}
const stateOf = (entry, name) => entry?.probe?.find(p => p.name.toLowerCase() === name.toLowerCase())?.state ?? 'absent';
export function readG4(entries) {
  const cmd = entries.find(e => e.label === 'g4-cmd');
  const http = entries.find(e => e.label === 'g4-http');
  const args = !cmd ? 'not-started' : cmd.argv.includes(PROBE) ? 'expanded' : cmd.argv.includes(REF) ? 'literal' : 'other';
  const parts = {
    args, env: !cmd ? 'not-started' : stateOf(cmd, 'LITERAL_REF'), env_vars: !cmd ? 'not-started' : stateOf(cmd, 'PROBE'),
    url: !http ? 'not-reached' : decodeURIComponent(http.url).includes(PROBE) ? 'expanded' : decodeURIComponent(http.url).includes(REF) ? 'literal' : 'other',
    header: !http ? 'not-reached' : stateOf(http, 'x-probe-literal'),
  };
  const observed = Object.entries(parts).map(([k, v]) => `${k}=${v}`).join('; ');
  if (!cmd) return { result: 'inconclusive', observed, evidence: 'The command server never started. Codex may not have trusted the project folder.' };
  return { result: 'pass', observed, evidence: `The stub logged argv (${cmd.argv.length} word(s)) and ${cmd.envNames.length} environment name(s). ${http ? 'The probe server saw one request.' : 'The probe server saw no request.'}` };
}

// ---- g6: OpenCode plugin inputs -----------------------------------------------------------------------------------
export function g6Project(sc) {
  return {
    files: {
      'opencode.json': opencodeConfig(),
      '.opencode/plugins/bowerloom-hooks.js': plugin([
        { entry: 'g6-pre', event: 'PreToolUse', command: sc.stubCommand('g6-pre') },
        { entry: 'g6-post', event: 'PostToolUse', command: sc.stubCommand('g6-post') },
      ]),
    },
    prompt: 'Run: echo hi',
  };
}
const parseStdin = entry => { try { return JSON.parse(entry?.stdin ?? ''); } catch { return null; } };
export function readG6(entries) {
  const pre = entries.find(e => e.label === 'g6-pre'), post = entries.find(e => e.label === 'g6-post');
  const describe = (name, entry) => {
    const body = parseStdin(entry);
    if (!entry) return `${name}=no-hook-call`;
    if (!body) return `${name}=stdin-not-json`;
    return `${name}.tool_name=${JSON.stringify(body.tool_name)}; ${name}.tool_input.keys=${JSON.stringify(Object.keys(body.tool_input ?? {}))}; ${name}.keys=${JSON.stringify(Object.keys(body).sort())}`;
  };
  const observed = `${describe('pre', pre)}; ${describe('post', post)}`;
  if (!pre && !post) return { result: 'inconclusive', observed, evidence: 'Neither hook ran. The plugin may not have loaded, or the model ran no tool.' };
  return { result: 'pass', observed, evidence: 'The plugin hooks ran, and the stub logged the JSON on standard input. Compare the key lists with locked-hooks.ts (ruling B19).' };
}

// ---- g7: hook blocking --------------------------------------------------------------------------------------------
export const G7_PROMPT = 'Run: touch blocked.txt';
export function g7Project(sc, engine) {
  const command = sc.stubCommand(`g7-${engine}`, { exit: 2 });
  if (engine === 'claude-code') return { files: { '.claude/settings.json': json(hookGroup('Bash', command)) }, prompt: G7_PROMPT, extra: ['--allowedTools', 'Bash'], via: 'stdin' };
  if (engine === 'codex') return { files: { '.codex/hooks.json': json(hookGroup('Bash|exec_command', command)) }, prompt: G7_PROMPT, extra: ['--sandbox', 'workspace-write', '-c', 'approval_policy="never"'], via: 'arg' };
  if (engine === 'opencode') return { files: { 'opencode.json': opencodeConfig(), '.opencode/plugins/bowerloom-hooks.js': plugin([{ entry: 'g7', event: 'PreToolUse', command }]) }, prompt: G7_PROMPT, extra: [], via: 'arg' };
  throw new Error(`no hook-blocking project for ${engine}`);
}
export function readG7(engine, entries, projectDir) {
  const ran = entries.some(e => e.label === `g7-${engine}`);
  const created = fs.existsSync(path.join(projectDir, 'blocked.txt'));
  const observed = `hook-ran=${ran}; blocked.txt-created=${created}`;
  if (!ran) return { result: 'inconclusive', observed, evidence: 'The hook never ran. It may not have loaded, need a trust step, or the model ran no command.' };
  if (created) return { result: 'fail', observed, evidence: 'The hook ran and exited 2, and the command still ran. The hook did not block.' };
  return { result: 'pass', observed, evidence: 'The hook ran, exited 2, and the command did not run.' };
}

// ---- g8: Codex permission profile ---------------------------------------------------------------------------------
export const G8_READ_PROMPT = 'Run `cat open.txt secret.txt` and print the full output. If a command fails, print the error.';
export const G8_PATCH_PROMPT = 'Use apply_patch to replace the whole content of secret.txt with the single line patched-by-live-check. If it fails, print the error.';
export function g8Project() {
  const config = [
    'default_permissions = "bowerloom"',
    '',
    '[permissions.bowerloom]',
    'extends = ":workspace"',
    '',
    '[permissions.bowerloom.filesystem.":workspace_roots"]',
    '"secret.txt" = "deny"',
    '',
  ].join('\n');
  return { files: { '.codex/config.toml': config, 'secret.txt': `${SECRET_MARK}\n`, 'open.txt': `${OPEN_MARK}\n` }, extra: ['-c', 'approval_policy="never"'] };
}
export function readG8(readOut, patchOut, projectDir) {
  const text = out => `${out.stdout}\n${out.stderr}`;
  const sawOpen = text(readOut).includes(OPEN_MARK), leaked = text(readOut).includes(SECRET_MARK);
  const secret = fs.readFileSync(path.join(projectDir, 'secret.txt'), 'utf8');
  const patched = secret.trim() !== SECRET_MARK;
  const parsed = /unknown|invalid|permission|profile/i.test(text(readOut)) ? 'engine-mentioned-profile-or-permission' : 'no-profile-message';
  // An unchanged secret.txt alone does not show that apply_patch ran: the model may have run nothing. The patch turn must
  // name secret.txt and a refusal.
  const refused = text(patchOut).includes('secret.txt') && /denied|permission|not permitted|rejected|blocked|read-only|forbidden|failed|error/i.test(text(patchOut));
  const observed = `open.txt-read=${sawOpen}; secret.txt-leaked=${leaked}; secret.txt-patched=${patched}; patch-refusal-shown=${refused}; ${parsed}`;
  if (leaked || patched) return { result: 'fail', observed, evidence: 'The deny entry did not hold for secret.txt.' };
  if (!sawOpen) return { result: 'inconclusive', observed, evidence: 'The read turn did not show open.txt, so the profile may have failed to load or the model ran no command.' };
  if (!refused) return { result: 'inconclusive', observed, evidence: 'The patch turn shows no refusal for secret.txt, so apply_patch may not have run.' };
  return { result: 'pass', observed, evidence: 'open.txt was readable, secret.txt was neither shown nor changed, and the patch turn shows a refusal for secret.txt. The profile syntax loaded.' };
}

// ---- g9: --ignore-rules --------------------------------------------------------------------------------------------
export const G9_PROMPT = 'Run: touch ignore-probe.txt';
export function g9Project() {
  const rule = 'prefix_rule(\n    pattern = ["touch"],\n    decision = "forbidden",\n    justification = "Live check: touch is forbidden here.",\n)\n';
  return { files: { '.codex/rules/bowerloom.rules': rule, '.codex/config.toml': '# live check\n' }, prompt: G9_PROMPT };
}
/** The Codex argv of packages/team/src/engines.ts, with the binary the person named and the message on standard input. */
export function g9Argv(binary) {
  const row = START_TABLE.codex.headless;
  if (!row.supported) throw new Error('the Codex headless start row is not supported');
  return { words: [binary, ...row.argv.slice(1)], extra: ['-'] };
}
export function readG9(out, projectDir) {
  const created = fs.existsSync(path.join(projectDir, 'ignore-probe.txt'));
  const text = `${out.stdout}\n${out.stderr}`;
  const mentioned = /forbidden|rule|policy/i.test(text);
  const observed = `ignore-probe.txt-created=${created}; output-mentions-rule=${mentioned}`;
  if (created) return { result: 'pass', observed, evidence: 'The project rule did not stop touch. With --ignore-rules the project rules file is dropped, so TEAM_START_UNPINNED stays.' };
  if (mentioned) return { result: 'pass', observed, evidence: 'touch did not run and the output names a rule. With --ignore-rules the project rules file is kept.' };
  return { result: 'inconclusive', observed, evidence: 'touch did not run and the output names no rule. The model may have declined.' };
}

// ---- g10: Claude Code --setting-sources ---------------------------------------------------------------------------
export const G10_PROMPT = 'Run: touch pinned.txt';
export function g10Project() {
  return { files: { '.claude/settings.json': json({ permissions: { deny: ['Bash(touch pinned.txt)'] } }) }, prompt: G10_PROMPT };
}
/** The first line of `--help` output that names the flag (it shows the value form), or null. */
export function settingSourcesHelp(helpText) {
  const lines = String(helpText).split('\n');
  const at = lines.findIndex(l => l.includes('--setting-sources'));
  return at < 0 ? null : lines[at].trim().slice(0, 300);
}
export function readG10(helpLine, projectOnly, userOnly) {
  const observed = `help=${helpLine ? 'names --setting-sources' : 'no --setting-sources'}; project,local: touch-ran=${projectOnly}; user: touch-ran=${userOnly}`;
  if (!helpLine) return { result: 'inconclusive', observed, evidence: 'claude --help does not name --setting-sources, so no turn was spent.' };
  if (projectOnly) return { result: 'fail', observed, evidence: 'With --setting-sources project,local the project deny did not stop touch.' };
  if (!userOnly) return { result: 'inconclusive', observed, evidence: 'Neither run created the file, so the user-only run did not show that the project deny was left out.' };
  return { result: 'pass', observed, evidence: `The value form is recorded: ${helpLine}. project,local applied the project deny, and user left it out.` };
}

// ---- g11: Claude Code defaults ------------------------------------------------------------------------------------
export const G11_FILE = 'notes.txt';
export function g11Prompt(port) {
  return `Do these four steps in order, one tool each, and carry on if one fails. 1. Use the Read tool on ${G11_FILE}. 2. Use the Edit tool to change alpha to beta in ${G11_FILE}. 3. Use the Bash tool to run: echo hi. 4. Use the WebFetch tool on http://127.0.0.1:${port}/. Then say done.`;
}
export const g11Project = () => ({ files: { [G11_FILE]: 'alpha\n' }, extra: ['--output-format', 'json'] });
/** The result object of `--output-format json` output: one object, or the `result` entry of a list. */
export function resultObject(stdout) {
  let value;
  try { value = JSON.parse(stdout); } catch { return null; }
  if (Array.isArray(value)) value = value.find(v => v?.type === 'result') ?? null;
  return value && typeof value === 'object' ? value : null;
}
export function readG11(stdout, projectDir, entries) {
  const obj = resultObject(stdout);
  const edited = fs.readFileSync(path.join(projectDir, G11_FILE), 'utf8').includes('beta');
  const fetched = entries.some(e => e.label === 'g11-http');
  if (!obj || !Array.isArray(obj.permission_denials)) return { result: 'inconclusive', observed: `edited=${edited}; fetched=${fetched}; permission_denials=missing`, evidence: 'The JSON output has no permission_denials list.' };
  const denied = [...new Set(obj.permission_denials.map(d => d?.tool_name).filter(n => typeof n === 'string'))].sort();
  return { result: 'pass', observed: `denied=${JSON.stringify(denied)}; edited=${edited}; fetched=${fetched}`, evidence: `permission_denials held ${obj.permission_denials.length} entry(ies). Compare with CLAUDE_CODE_DEFAULT in claude-code.ts.` };
}
