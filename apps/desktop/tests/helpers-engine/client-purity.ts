/**
 * The static check of client purity (v0.9, lane L4d). A screen of the desktop renderer reaches the engine only through the engine API client (renderer/api/client.ts).
 * So no renderer file may import an engine, a Node module or Electron, name a bridge or an IPC channel, or call a file, a process or the network.
 *
 * The check reads source, never runs it. Each file is read twice:
 *  - as plain JavaScript (esbuild strips the types and the JSX), through the tokenizer of tests/fixtures-real/static-check.ts, for names and calls;
 *  - as raw text, for the import lines, because esbuild drops a type-only import and a type from `main/` is still a dependency on the engine.
 * An allowance is one file, one rule and one reason. A rule with no allowance that matches is a failure of the test, so no allowance outlives its need.
 */
import { posix } from 'node:path';
import { importsOf, tokenize } from '../fixtures-real/static-check.js';
import type { Token } from '../fixtures-real/static-check.js';

export type Rule = 'bare-import' | 'outside-import' | 'engine-implementation' | 'client-only' | 'bridge-name' | 'ipc-name' | 'file-or-process-call' | 'network-or-eval' | 'side-channel';

export interface Allowance { readonly file: string; readonly rule: Rule; readonly detail: RegExp; readonly why: string }
export interface Problem { readonly file: string; readonly rule: Rule; readonly text: string }

/** The only modules outside the renderer that a renderer file may import. */
export const BARE_MODULES: ReadonlySet<string> = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']);

/**
 * The modules of shared/engine and shared/real that a renderer file may import. Each holds types, constants and pure helpers, and imports no engine code.
 * A new module of those two folders is refused until it is added here, with its reason.
 */
export const PURE_SHARED: Readonly<Record<string, string>> = Object.freeze({
  'shared/engine/types': 'the types of the 39 calls, their views and the plain constants of the contract',
  'shared/engine/engines': 'the engine names and the preview test, re-exported from the definition words',
  'shared/engine/gates': 'pure functions that decide what a sheet shows from a plan it already holds',
  'shared/engine/start-command': 'the limit and the words of the start command, which the sheet shows',
  'shared/real/types': 'the types and limits of the three reader calls',
  'shared/real/saved-scan': 'the types of the saved-scan answer',
});

/** A module that only some files may import, with the reason. `members`, when given, limits the rule to those imported names. */
export interface Restriction { readonly module: string; readonly importers: readonly string[]; readonly members?: readonly string[]; readonly why: string }
export const RESTRICTIONS: readonly Restriction[] = Object.freeze([
  { module: 'renderer/api/transport', importers: ['renderer/api/client.ts'], why: 'the transport reads the window; only the client may ask it' },
  { module: 'shared/engine/sample', importers: ['renderer/api/client.ts'], why: 'the sample engine answers the engine calls in memory; only the client may hand it out' },
  { module: 'shared/engine/sample-switch', importers: ['renderer/api/transport.ts'], why: 'the sample switch is read from the page; only the transport reads the page' },
  { module: 'renderer/api/client', members: ['getApiClient', 'createApiClient'], importers: ['renderer/harness/mount.tsx'], why: 'the page entry makes the client once and hands each part down; a screen asks the tree, not the window' },
]);

const BRIDGE_NAME = /^bowerloom(?:Real|Engine)$/;
const BRIDGE_STRING = /^bowerloom(?:Real|Engine)\b|^bowerloom-(?:real|engine)\b/;
const GLOBALS = new Set(['window', 'self', 'globalThis', 'top', 'parent', 'frames']);
const IPC_NAME = /^(?:ipcRenderer|ipcMain|contextBridge|webContents|require|__require|process)$/;
const FILE_CALL = /^(?:readFile|readFileSync|readdir|readdirSync|writeFile|writeFileSync|appendFile|appendFileSync|mkdirSync|mkdtempSync|rmSync|rmdirSync|unlinkSync|renameSync|copyFile|copyFileSync|statSync|lstatSync|realpathSync|openSync|opendirSync|createReadStream|createWriteStream|spawn|spawnSync|execSync|execFile|execFileSync|fork)$/;
const NETWORK_OR_EVAL = /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|Worker|SharedWorker|BroadcastChannel|MessageChannel|importScripts|eval|Function|postMessage)$/;

/** The import specifiers of one file in its raw text, type-only imports included. */
export function specifiersOf(raw: string): string[] {
  const found: string[] = [];
  for (const match of raw.matchAll(/^[ \t]*(?:import|export)\b(?:[^;'"`]*?\bfrom\b)?\s*['"]([^'"\n]+)['"]/gm)) found.push(match[1]!);
  return found;
}

/** The path of a relative specifier from a file, in the desktop folder, without its extension. `null` for a bare module. */
export function resolveSpecifier(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.(?:js|ts|tsx|css)$/, '');
}

/** The name after `object.` or `object?.` at token `i`, when token `i` is a global object. */
const memberAfter = (tokens: readonly Token[], i: number): Token | undefined => {
  let j = i + 1;
  if (tokens[j]?.text === '?') j += 1;
  return tokens[j]?.text === '.' ? tokens[j + 1] : undefined;
};

/** What is wrong with one renderer file. `raw` is its text and `js` the same file as plain JavaScript. Allowances are applied by the caller. */
export function problemsOfRenderer(file: string, raw: string, js: string): Problem[] {
  const problems: Problem[] = [];
  const say = (rule: Rule, text: string): void => { problems.push({ file, rule, text }); };
  const tokens = tokenize(js);

  for (const spec of new Set(specifiersOf(raw))) {
    const target = resolveSpecifier(file, spec);
    if (target === null) {
      if (!BARE_MODULES.has(spec)) say('bare-import', `imports ${spec}`);
      continue;
    }
    if (!target.startsWith('renderer/') && !target.startsWith('shared/')) { say('outside-import', `imports ${spec}, which is outside the renderer and shared folders`); continue; }
    if ((target.startsWith('shared/engine/') || target.startsWith('shared/real/')) && !Object.hasOwn(PURE_SHARED, target) && !RESTRICTIONS.some(r => r.module === target)) say('engine-implementation', `imports ${target}, which is not on the list of pure shared modules`);
    for (const r of RESTRICTIONS) {
      if (r.module === target && r.members === undefined && !r.importers.includes(file)) say('client-only', `imports ${target}: ${r.why}`);
    }
  }
  // Members are read from the runtime imports. A type is erased and gives nothing to call.
  for (const imp of importsOf(tokens)) {
    const target = resolveSpecifier(file, imp.from);
    if (target === null) continue;
    for (const r of RESTRICTIONS) {
      if (r.module !== target || r.members === undefined || r.importers.includes(file)) continue;
      for (const member of imp.members) if (r.members.includes(member)) say('client-only', `imports ${member} from ${target}: ${r.why}`);
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, prev = tokens[i - 1], next = tokens[i + 1];
    if (t.type === 'id') {
      // `window.fetch` is the global; `engine.fetch` is a member of something else.
      const onGlobal = prev?.text === '.' && GLOBALS.has(tokens[tokens[i - 2]?.text === '?' ? i - 3 : i - 2]?.text ?? '');
      if (BRIDGE_NAME.test(t.text)) say('bridge-name', `names ${t.text}`);
      else if (IPC_NAME.test(t.text) && (prev?.text !== '.' || onGlobal)) say('ipc-name', `uses ${t.text}`);
      else if (FILE_CALL.test(t.text) && next?.text === '(') say('file-or-process-call', `calls ${t.text}`);
      else if (NETWORK_OR_EVAL.test(t.text) && (prev?.text !== '.' || onGlobal)) say('network-or-eval', `uses ${t.text}`);
      else if (t.text === 'import' && next?.text === '(') say('network-or-eval', 'uses a dynamic import');
      if (GLOBALS.has(t.text) && prev?.text !== '.') {
        const member = memberAfter(tokens, i);
        if (member?.type === 'id' && member.text.startsWith('bowerloom')) say('bridge-name', `reads ${t.text}.${member.text}`);
        if (member?.type === 'id' && member.text === 'electron') say('ipc-name', `reads ${t.text}.electron`);
        if (member?.type === 'id' && member.text === 'close') say('side-channel', `calls ${t.text}.close, which asks main to close the window`);
      }
      // `x.title = ...` sets the page title, which main reads.
      if (t.text === 'title' && prev?.text === '.' && next?.text === '=' && tokens[i + 2]?.text !== '=') say('side-channel', 'sets the page title, which main can read');
    } else if (t.type === 'str' || t.type === 'tpl') {
      if (BRIDGE_STRING.test(t.text)) say('bridge-name', `has the text "${t.text.slice(0, 40)}", which names a bridge or a channel`);
      if (t.type === 'str' && t.text === 'beforeunload' && prev?.text !== 'from') say('side-channel', 'listens for beforeunload, which main answers with its own box');
    }
  }
  return problems;
}

/** Splits problems into the ones an allowance covers and the rest. `used` gives, for each allowance, how many problems it covered. */
export function applyAllowances(problems: readonly Problem[], allowances: readonly Allowance[]): { readonly open: Problem[]; readonly used: Map<Allowance, number> } {
  const used = new Map<Allowance, number>(allowances.map(a => [a, 0]));
  const open: Problem[] = [];
  for (const p of problems) {
    const hit = allowances.find(a => a.file === p.file && a.rule === p.rule && a.detail.test(p.text));
    if (hit === undefined) open.push(p); else used.set(hit, used.get(hit)! + 1);
  }
  return { open, used };
}
