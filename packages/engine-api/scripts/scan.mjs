// The reader of the base source for the engine API golden file. It reads text only. It never imports, runs or loads the files it reads, and it imports nothing from
// apps/desktop. make-golden.mjs calls it to make the golden file, and test/golden.test.mjs calls it to check the golden file against the source.
//
// What it reads, all in apps/desktop:
//  - the library source: main/engine-*.ts, main/real-*.ts, shared/engine/*.ts and shared/real/*.ts.
//  - the call lists and tables in shared/engine/types.ts and shared/real/types.ts.
//  - the argument counts in main/engine-ipc.ts and main/real-ipc.ts, the reader's refusal class in main/real-scan.ts, and the named outcomes in main/engine-consent.ts.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DESKTOP = 'apps/desktop';
/** Where the library source lives, as a folder and a file-name pattern. */
const SOURCE_PARTS = [
  { dir: `${DESKTOP}/main`, name: /^(?:engine|real)-[^/]+\.ts$/ },
  { dir: `${DESKTOP}/shared/engine`, name: /^[^/]+\.ts$/ },
  { dir: `${DESKTOP}/shared/real`, name: /^[^/]+\.ts$/ },
];

/** The files the scan reads, as paths from the repository root with forward slashes, in sorted order. */
export function listBaseSources(root) {
  const found = [];
  for (const part of SOURCE_PARTS) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, part.dir)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of names) if (part.name.test(name)) found.push(`${part.dir}/${name}`);
  }
  return found.sort();
}

const sorted = list => [...new Set(list)].sort();

/**
 * The code-like literals of one text. A literal is a quoted string, single or double, of upper-case words joined by underscores (`'SAVE_STALE'`). A single upper-case word
 * (`'FAILED'`) counts only where it is a refusal: `code: 'X'`, `Refusal('X'`, `refuse('X'`, `new Error('X')`, or `export const X = 'X'`. The scan reads comments too, so it
 * finds more than the running code uses. Some matches are not codes (the name of an environment variable, for example). That is on purpose: the golden file lists
 * what is found, and a test holds the source to it.
 */
export function codeLiteralsOf(text) {
  const codes = [];
  for (const m of text.matchAll(/(['"])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\1/g)) codes.push(m[2]);
  for (const m of text.matchAll(/(?:code\s*:\s*|Refusal\(\s*|refuse\w*\(\s*|new Error\(\s*)(['"])([A-Z]{3,})\1/g)) codes.push(m[2]);
  for (const m of text.matchAll(/export const ([A-Z]{3,}) = (['"])\1\2/g)) codes.push(m[1]);
  return { codes: sorted(codes) };
}

/** The text between the first `open` after `from` and the next `close`, or null. */
function between(text, from, open, close) {
  const start = text.indexOf(from);
  if (start < 0) return null;
  const a = text.indexOf(open, start);
  if (a < 0) return null;
  const b = text.indexOf(close, a + open.length);
  return b < 0 ? null : text.slice(a + open.length, b);
}

const quotedIn = body => [...body.matchAll(/'([^']*)'/g)].map(m => m[1]);

/**
 * The calls of both sides, from the text of the files. `types` is shared/engine/types.ts, `ipc` is main/engine-ipc.ts, `real` is shared/real/types.ts and `realIpc` is
 * main/real-ipc.ts. A side whose text is left out gives an empty list.
 */
export function callsOf({ types = '', ipc = '', real = '', realIpc = '' }) {
  const engineCalls = [];
  const names = between(types, 'export const ENGINE_CALLS', 'Object.freeze([', '] as const') ?? '';
  const arityBody = between(types, 'export const ENGINE_ARITY', 'Object.freeze({', '});') ?? '';
  const arity = new Map([...arityBody.matchAll(/([A-Za-z]\w*)\s*:\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
  const prefix = /\[c, `([^`$]*)\$\{c\}`\]/.exec(types)?.[1] ?? '';
  for (const name of quotedIn(names)) {
    const base = arity.get(name);
    // main/engine-ipc.ts: `!(call === 'chooseFolder' && args.length === 1)` is one argument more than the count.
    const more = new RegExp(`call === '${name}' && args\\.length === (\\d+)`).exec(ipc);
    engineCalls.push({ name, arity: base ?? -1, optionalArgs: more === null || base === undefined ? 0 : Number(more[1]) - base, channel: `${prefix}${name}` });
  }
  const readerCalls = [];
  const readerNames = between(real, 'export const REAL_CALLS', 'Object.freeze([', '] as const') ?? '';
  const channelsBody = between(real, 'export const REAL_CHANNELS', 'Object.freeze({', '} as const') ?? '';
  const channels = new Map([...channelsBody.matchAll(/([A-Za-z]\w*)\s*:\s*'([^']*)'/g)].map(m => [m[1], m[2]]));
  const guarded = new Map([...realIpc.matchAll(/guarded\(REAL_CHANNELS\.(\w+),\s*(\d+),/g)].map(m => [m[1], Number(m[2])]));
  for (const name of quotedIn(readerNames)) readerCalls.push({ name, arity: guarded.get(name) ?? -1, optionalArgs: 0, channel: channels.get(name) ?? '' });
  return { engineCalls, readerCalls };
}

/**
 * The refusal tables, from the text of the files: `types` (shared/engine/types.ts), `realScan` (main/real-scan.ts), `realIpc` (main/real-ipc.ts) and `consent`
 * (main/engine-consent.ts).
 */
export function refusalsOf({ types = '', realScan = '', realIpc = '', consent = '' }) {
  const callRefusals = quotedIn(between(types, 'export const ENGINE_CALL_REFUSALS', 'Object.freeze([', '] as const') ?? '');
  const mainRefusals = [];
  for (const m of types.matchAll(/export const \w+_MAIN_WORDS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/g)) {
    for (const k of m[1].matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)) mainRefusals.push(k[1]);
  }
  const namedOutcomes = [...consent.matchAll(/refusal:\s*\{\s*code:\s*([A-Z][A-Z0-9_]*)/g)].map(m => m[1]);
  const classBody = /class RealRefusal[\s\S]*?readonly code:\s*([^;]*);/.exec(realScan)?.[1] ?? '';
  const readerRefusals = quotedIn(classBody);
  // The gate of the reader's handler: `new Error(NOT_ALLOWED)` with `const NOT_ALLOWED = 'NOT_ALLOWED'`, `new Error('BAD_ARGUMENT')`, `new Error('FAILED')`.
  const constants = new Map([...realIpc.matchAll(/const ([A-Z_]+) = '([A-Z_]+)';/g)].map(m => [m[1], m[2]]));
  const gate = [...realIpc.matchAll(/new Error\((?:'([A-Z_]+)'|([A-Z_]+))\)/g)].map(m => m[1] ?? constants.get(m[2]));
  return { callRefusals: sorted(callRefusals), namedOutcomes: sorted(namedOutcomes), mainRefusals: sorted(mainRefusals), readerGateRefusals: sorted(gate.filter(Boolean)), readerRefusals: sorted(readerRefusals) };
}

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Reads the base source under `root` and returns everything the golden file holds, apart from the commit and the format. */
export function scanBase(root) {
  const files = listBaseSources(root);
  const texts = new Map(files.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const get = f => texts.get(`${DESKTOP}/${f}`) ?? '';
  const calls = callsOf({ types: get('shared/engine/types.ts'), ipc: get('main/engine-ipc.ts'), real: get('shared/real/types.ts'), realIpc: get('main/real-ipc.ts') });
  const refusals = refusalsOf({ types: get('shared/engine/types.ts'), realScan: get('main/real-scan.ts'), realIpc: get('main/real-ipc.ts'), consent: get('main/engine-consent.ts') });
  const codeSources = {};
  for (const [file, text] of texts) {
    for (const code of codeLiteralsOf(text).codes) (codeSources[code] ??= []).push(file);
  }
  const codeLiterals = Object.keys(codeSources).sort();
  return {
    sourceFiles: files.map(f => ({ path: f, sha256: sha256(texts.get(f)) })),
    ...calls,
    ...refusals,
    codeLiterals,
    codeSources: Object.fromEntries(codeLiterals.map(c => [c, codeSources[c].sort()])),
  };
}

const callKey = c => `${c.arity}/${c.optionalArgs}/${c.channel}`;

/** What the golden file lacks or gets wrong compared with what the source holds now. Empty when the golden file covers the source. */
export function checkGolden(golden, found) {
  const problems = [];
  const have = new Set(golden.codeLiterals ?? []);
  for (const code of found.codeLiterals) if (!have.has(code)) problems.push(`code literal ${code} is in the source and not in the golden file`);
  for (const side of ['engineCalls', 'readerCalls']) {
    const known = new Map((golden[side] ?? []).map(c => [c.name, c]));
    for (const c of found[side]) {
      const g = known.get(c.name);
      if (g === undefined) problems.push(`${side}: call ${c.name} is in the source and not in the golden file`);
      else if (callKey(g) !== callKey(c)) problems.push(`${side}: call ${c.name} is ${callKey(g)} in the golden file and ${callKey(c)} in the source`);
    }
  }
  for (const table of ['callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals']) {
    const known = new Set(golden[table] ?? []);
    for (const code of found[table]) if (!known.has(code)) problems.push(`${table}: ${code} is in the source and not in the golden file`);
  }
  return problems;
}

/** Where the golden file and the contract differ, in both directions. `contract` has the same table names as the golden file. Empty when they agree. */
export function goldenAgainstContract(golden, contract) {
  const problems = [];
  for (const side of ['engineCalls', 'readerCalls']) {
    const g = new Map((golden[side] ?? []).map(c => [c.name, c])), k = new Map((contract[side] ?? []).map(c => [c.name, c]));
    for (const [name, c] of g) {
      const other = k.get(name);
      if (other === undefined) problems.push(`${side}: ${name} is in the golden file and not in the contract`);
      else if (callKey(other) !== callKey(c)) problems.push(`${side}: ${name} is ${callKey(c)} in the golden file and ${callKey(other)} in the contract`);
    }
    for (const name of k.keys()) if (!g.has(name)) problems.push(`${side}: ${name} is in the contract and not in the golden file`);
  }
  for (const table of ['callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals']) {
    const g = new Set(golden[table] ?? []), k = new Set(contract[table] ?? []);
    for (const code of g) if (!k.has(code)) problems.push(`${table}: ${code} is in the golden file and not in the contract`);
    for (const code of k) if (!g.has(code)) problems.push(`${table}: ${code} is in the contract and not in the golden file`);
  }
  return problems;
}
