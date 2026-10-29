/**
 * The text layer of the locked-in writers. It edits a person's JSON and TOML files by inserting text, so every byte it
 * does not manage stays where it was (locked-in parts spec, section 4 rule 2; check 4). It renders the files Bowerloom
 * owns. It never writes a file itself.
 *
 * - JSON: a strict parser that keeps the position of every value. It refuses comments, trailing commas, a byte order
 *   mark, and a repeated key. An edit adds members to an object or items to an array, before its closing bracket.
 * - TOML: a scanner that finds every table header and key path, so a managed table that would meet a person's table,
 *   key, or inline table is a conflict, never a merge. Managed keys go into one block at the top of the file and managed
 *   tables into one block at the end.
 */
import { JsExpression, PermissionPairs } from '../../fidelity/src/index.js';

// ---- values -------------------------------------------------------------------------------------------------------------

/** An object whose keys keep their order, whatever they look like. */
export class Ordered {
  constructor(readonly entries: readonly (readonly [string, Out])[]) {}
}
export type Out = null | boolean | number | string | readonly Out[] | Ordered | { readonly [key: string]: Out };

const entriesOf = (v: Ordered | { readonly [key: string]: Out }): readonly (readonly [string, Out])[] => v instanceof Ordered ? v.entries : Object.entries(v);
const isObject = (v: Out): v is Ordered | { readonly [key: string]: Out } => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The plain value, for a comparison. */
export function plain(v: Out): unknown {
  if (Array.isArray(v)) return v.map(plain);
  if (isObject(v)) return Object.fromEntries(entriesOf(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
/** Equal as JSON values; object key order does not count. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (a !== null && typeof a === 'object') {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every(k => Object.hasOwn(b as object, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

// ---- JSON: render ---------------------------------------------------------------------------------------------------------

function jsonNumber(n: number): string {
  if (!Number.isFinite(n)) throw new TypeError('A JSON number must be finite.');
  return JSON.stringify(n);
}
/** Renders a value with `unit` per level, starting at `depth`. Keys keep the order of an `Ordered`. */
export function renderJson(v: Out, unit = '  ', depth = 0): string {
  const pad = (d: number): string => unit.repeat(d);
  if (v === null || typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return jsonNumber(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[\n${v.map(x => pad(depth + 1) + renderJson(x, unit, depth + 1)).join(',\n')}\n${pad(depth)}]`;
  const e = entriesOf(v as Ordered);
  return e.length === 0 ? '{}' : `{\n${e.map(([k, x]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${renderJson(x, unit, depth + 1)}`).join(',\n')}\n${pad(depth)}}`;
}

// ---- JSON: locate ---------------------------------------------------------------------------------------------------------

export type JNode =
  | { readonly kind: 'object'; readonly start: number; readonly end: number; readonly members: readonly { readonly key: string; readonly value: JNode }[] }
  | { readonly kind: 'array'; readonly start: number; readonly end: number; readonly items: readonly JNode[] }
  | { readonly kind: 'scalar'; readonly start: number; readonly end: number };

/** Parses strict JSON and keeps the span of every value. Null for anything that is not strict JSON. */
export function locateJson(text: string): JNode | null {
  let i = 0;
  const ws = (): void => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const fail = (): never => { throw new SyntaxError('not strict JSON'); };
  const str = (): string => {
    const start = i;
    if (text[i] !== '"') fail();
    i++;
    while (i < text.length && text[i] !== '"') {
      const c = text.charCodeAt(i);
      if (c < 0x20) fail();
      if (text[i] === '\\') { i++; if (text[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail(); i += 5; continue; } if (!'"\\/bfnrt'.includes(text[i] ?? '')) fail(); }
      i++;
    }
    if (text[i] !== '"') fail();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): JNode => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++; ws();
      const members: { key: string; value: JNode }[] = [];
      const seen = new Set<string>();
      if (text[i] === '}') { i++; return { kind: 'object', start, end: i, members }; }
      for (;;) {
        ws();
        const key = str();
        if (seen.has(key)) fail();
        seen.add(key);
        ws(); if (text[i] !== ':') fail(); i++;
        members.push({ key, value: value() });
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { kind: 'object', start, end: i, members }; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      const items: JNode[] = [];
      if (text[i] === ']') { i++; return { kind: 'array', start, end: i, items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { kind: 'array', start, end: i, items }; }
        fail();
      }
    }
    if (c === '"') { str(); return { kind: 'scalar', start, end: i }; }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 400));
    if (!m) fail();
    i += m![0].length;
    return { kind: 'scalar', start, end: i };
  };
  try {
    const root = value();
    ws();
    return i === text.length ? root : null;
  } catch { return null; }
}

// ---- JSON: edit -----------------------------------------------------------------------------------------------------------

/**
 * Add members to the object at `path`, or items to the array at `path`. Missing objects on the way are created. `same`
 * says when a member the file holds means the planned value, where two forms mean the same to the engine; the default is
 * equal JSON values.
 */
export type JsonOp =
  | { readonly kind: 'members'; readonly path: readonly string[]; readonly members: readonly (readonly [string, Out])[]; readonly same?: (held: unknown, planned: unknown) => boolean }
  | { readonly kind: 'items'; readonly path: readonly string[]; readonly items: readonly Out[] };

/**
 * `kept` names each entry the file already holds with the same name and the same value as the planned entry: the edit
 * leaves it as it is, and Bowerloom takes it over (definition spec, check 1, on an adopted folder). A JSON member is
 * `a.b.name`, a JSON array item is `a.b[index]` at its index in the file, and a TOML table is its dotted header path.
 */
export type EditResult = { readonly ok: true; readonly text: string; readonly kept: readonly string[] } | { readonly ok: false; readonly reason: 'invalid' } | { readonly ok: false; readonly reason: 'conflict'; readonly at: readonly string[] };

/** The indent unit of a JSON text: the leading white space of its first indented line, or two spaces. */
function unitOf(text: string): string {
  const m = /\n([ \t]+)"/.exec(text);
  return m ? m[1]! : '  ';
}

/**
 * Applies the operations to a JSON text, or to `{}` when there is no file. The text must be one strict JSON object.
 * A member that is there already with the same value is left as it is; with another value it is a conflict, and so is
 * a step of the path that is not an object (or, for items, an array).
 */
export function editJson(base: string | null, ops: readonly JsonOp[]): EditResult {
  let text = base ?? '{}\n';
  const root0 = locateJson(text);
  if (root0 === null || root0.kind !== 'object') return { ok: false, reason: 'invalid' };
  const unit = unitOf(text);
  const pad = (d: number): string => unit.repeat(d);
  const conflicts: string[] = [], kept: string[] = [];
  const insertMembers =(obj: Extract<JNode, { kind: 'object' }>, depth: number, add: readonly (readonly [string, Out])[]): void => {
    const body = add.map(([k, v]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${renderJson(v, unit, depth + 1)}`);
    if (obj.members.length) {
      const at = obj.members.at(-1)!.value.end;
      text = `${text.slice(0, at)},\n${body.join(',\n')}${text.slice(at)}`;
    } else text = `${text.slice(0, obj.start + 1)}\n${body.join(',\n')}\n${pad(depth)}${text.slice(obj.start + 1)}`;
  };
  for (const op of ops) {
    const root = locateJson(text)! as Extract<JNode, { kind: 'object' }>;
    const steps = op.kind === 'members' ? op.path : op.path.slice(0, -1);
    let node: Extract<JNode, { kind: 'object' }> = root, depth = 0, missing: readonly string[] | null = null, blocked = false;
    for (const [i, key] of steps.entries()) {
      const m = node.members.find(x => x.key === key);
      if (!m) { missing = steps.slice(i); break; }
      if (m.value.kind !== 'object') { conflicts.push(steps.slice(0, i + 1).join('.')); blocked = true; break; }
      node = m.value; depth++;
    }
    if (blocked) continue;
    if (missing !== null) {
      // Build the missing objects around the new content, and insert them as one member.
      const leaf: Out = op.kind === 'members' ? new Ordered(op.members) : new Ordered([[op.path.at(-1)!, [...op.items]]]);
      let value: Out = leaf;
      for (const key of [...missing].reverse().slice(0, -1)) value = new Ordered([[key, value]]);
      insertMembers(node, depth, [[missing[0]!, value]]);
      continue;
    }
    if (op.kind === 'members') {
      const add: (readonly [string, Out])[] = [];
      for (const [k, v] of op.members) {
        const had = node.members.find(x => x.key === k);
        if (!had) { add.push([k, v]); continue; }
        if (!(op.same ?? sameValue)(JSON.parse(text.slice(had.value.start, had.value.end)), plain(v))) conflicts.push([...op.path, k].join('.'));
        else kept.push([...op.path, k].join('.'));
      }
      if (add.length) insertMembers(node, depth, add);
    } else {
      const key = op.path.at(-1)!;
      const had = node.members.find(x => x.key === key);
      if (!had) { insertMembers(node, depth, [[key, [...op.items]]]); continue; }
      if (had.value.kind !== 'array') { conflicts.push(op.path.join('.')); continue; }
      const arr = had.value;
      const present = arr.items.map(n => JSON.parse(text.slice(n.start, n.end)) as unknown);
      const add: Out[] = [];
      for (const v of op.items) {
        const at = present.findIndex(p => sameValue(p, plain(v)));
        if (at < 0) add.push(v); else kept.push(`${op.path.join('.')}[${at}]`);
      }
      if (add.length === 0) continue;
      const body = add.map(v => `${pad(depth + 2)}${renderJson(v, unit, depth + 2)}`);
      if (arr.items.length) {
        const at = arr.items.at(-1)!.end;
        text = `${text.slice(0, at)},\n${body.join(',\n')}${text.slice(at)}`;
      } else text = `${text.slice(0, arr.start + 1)}\n${body.join(',\n')}\n${pad(depth + 1)}${text.slice(arr.start + 1)}`;
    }
  }
  if (conflicts.length) return { ok: false, reason: 'conflict', at: conflicts };
  if (locateJson(text) === null) return { ok: false, reason: 'invalid' };
  return { ok: true, text, kept: [...new Set(kept)] };
}

// ---- TOML: render ---------------------------------------------------------------------------------------------------------

/** A TOML basic string. Every control character is escaped. */
export function tomlString(s: string): string {
  return `"${s.replace(/[\\"\u0000-\u001f\u007f]/g, c => {
    switch (c) {
      case '\\': return '\\\\';
      case '"': return '\\"';
      case '\b': return '\\b';
      case '\t': return '\\t';
      case '\n': return '\\n';
      case '\f': return '\\f';
      case '\r': return '\\r';
      default: return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  })}"`;
}
export const tomlKey = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k));
export function tomlValue(v: Out): string {
  if (v === null) throw new TypeError('TOML has no null.');
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('A TOML number must be finite.');
    return Number.isInteger(v) ? String(v) : String(v).includes('e') ? String(v) : String(v);
  }
  if (typeof v === 'string') return tomlString(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  const e = entriesOf(v as Ordered);
  return e.length === 0 ? '{}' : `{ ${e.map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`).join(', ')} }`;
}
export const tomlLines = (entries: readonly (readonly [string, Out])[]): string => entries.map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}\n`).join('');

// ---- TOML: scan -----------------------------------------------------------------------------------------------------------

// The scanner is the strict TOML 1.0 parser of toml-scan.ts (ruling D1).
import { scanToml, type TomlDefined } from './toml-scan.js';
export { scanToml, validScalar } from './toml-scan.js';
export type { TomlDefined } from './toml-scan.js';

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const startsWith = (a: readonly string[], prefix: readonly string[]): boolean => prefix.length <= a.length && prefix.every((x, i) => x === a[i]);

/** The paths of a scan that a managed table at `path` would meet. Empty when the table can be added safely. */
export function tomlTableConflicts(d: TomlDefined, path: readonly string[]): string[] {
  const out: string[] = [];
  const show = (p: readonly string[]): string => (same(p, path) ? path.join('.') : `${path.join('.')} (the file holds ${p.join('.')})`);
  for (const p of [...d.headers, ...d.arrays, ...d.values, ...d.dotted]) {
    if (same(p, path) || startsWith(p, path)) out.push(show(p));
  }
  for (const p of [...d.values, ...d.arrays, ...d.dotted]) if (p.length < path.length && startsWith(path, p)) out.push(show(p));
  return [...new Set(out)];
}
/** The paths of a scan that a managed key at the top of the file would meet. */
export function tomlRootConflicts(d: TomlDefined, key: string): string[] {
  return [...new Set([...d.headers, ...d.arrays, ...d.values, ...d.dotted].filter(p => p[0] === key).map(p => (p.length === 1 ? key : `${key} (the file holds ${p.join('.')})`)))];
}

export const TOML_KEYS_OPEN = '# Bowerloom writes the keys below. Removal restores this file as it was.\n';
export const TOML_KEYS_CLOSE = '# End of the keys Bowerloom writes.\n';
export const TOML_TABLES_OPEN = '# Bowerloom writes the tables below. Removal restores this file as it was.\n';
export const TOML_TABLES_CLOSE = '# End of the tables Bowerloom writes.\n';

/** A managed table: its header path and its keys. */
export interface TomlTable { readonly path: readonly string[]; readonly entries: readonly (readonly [string, Out])[] }

// ---- TOML: read one table, for a takeover ---------------------------------------------------------------------------------

/**
 * A reader for the one line of a simple TOML key or value. It reads the forms Bowerloom writes, and a little more: basic
 * and literal strings, decimal integers, floats that are not whole numbers, booleans, and one-line arrays and inline
 * tables of those. Anything else (a multi-line value, a date, a whole-number float, a hexadecimal number, a dotted key)
 * makes it fail, so the table is not taken over and the conflict stands.
 */
class LineReader {
  i = 0;
  constructor(readonly s: string) {}
  fail(): never { throw new SyntaxError('not a simple TOML line'); }
  ws(): void { while (this.s[this.i] === ' ' || this.s[this.i] === '\t') this.i++; }
  basic(): string {
    this.i++;
    let out = '';
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) this.fail();
      if (c === '"') { this.i++; return out; }
      if (c === '\\') {
        const e = this.s[this.i + 1] ?? '';
        const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
        if (simple[e] !== undefined) { out += simple[e]; this.i += 2; continue; }
        const width = e === 'u' ? 4 : e === 'U' ? 8 : 0, hex = this.s.slice(this.i + 2, this.i + 2 + width);
        if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) this.fail();
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) this.fail();
        out += String.fromCodePoint(cp); this.i += 2 + width; continue;
      }
      out += c; this.i++;
    }
  }
  literal(): string {
    const end = this.s.indexOf("'", this.i + 1);
    if (end < 0) this.fail();
    const out = this.s.slice(this.i + 1, end);
    this.i = end + 1;
    return out;
  }
  key(): string {
    const c = this.s[this.i];
    if (c === '"') { if (this.s.startsWith('"""', this.i)) this.fail(); return this.basic(); }
    if (c === "'") { if (this.s.startsWith("'''", this.i)) this.fail(); return this.literal(); }
    const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i));
    if (!m) this.fail();
    this.i += m![0].length;
    return m![0];
  }
  /** A dotted key path, as a header holds one. */
  path(): string[] {
    const out: string[] = [];
    for (;;) { this.ws(); out.push(this.key()); this.ws(); if (this.s[this.i] !== '.') return out; this.i++; }
  }
  value(): unknown {
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.key();
    if (c === '[') {
      this.i++;
      const out: unknown[] = [];
      for (;;) {
        this.ws();
        if (this.s[this.i] === ']') { this.i++; return out; }
        out.push(this.value()); this.ws();
        if (this.s[this.i] === ',') { this.i++; continue; }
        if (this.s[this.i] === ']') { this.i++; return out; }
        this.fail();
      }
    }
    if (c === '{') {
      this.i++; this.ws();
      const out: Record<string, unknown> = {};
      if (this.s[this.i] === '}') { this.i++; return out; }
      for (;;) {
        this.ws();
        const k = this.key(); this.ws();
        if (this.s[this.i] !== '=' || Object.hasOwn(out, k)) this.fail();
        this.i++; this.ws();
        out[k] = this.value(); this.ws();
        if (this.s[this.i] === ',') { this.i++; continue; }
        if (this.s[this.i] === '}') { this.i++; return out; }
        this.fail();
      }
    }
    const m = /^[^\s,\]}#]+/.exec(this.s.slice(this.i));
    if (!m) this.fail();
    const word = m![0];
    this.i += word.length;
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (/^[+-]?(?:0|[1-9](?:_?[0-9])*)$/.test(word)) { const n = Number(word.replace(/_/g, '')); if (!Number.isSafeInteger(n)) this.fail(); return n; }
    if (/^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/.test(word)) {
      // A whole-number float reads as a float in TOML and would be written as an integer, so it is not the same value.
      const n = Number(word.replace(/_/g, ''));
      if (!Number.isFinite(n) || Number.isInteger(n)) this.fail();
      return n;
    }
    return this.fail();
  }
  /** The rest of the line: white space and an optional comment. */
  end(): void { this.ws(); if (this.i < this.s.length && this.s[this.i] !== '#') this.fail(); }
}

/**
 * The keys and values of the table that one header of `text` defines at `path`, read from that header's own lines, or
 * null when the header is not found exactly once or any of its lines is not one simple `key = value`.
 */
export function tomlHeaderTable(text: string, path: readonly string[]): Record<string, unknown> | null {
  const lines = text.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const headerAt = (line: string): string[] | null => {
    const r = new LineReader(line);
    r.ws();
    if (line[r.i] !== '[' || line[r.i + 1] === '[') return null;
    r.i++;
    try { const p = r.path(); if (line[r.i] !== ']') return null; r.i++; r.end(); return p; } catch { return null; }
  };
  const found = lines.flatMap((l, n) => { const p = headerAt(l); return p && same(p, path) ? [n] : []; });
  if (found.length !== 1) return null;
  const out: Record<string, unknown> = {};
  try {
    for (let n = found[0]! + 1; n < lines.length; n++) {
      const r = new LineReader(lines[n]!);
      r.ws();
      if (lines[n]![r.i] === '[') break;
      if (r.i === lines[n]!.length || lines[n]![r.i] === '#') continue;
      const k = r.key(); r.ws();
      if (lines[n]![r.i] !== '=' || Object.hasOwn(out, k)) return null;
      r.i++; r.ws();
      out[k] = r.value();
      r.end();
    }
  } catch { return null; }
  return out;
}

/**
 * True when the person's table at `path` can be taken over: one header defines it, nothing else in the file defines a
 * key or table under it or a value on its way, and its own lines hold exactly the planned keys with the same values.
 */
function tomlTakeOver(text: string, d: TomlDefined, t: TomlTable): boolean {
  const path = t.path, under = (p: readonly string[]): boolean => startsWith(p, path);
  if (d.headers.filter(p => same(p, path)).length !== 1) return false;
  if (d.headers.some(p => p.length > path.length && under(p))) return false;
  if ([...d.arrays, ...d.dotted].some(p => under(p) || startsWith(path, p))) return false;
  if (d.values.some(p => (under(p) && p.length !== path.length + 1) || (p.length <= path.length && startsWith(path, p)))) return false;
  const held = tomlHeaderTable(text, path);
  return held !== null && sameValue(held, plain(new Ordered(t.entries)));
}

/**
 * Adds managed keys at the top and managed tables at the end of a TOML text, or of an empty file. The person's bytes
 * stay as they are, in order. `forbid` names top-level keys whose presence makes the managed content meaningless. A
 * managed table that the person's file already holds, with the same keys and values, is taken over: it stays where it
 * is, nothing is added for it, and `kept` names it.
 */
export function editToml(base: string | null, root: readonly (readonly [string, Out])[], tablesWanted: readonly TomlTable[], forbid: readonly string[] = []): EditResult {
  // Ruling B20: a person's file with no bytes is refused, as an empty JSON file is.
  if (base === '') return { ok: false, reason: 'invalid' };
  const text = base ?? '';
  const d = scanToml(text);
  if (d === null) return { ok: false, reason: 'invalid' };
  const kept: string[] = [], tables: TomlTable[] = [], tableConflicts: string[] = [];
  for (const t of tablesWanted) {
    const c = tomlTableConflicts(d, t.path);
    if (c.length === 0) tables.push(t);
    else if (tomlTakeOver(text, d, t)) kept.push(t.path.join('.'));
    else tableConflicts.push(...c);
  }
  const conflicts = [...root.flatMap(([k]) => tomlRootConflicts(d, k)), ...forbid.flatMap(k => tomlRootConflicts(d, k)), ...tableConflicts];
  if (conflicts.length) return { ok: false, reason: 'conflict', at: [...new Set(conflicts)] };
  // A byte order mark is not TOML 1.0, so the scan above has refused one already.
  const body = text;
  const head = root.length ? `${TOML_KEYS_OPEN}${tomlLines(root)}${TOML_KEYS_CLOSE}${body.length ? '\n' : ''}` : '';
  const tail = tables.length
    ? `${body.length && !body.endsWith('\n') ? '\n' : ''}${body.length || head.length ? '\n' : ''}${TOML_TABLES_OPEN}${tables.map(t => `[${t.path.map(tomlKey).join('.')}]\n${tomlLines(t.entries)}`).join('\n')}${TOML_TABLES_CLOSE}`
    : '';
  const out = `${head}${body}${tail}`;
  if (scanToml(out) === null) return { ok: false, reason: 'invalid' };
  return { ok: true, text: out, kept };
}

// ---- YAML and frontmatter -------------------------------------------------------------------------------------------------

/** A YAML value. Only a `JsExpression`, which Bowerloom alone makes, is written with the tag `!!js` (ruling B2). */
export type YamlOut = null | boolean | number | string | JsExpression | readonly YamlOut[] | { readonly [key: string]: YamlOut };
const isJs = (v: unknown): v is JsExpression => v instanceof JsExpression;
/** True when a value holds a `JsExpression` at any depth. */
export const holdsJs = (v: unknown): boolean => isJs(v) || (Array.isArray(v) ? v.some(holdsJs) : v !== null && typeof v === 'object' ? Object.values(v).some(holdsJs) : false);

/** A YAML flow value: JSON, which is YAML, and `!!js "<expression>"` for an expression. */
export function yamlFlow(v: YamlOut): string {
  if (isJs(v)) return `!!js ${JSON.stringify(v.js)}`;
  if (Array.isArray(v)) return `[${v.map(yamlFlow).join(', ')}]`;
  if (v !== null && typeof v === 'object') { const e = Object.entries(v); return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${yamlFlow(x)}`).join(', ')} }` : '{}'; }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('A YAML number here must be finite.');
  return JSON.stringify(v);
}
/** A YAML block mapping at `indent` spaces. Nested mappings become blocks; other values are flow values. */
export function yamlBlock(map: { readonly [key: string]: YamlOut }, indent: number): string {
  const pad = ' '.repeat(indent);
  return Object.entries(map).map(([k, v]) => {
    const key = /^[A-Za-z][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k);
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !isJs(v) && Object.keys(v).length) return `${pad}${key}:\n${yamlBlock(v as { readonly [key: string]: YamlOut }, indent + 2)}`;
    return `${pad}${key}: ${yamlFlow(v)}\n`;
  }).join('');
}

const fmKey = (k: string): string => (/^[A-Za-z][A-Za-z0-9_-]*$/.test(k) ? k : JSON.stringify(k));
/**
 * Markdown with YAML frontmatter. Keys are plain, values are JSON. A `PermissionPairs` marker is a nested block mapping,
 * or `{}` when it is empty (ruling B16); any other value, a list of pairs too, is written as data.
 */
export function frontmatter(entries: readonly (readonly [string, unknown])[], body: string): string {
  const lines = entries.map(([k, v]) => {
    if (v instanceof PermissionPairs) {
      return v.pairs.length ? `${fmKey(k)}:\n${v.pairs.map(([a, b]) => `  ${JSON.stringify(a)}: ${JSON.stringify(b)}\n`).join('')}` : `${fmKey(k)}: {}\n`;
    }
    return `${fmKey(k)}: ${JSON.stringify(v)}\n`;
  });
  return `---\n${lines.join('')}---\n${body}`;
}
