/**
 * The static check of the real-setup reader: "this code can read, and it cannot write, run a program, reach the network or evaluate text".
 *
 * It does not trust a pattern over the source text. It asks esbuild (a real parser, already a dev dependency; `typescript` 7 has no in-process syntax API) for two things:
 *  1. the module graph of the entry files, with every relative import resolved and followed transitively (the build's metafile), and which of those files put code in the
 *     bundle (after tree shaking);
 *  2. each file of that graph as plain JavaScript (types gone, JSX turned into calls, comments gone), with `import` lines kept exactly as written.
 * It then reads that JavaScript with a small tokenizer that knows strings, template literals, comments and regular expressions, so the text of a string or a comment can
 * neither hide a call nor make one up. The rules are in `Policy`; the check itself is `checkEntries`, and tests/real-static.test.ts holds the real files to it and also
 * feeds it deliberately bad files, to prove it fails when it should.
 *
 * A bundler asks the same graph question but cannot be asked "is this safe"; this file is the part that asks it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------------------------------------------------- the tokenizer

export interface Token { readonly type: 'id' | 'str' | 'tpl' | 'num' | 'punct' | 'regex'; readonly text: string; readonly pos: number }

const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const isIdStart = (c: string): boolean => /[A-Za-z_$#\u0080-\uffff]/.test(c);
const isIdPart = (c: string): boolean => /[A-Za-z0-9_$\u0080-\uffff]/.test(c);

/** The tokens of JavaScript source (the output of a transform: plain JavaScript, with no types and no JSX). Never throws; an unfinished string or comment ends at the end of the text. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const braces: number[] = [];
  let depth = 0, i = 0;
  const n = src.length;
  const lastSignificant = (): Token | undefined => out[out.length - 1];
  const scanTemplate = (from: number): number => {
    // From just after a backtick or just after the closing brace of a substitution, to the end of this chunk. Returns the index after the chunk.
    let j = from, chunk = '';
    while (j < n) {
      const c = src[j]!;
      if (c === '\\') { chunk += src.slice(j, j + 2); j += 2; continue; }
      if (c === '`') { out.push({ type: 'tpl', text: chunk, pos: from }); return j + 1; }
      if (c === '$' && src[j + 1] === '{') { out.push({ type: 'tpl', text: chunk, pos: from }); braces.push(depth); depth += 1; return j + 2; }
      chunk += c; j += 1;
    }
    out.push({ type: 'tpl', text: chunk, pos: from });
    return j;
  };
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff' || c === '\u2028' || c === '\u2029') { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue; }
    if (c === '"' || c === '\'') {
      let j = i + 1, text = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; } else { text += src[j]; j += 1; } }
      out.push({ type: 'str', text: unescape(text), pos: i }); i = j + 1; continue;
    }
    if (c === '`') { i = scanTemplate(i + 1); continue; }
    if (c === '}' && braces.length > 0 && braces[braces.length - 1] === depth - 1) { braces.pop(); depth -= 1; i = scanTemplate(i + 1); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && (/[0-9A-Za-z_.]/.test(src[j]!) || ((src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1]!) && !/^0[xX]/.test(src.slice(i, j))))) j += 1;
      out.push({ type: 'num', text: src.slice(i, j), pos: i }); i = j; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src[j]!)) j += 1;
      out.push({ type: 'id', text: src.slice(i, j), pos: i }); i = j; continue;
    }
    if (c === '/') {
      const prev = lastSignificant();
      const division = prev !== undefined && (prev.type === 'num' || prev.type === 'str' || prev.type === 'tpl' || prev.type === 'regex' || (prev.type === 'id' && !BEFORE_REGEX.has(prev.text)) || (prev.type === 'punct' && (prev.text === ')' || prev.text === ']' || prev.text === '}')));
      if (!division) {
        let j = i + 1, inClass = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; else if (src[j] === '/' && !inClass) break;
          j += 1;
        }
        j += 1;
        while (j < n && isIdPart(src[j]!)) j += 1;
        out.push({ type: 'regex', text: src.slice(i, j), pos: i }); i = j; continue;
      }
    }
    if (c === '{') depth += 1; else if (c === '}') depth -= 1;
    out.push({ type: 'punct', text: c, pos: i }); i += 1;
  }
  return out;
}

function unescape(text: string): string {
  return text.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[\s\S])/g, (_m, all: string, braced: string | undefined, four: string | undefined, two: string | undefined) => {
    if (braced !== undefined) return String.fromCodePoint(parseInt(braced, 16));
    if (four !== undefined) return String.fromCharCode(parseInt(four, 16));
    if (two !== undefined) return String.fromCharCode(parseInt(two, 16));
    return all === 'n' ? '\n' : all === 't' ? '\t' : all === 'r' ? '\r' : all === '0' ? '\0' : all;
  });
}

// ---------------------------------------------------------------------------------------------------------------------- the rules

/** Which members of a module may be imported: a list, or `'*'` for any (and the default, and a namespace). */
export type ModuleRule = readonly string[] | '*';

export interface Policy {
  /** Whether a file (its path relative to the desktop folder, with `/`; or absolute when it is outside) may be part of the reader. */
  readonly allowFile: (rel: string) => boolean;
  /** Files the build reaches but that put no code in the bundle (a re-export nobody uses), with the reason. A file here is not scanned. */
  readonly deadOk: Readonly<Record<string, string>>;
  readonly modules: Readonly<Record<string, ModuleRule>>;
  /** Identifier names that are also refused, beyond the shared list. */
  readonly extraNames?: RegExp;
  /** Sequences of identifiers (joined with `.`) that are refused, e.g. `window.bowerloom`. */
  readonly extraPaths?: readonly string[];
  /**
   * Names and strings tolerated in one named file, with the reason. For a helper that the reader imports but does not own, whose own code uses a name for something else
   * (a regular expression's `.exec`). A file here is still held to every other rule.
   */
  readonly tolerate?: Readonly<Record<string, { readonly names?: RegExp; readonly strings?: RegExp; readonly why: string }>>;
}

/** Names of things that write, delete, rename, link, change a mode, start a process or reach the network. A name with a capital after it is the same family (`writeFileSync`, `execSync`). */
export const BANNED_NAME = /^(?:write|append|rm|rmdir|unlink|rename|copy|cp|chmod|chown|lchown|lchmod|truncate|ftruncate|symlink|link|mkdir|mkdtemp|utimes|futimes|lutimes|spawn|exec|execFile|fork|fetch|request|createWriteStream|fsync|fdatasync|binding|dlopen)(?:[A-Z_$][A-Za-z0-9_$]*)?$/;
/** Names that run text as code, open a channel to the network, or reach the whole process. */
export const BANNED_EXACT = /^(?:WebSocket|XMLHttpRequest|EventSource|eval|Function|require|__require|process|globalThis|importScripts|sendBeacon|Worker|SharedWorker)$/;
/** The only flags a file may be opened with. */
const OPEN_FLAGS = new Set(['O_RDONLY', 'O_NONBLOCK', 'O_NOFOLLOW']);

/** Strings that name a banned thing: `fs['writeFileSync']`, `import('node:child_process')`. */
const bannedString = (text: string): boolean => BANNED_NAME.test(text) || BANNED_EXACT.test(text) || text === 'constructor' || /^(?:node:)?(?:child_process|worker_threads|cluster|net|http|https|http2|dgram|dns|tls|vm|inspector|fs\/promises|repl)$/.test(text);

interface Import { readonly from: string; readonly members: readonly string[]; readonly pos: number }

/**
 * The `import ... from` and `export ... from` lines of one file, read from its tokens, however many lines they take. A dynamic `import(` is not one of them; a local
 * `export { a }` and `export const a` are not either (they name nothing outside the file).
 */
export function importsOf(tokens: readonly Token[]): Import[] {
  const found: Import[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.type !== 'id' || (t.text !== 'import' && t.text !== 'export')) continue;
    const next = tokens[i + 1];
    if (next === undefined || (t.text === 'import' && (next.text === '(' || next.text === '.'))) continue;
    if (t.text === 'import' && next.type === 'str') { found.push({ from: next.text, members: [], pos: t.pos }); continue; }
    if (t.text === 'export' && next.text !== '{' && next.text !== '*') continue;
    // The clause runs up to the `from` that is followed by a string.
    const members: string[] = [];
    let j = i + 1, inBraces = false, from: string | null = null;
    for (; j < tokens.length; j += 1) {
      const u = tokens[j]!;
      if (u.type === 'punct' && u.text === ';') break;
      if (u.type === 'punct' && u.text === '{') { inBraces = true; continue; }
      if (u.type === 'punct' && u.text === '}') { inBraces = false; continue; }
      if (u.type === 'id' && u.text === 'from' && !inBraces && tokens[j + 1]?.type === 'str') { from = tokens[j + 1]!.text; break; }
      if (u.type === 'punct' && u.text === '*') { members.push('*'); continue; }
      if (u.type !== 'id' || u.text === 'as') continue;
      if (tokens[j - 1]?.text === 'as' && tokens[j - 1]?.type === 'id') continue;
      members.push(inBraces ? u.text : t.text === 'import' ? 'default' : u.text);
    }
    if (from !== null) found.push({ from, members, pos: t.pos });
  }
  return found;
}

/** What is wrong with one file (as plain JavaScript). Empty when it is fine. */
export function problemsOfSource(rel: string, js: string, policy: Policy): string[] {
  const tokens = tokenize(js), problems: string[] = [];
  const allowed = policy.tolerate?.[rel];
  const say = (what: string): void => { problems.push(`${rel}: ${what}`); };
  for (const imp of importsOf(tokens)) {
    if (imp.from.startsWith('.')) continue; // a relative import is held by the file list, not the module list
    const rule = policy.modules[imp.from];
    if (rule === undefined) { say(`imports ${imp.from}, which the reader may not use`); continue; }
    if (rule === '*') continue;
    if (imp.members.length === 0) say(`imports ${imp.from} for its effects`);
    for (const member of imp.members) if (!rule.includes(member)) say(`imports ${member} from ${imp.from}`);
  }
  const allowedFlag = (text: string): boolean => OPEN_FLAGS.has(text);
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, prev = tokens[i - 1], next = tokens[i + 1];
    if (t.type === 'id') {
      if (t.text === 'import' && next?.text === '(') say('uses a dynamic import');
      else if ((BANNED_NAME.test(t.text) || BANNED_EXACT.test(t.text) || (policy.extraNames?.test(t.text) ?? false)) && !(allowed?.names?.test(t.text) ?? false)) say(`uses ${t.text}`);
      else if (t.text === 'constructor' && prev?.text === '.' && tokens[i - 2]?.text === 'constructor') say('uses constructor.constructor');
      else if (t.text === 'constructor' && next?.text === '.' && tokens[i + 2]?.text === 'constructor') say('uses constructor.constructor');
      else if (t.text.startsWith('O_') && !allowedFlag(t.text)) say(`uses the open flag ${t.text}`);
      if (policy.extraPaths !== undefined && next?.text === '.' && tokens[i + 2]?.type === 'id' && policy.extraPaths.includes(`${t.text}.${tokens[i + 2]!.text}`)) say(`uses ${t.text}.${tokens[i + 2]!.text}`);
    } else if ((t.type === 'str' || t.type === 'tpl') && bannedString(t.text) && !(prev?.text === 'from' || (prev?.text === 'import' && t.type === 'str')) && !(allowed?.strings?.test(t.text) ?? false)) {
      say(`has the text "${t.text.slice(0, 40)}", which names a banned thing`);
    }
    // Every `openSync(path, flags)` passes the one flags constant, and nothing else.
    if (t.type === 'id' && t.text === 'openSync' && next?.text === '(' && prev?.text !== 'function') {
      const args = argumentsOf(tokens, i + 1);
      if (args.length !== 2 || args[1]!.length !== 1 || !/^OPEN_READ\d*$/.test(args[1]![0]!.text)) say('calls openSync with flags other than OPEN_READ');
    }
    if (t.type === 'id' && /^OPEN_READ\d*$/.test(t.text) && next?.text === '=' && prev?.text !== '.') {
      const declared: string[] = [];
      for (let j = i + 2; j < tokens.length && tokens[j]!.text !== ';'; j += 1) declared.push(tokens[j]!.text);
      const stray = declared.filter(x => !(x === 'constants' || x === '.' || x === '|' || x === '(' || x === ')' || x === '?' || x === '0' || OPEN_FLAGS.has(x)));
      if (stray.length > 0) say(`builds OPEN_READ from ${stray.join(' ')}`);
      if (!declared.includes('O_RDONLY')) say('builds OPEN_READ without O_RDONLY');
    }
  }
  return problems;
}

/** The arguments of the call whose `(` is at `open`, each as its tokens. */
function argumentsOf(tokens: readonly Token[], open: number): Token[][] {
  const args: Token[][] = [[]];
  let depth = 0;
  for (let i = open; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.type === 'punct' && (t.text === '(' || t.text === '[' || t.text === '{')) { depth += 1; if (depth === 1) continue; }
    if (t.type === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) { depth -= 1; if (depth === 0) break; }
    if (t.type === 'punct' && t.text === ',' && depth === 1) { args.push([]); continue; }
    args[args.length - 1]!.push(t);
  }
  return args[0]!.length === 0 && args.length === 1 ? [] : args;
}

// ---------------------------------------------------------------------------------------------------------------------- asking esbuild

const CHILD = `
import { build, transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
const { entries, format, platform, packages } = JSON.parse(process.argv[1]);
const result = await build({ entryPoints: entries, bundle: true, write: false, metafile: true, ...(packages === 'external' ? { packages: 'external' } : {}), format, platform, outdir: 'out', logLevel: 'silent', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } });
const used = {};
for (const output of Object.values(result.metafile.outputs)) for (const [file, info] of Object.entries(output.inputs)) used[file] = (used[file] ?? 0) + info.bytesInOutput;
const loaders = { '.ts': 'ts', '.tsx': 'tsx', '.mjs': 'js', '.js': 'js', '.cjs': 'js', '.jsx': 'jsx' };
const files = [];
for (const file of Object.keys(result.metafile.inputs)) {
  const abs = resolve(process.cwd(), file), loader = loaders[extname(file)];
  let js = '';
  if (loader !== undefined) js = transformSync(readFileSync(abs, 'utf8'), { loader, format: 'esm', jsx: 'automatic', sourcefile: abs, tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } } }).code;
  files.push({ abs, bytes: used[file] ?? 0, js, externals: result.metafile.inputs[file].imports.filter(i => i.external).map(i => i.path), kinds: result.metafile.inputs[file].imports.map(i => i.kind) });
}
process.stdout.write(JSON.stringify({ files, inputs: Object.keys(result.metafile.inputs), outputs: result.outputFiles.map(f => f.text) }));
`;

export interface Bundle { readonly files: readonly { readonly abs: string; readonly bytes: number; readonly js: string; readonly externals: readonly string[]; readonly kinds: readonly string[] }[]; readonly inputs: readonly string[]; readonly outputs: readonly string[] }

/** Builds the entry files in memory (all imports followed; packages left out) and hands back every file of the graph as plain JavaScript. Throws if the build fails. */
export function bundleOf(entries: readonly string[], desktop: string, format: 'esm' | 'cjs' | 'iife' = 'esm', platform: 'node' | 'browser' = 'node', packages: 'external' | 'bundle' = 'external'): Bundle {
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, JSON.stringify({ entries, format, platform, packages })], { cwd: desktop, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
  if (ran.status !== 0) throw new Error(`The build for the static check failed: ${ran.stderr || String(ran.error)}`);
  return JSON.parse(ran.stdout) as Bundle;
}

/**
 * Checks the entry files and everything they import, however deep: every file of the graph must be allowed, every import must be on the list, and no file may use a banned
 * name. A file the build reached but dropped from the bundle (a re-export nobody uses) must be named in `deadOk` with its reason.
 */
export function checkEntries(entries: readonly string[], desktop: string, policy: Policy, format: 'esm' | 'cjs' | 'iife' = 'esm', platform: 'node' | 'browser' = 'node'): string[] {
  const bundle = bundleOf(entries, desktop, format, platform);
  const problems: string[] = [];
  for (const file of bundle.files) {
    const rel = isAbsolute(file.abs) && !file.abs.startsWith(resolve(desktop) + '/') ? file.abs : relative(desktop, file.abs).split('\\').join('/');
    if (file.js === '' && !policy.allowFile(rel)) { problems.push(`${rel}: is not a file the reader may import`); continue; }
    if (rel in policy.deadOk) { if (file.bytes > 0) problems.push(`${rel}: is allowed only as dead code (${policy.deadOk[rel]}) but puts code in the bundle`); continue; }
    if (!policy.allowFile(rel)) { problems.push(`${rel}: is imported by the reader but is not on the list of files it may use`); continue; }
    problems.push(...problemsOfSource(rel, file.js, policy));
  }
  return problems;
}

/** The text of a built file, checked for the same names. `allowRequire` lists the only packages a `require` may name (the bridge asks for `electron`). */
export function problemsOfBuilt(rel: string, text: string, policy: Policy, allowRequire: readonly string[] = []): string[] {
  const tokens = tokenize(text), problems: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1];
    if (t.type === 'id' && t.text === 'require' && next?.text === '(' && tokens[i + 2]?.type === 'str' && tokens[i + 3]?.text === ')' && allowRequire.includes(tokens[i + 2]!.text)) { i += 3; continue; }
    if (t.type === 'id' && (BANNED_NAME.test(t.text) || BANNED_EXACT.test(t.text) || (policy.extraNames?.test(t.text) ?? false))) problems.push(`${rel}: uses ${t.text}`);
    if (t.type === 'id' && t.text === 'import' && next?.text === '(') problems.push(`${rel}: uses a dynamic import`);
  }
  return problems;
}

/**
 * A built bundle that holds libraries (the page script holds React). The libraries use names like `requestUpdateLane` and `fetchPriority` for their own business, so this
 * looks only for the names that open a channel out of the page or run text as code. The reader's own code in that bundle is held to the full list at the source, by `checkEntries`.
 */
export const LIBRARY_BANNED = /^(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval|Function|importScripts|Worker|SharedWorker)$/;
export function problemsOfLibraryBundle(rel: string, text: string): string[] {
  const tokens = tokenize(text), problems: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1];
    if (t.type === 'id' && LIBRARY_BANNED.test(t.text)) problems.push(`${rel}: uses ${t.text}`);
    // `function __require() {...}` is the name of the wrapper esbuild puts round a library module, not a call to require.
    if (t.type === 'id' && (t.text === 'require' || t.text === '__require') && next?.text === '(' && tokens[i - 1]?.text !== 'function') problems.push(`${rel}: calls ${t.text}`);
    if (t.type === 'id' && t.text === 'import' && next?.text === '(') problems.push(`${rel}: uses a dynamic import`);
    if (t.type === 'id' && t.text === 'process' && next?.text === '.' && tokens[i + 2]?.text === 'binding') problems.push(`${rel}: uses process.binding`);
  }
  return problems;
}

export const readSource = (desktop: string, file: string): string => readFileSync(resolve(desktop, file), 'utf8');
