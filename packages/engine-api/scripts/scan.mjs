// The reader of the base source for the engine API golden file. It reads text only. It never imports, runs or loads the files it reads, and it imports nothing from
// apps/desktop. make-golden.mjs calls it to make the golden file, and test/golden.test.mjs calls it to check the golden file against the source.
//
// What it reads, all in apps/desktop:
//  - the library source: main/engine-*.ts, main/real-*.ts, shared/engine/*.ts and shared/real/*.ts.
//  - the call lists and tables in shared/engine/types.ts and shared/real/types.ts.
//  - the argument counts in main/engine-ipc.ts and main/real-ipc.ts, the reader's refusal class in main/real-scan.ts, and the named outcomes in main/engine-consent.ts.
//
// It covers those globs under those rules and nothing else. A code written anywhere else in the app is not seen.
// It never returns an empty result by accident. A missing folder, a missing file, a block it cannot find, a call with no argument count or channel, or a table with no
// entry makes it throw an error that says what it could not find.
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

/** The files the scan reads, as paths from the repository root with forward slashes, in sorted order. Throws when a folder is missing or holds no file of its pattern. */
export function listBaseSources(root) {
  const found = [];
  for (const part of SOURCE_PARTS) {
    let names;
    try { names = fs.readdirSync(path.join(root, part.dir)); } catch (error) { throw new Error(`the scan cannot find the folder ${part.dir} (${error.code ?? error.message})`); }
    const matching = names.filter(name => part.name.test(name));
    if (matching.length === 0) throw new Error(`the scan finds no file in ${part.dir} that matches ${part.name}`);
    for (const name of matching) found.push(`${part.dir}/${name}`);
  }
  return found.sort();
}

/** The text with every character that means something in a regular expression written as plain text. */
export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** The text between the first `open` after `from` and the next `close`. Throws, naming `what`, when any of the three is not there. */
function between(text, from, open, close, what) {
  const start = text.indexOf(from);
  if (start < 0) throw new Error(`the scan cannot find ${what} (${from})`);
  const a = text.indexOf(open, start);
  const b = a < 0 ? -1 : text.indexOf(close, a + open.length);
  if (b < 0) throw new Error(`the scan cannot find the end of ${what} (${from})`);
  return text.slice(a + open.length, b);
}

const quotedIn = body => [...body.matchAll(/'([^']*)'/g)].map(m => m[1]);

/**
 * The calls of both sides, from the text of the files. `types` is shared/engine/types.ts, `ipc` is main/engine-ipc.ts, `real` is shared/real/types.ts and `realIpc` is
 * main/real-ipc.ts. A side is read when its types text is given, and then its ipc text must be given too. A side whose types text is left out gives an empty list, which
 * lets a test read one side alone. It throws for a block it cannot find, a list with no call, a call with no argument count, and a call with no channel.
 */
export function callsOf({ types, ipc, real, realIpc }) {
  const engineCalls = [], readerCalls = [];
  if (types !== undefined) {
    if (ipc === undefined) throw new Error('the scan needs the text of main/engine-ipc.ts to read the engine calls');
    const names = quotedIn(between(types, 'export const ENGINE_CALLS', 'Object.freeze([', '] as const', 'the list ENGINE_CALLS'));
    if (names.length === 0) throw new Error('the scan finds no calls in ENGINE_CALLS');
    const arityBody = between(types, 'export const ENGINE_ARITY', 'Object.freeze({', '});', 'the table ENGINE_ARITY');
    const arity = new Map([...arityBody.matchAll(/([A-Za-z]\w*)\s*:\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
    const prefix = /\[c, `([^`$]*)\$\{c\}`\]/.exec(types)?.[1] ?? '';
    if (prefix === '') throw new Error('the scan cannot find the channel prefix of the engine calls');
    for (const name of names) {
      const base = arity.get(name);
      if (base === undefined) throw new Error(`the scan finds no argument count (arity) for the engine call ${name}`);
      // main/engine-ipc.ts: `!(call === 'chooseFolder' && args.length === 1)` is one argument more than the count.
      const more = new RegExp(`call === '${escapeRegExp(name)}' && args\\.length === (\\d+)`).exec(ipc);
      engineCalls.push({ name, arity: base, optionalArgs: more === null ? 0 : Number(more[1]) - base, channel: `${prefix}${name}` });
    }
  }
  if (real !== undefined) {
    if (realIpc === undefined) throw new Error('the scan needs the text of main/real-ipc.ts to read the reader calls');
    const names = quotedIn(between(real, 'export const REAL_CALLS', 'Object.freeze([', '] as const', 'the list REAL_CALLS'));
    if (names.length === 0) throw new Error('the scan finds no calls in REAL_CALLS');
    const channelsBody = between(real, 'export const REAL_CHANNELS', 'Object.freeze({', '} as const', 'the table REAL_CHANNELS');
    const channels = new Map([...channelsBody.matchAll(/([A-Za-z]\w*)\s*:\s*'([^']*)'/g)].map(m => [m[1], m[2]]));
    const guarded = new Map([...realIpc.matchAll(/guarded\(REAL_CHANNELS\.(\w+),\s*(\d+),/g)].map(m => [m[1], Number(m[2])]));
    for (const name of names) {
      const count = guarded.get(name), channel = channels.get(name);
      if (count === undefined) throw new Error(`the scan finds no argument count (arity) for the reader call ${name}`);
      if (channel === undefined || channel === '') throw new Error(`the scan finds no channel for the reader call ${name}`);
      readerCalls.push({ name, arity: count, optionalArgs: 0, channel });
    }
  }
  return { engineCalls, readerCalls };
}

/**
 * The refusal tables, from the text of the files: `types` (shared/engine/types.ts), `realScan` (main/real-scan.ts), `realIpc` (main/real-ipc.ts) and `consent`
 * (main/engine-consent.ts). All four are needed. It throws for a table it cannot find or one with no entry.
 */
export function refusalsOf({ types, realScan, realIpc, consent }) {
  const need = (value, what) => { if (typeof value !== 'string') throw new Error(`the scan needs the text of ${what}`); return value; };
  const typesText = need(types, 'shared/engine/types.ts'), scanText = need(realScan, 'main/real-scan.ts'), ipcText = need(realIpc, 'main/real-ipc.ts'), consentText = need(consent, 'main/engine-consent.ts');
  const callRefusals = quotedIn(between(typesText, 'export const ENGINE_CALL_REFUSALS', 'Object.freeze([', '] as const', 'the list ENGINE_CALL_REFUSALS'));
  const mainRefusals = [];
  for (const m of typesText.matchAll(/export const \w+_MAIN_WORDS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/g)) {
    for (const k of m[1].matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)) mainRefusals.push(k[1]);
  }
  const namedOutcomes = [...consentText.matchAll(/refusal:\s*\{\s*code:\s*([A-Z][A-Z0-9_]*)/g)].map(m => m[1]);
  const classBody = /class RealRefusal[\s\S]*?readonly code:\s*([^;]*);/.exec(scanText)?.[1];
  if (classBody === undefined) throw new Error('the scan cannot find the class RealRefusal in main/real-scan.ts');
  const readerRefusals = quotedIn(classBody);
  // The gate of the reader's handler: `new Error(NOT_ALLOWED)` with `const NOT_ALLOWED = 'NOT_ALLOWED'`, `new Error('BAD_ARGUMENT')`, `new Error('FAILED')`.
  const constants = new Map([...ipcText.matchAll(/const ([A-Z_]+) = '([A-Z_]+)';/g)].map(m => [m[1], m[2]]));
  const gate = [...ipcText.matchAll(/new Error\((?:'([A-Z_]+)'|([A-Z_]+))\)/g)].map(m => m[1] ?? constants.get(m[2]));
  if (gate.some(code => code === undefined)) throw new Error('the scan cannot resolve a code of the gate in main/real-ipc.ts');
  const tables = { callRefusals, namedOutcomes, mainRefusals, readerGateRefusals: gate, readerRefusals };
  const labels = { callRefusals: 'call refusal', namedOutcomes: 'named outcome', mainRefusals: 'table whose name ends in _MAIN_WORDS', readerGateRefusals: 'code of the gate of the reader', readerRefusals: 'code of RealRefusal' };
  for (const [key, list] of Object.entries(tables)) if (list.length === 0) throw new Error(`the scan finds no ${labels[key]}`);
  return Object.fromEntries(Object.entries(tables).map(([key, list]) => [key, sorted(list)]));
}

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Reads the base source under `root` and returns everything the golden file holds, apart from the commit and the format. Throws when it cannot read what it needs. */
export function scanBase(root) {
  const files = listBaseSources(root);
  const texts = new Map(files.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const get = f => {
    const text = texts.get(`${DESKTOP}/${f}`);
    if (text === undefined) throw new Error(`the scan cannot find the file ${DESKTOP}/${f}`);
    return text;
  };
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

/** The lists of a scan result that are empty or missing. The golden file is never made from a scan that has one. */
export function emptyTables(found) {
  return ['sourceFiles', 'engineCalls', 'readerCalls', 'callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals', 'codeLiterals']
    .filter(key => !Array.isArray(found[key]) || found[key].length === 0);
}

/**
 * Where the files on disk differ from the hashes in the golden file, as one line per file with its name. The hashes bind the golden file to the source it was made from:
 * a file that changed, a file that is not listed, and a listed file that is gone each fail until the golden file is made again with scripts/make-golden.mjs.
 */
export function hashProblems(golden, root) {
  const problems = [];
  const listed = new Map((golden.sourceFiles ?? []).map(f => [f.path, f.sha256]));
  for (const [file, hash] of listed) {
    let live;
    try { live = sha256(fs.readFileSync(path.join(root, file), 'utf8')); } catch { problems.push(`${file}: is in the golden file and is not on disk; make the golden file again with scripts/make-golden.mjs`); continue; }
    if (live !== hash) problems.push(`${file}: changed since the golden file was made; make the golden file again with scripts/make-golden.mjs`);
  }
  for (const file of listBaseSources(root)) if (!listed.has(file)) problems.push(`${file}: is in the source and not in the golden file; make the golden file again with scripts/make-golden.mjs`);
  return problems;
}

const callKey = c => `${c.arity}/${c.optionalArgs}/${c.channel}`;

/**
 * What the golden file lacks or gets wrong compared with what the source holds now. Empty when the golden file covers the source and holds no call or table entry the source
 * does not have. It goes both ways for calls and tables. For code literals it goes one way: a literal added to the source must be in the golden file, and a literal removed
 * from the source may stay in it, because a removal needs a decision and the golden file is the record of the base.
 */
export function checkGolden(golden, found) {
  const problems = [];
  const have = new Set(golden.codeLiterals ?? []);
  for (const code of found.codeLiterals) if (!have.has(code)) problems.push(`code literal ${code} is in the source and not in the golden file`);
  for (const side of ['engineCalls', 'readerCalls']) {
    const known = new Map((golden[side] ?? []).map(c => [c.name, c]));
    const live = new Map(found[side].map(c => [c.name, c]));
    for (const c of found[side]) {
      const g = known.get(c.name);
      if (g === undefined) problems.push(`${side}: call ${c.name} is in the source and not in the golden file`);
      else if (callKey(g) !== callKey(c)) problems.push(`${side}: call ${c.name} is ${callKey(g)} in the golden file and ${callKey(c)} in the source`);
    }
    for (const name of known.keys()) if (!live.has(name)) problems.push(`${side}: call ${name} is in the golden file and not in the source`);
  }
  for (const table of ['callRefusals', 'namedOutcomes', 'mainRefusals', 'readerGateRefusals', 'readerRefusals']) {
    const known = new Set(golden[table] ?? []), live = new Set(found[table]);
    for (const code of found[table]) if (!known.has(code)) problems.push(`${table}: ${code} is in the source and not in the golden file`);
    for (const code of known) if (!live.has(code)) problems.push(`${table}: ${code} is in the golden file and not in the source`);
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
