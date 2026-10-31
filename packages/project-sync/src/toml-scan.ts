/**
 * A strict TOML 1.0 scanner for the locked-in writers (ruling D1). It parses the whole text and checks every rule that
 * decides whether the file loads: strings and their escapes, control characters, numbers, dates and times, inline
 * tables and arrays, and which keys and tables may be defined where. It fails closed: anything it cannot check fully
 * makes the scan return null, so Bowerloom never merges into a file that does not parse.
 *
 * It returns what the text defines, as paths, so a managed table that would meet a person's table, key, or inline table
 * is found. The keys and sub-tables of one element of an array of tables are scoped to that element by a segment
 * `\u0000<n>`, which no real key holds after the scan, because a control character is refused in a key.
 */

/** What a TOML text defines: table headers, array-of-tables headers, key paths, and the tables that dotted keys make. */
export interface TomlDefined {
  readonly headers: readonly (readonly string[])[];
  readonly arrays: readonly (readonly string[])[];
  readonly values: readonly (readonly string[])[];
  readonly dotted: readonly (readonly string[])[];
}

type Table = { kind: 'table'; how: 'implicit' | 'header' | 'dotted' | 'inline'; scope: number; children: Map<string, Node>; path: string[] };
type ArrayOfTables = { kind: 'aot'; items: Table[]; path: string[] };
type Value = { kind: 'value'; js: unknown };
type Node = Table | ArrayOfTables | Value;

class Invalid extends Error {}

/**
 * A value the reader holds but does not compare: a multi-line string, a whole-number float, a hexadecimal, octal, or
 * binary number, a special float, a date or a time, a number past the safe range, or an array of tables. A table that
 * holds one is never taken over, since its meaning is not compared.
 */
export class Opaque { constructor(readonly word: string) {} }
/** True when a value read by `readToml` holds an `Opaque` anywhere inside it. */
export function holdsOpaque(v: unknown): boolean {
  if (v instanceof Opaque) return true;
  if (Array.isArray(v)) return v.some(holdsOpaque);
  return v !== null && typeof v === 'object' && Object.values(v).some(holdsOpaque);
}
const fail = (): never => { throw new Invalid('not TOML 1.0'); };

/** True for a character TOML refuses in a string or a comment: a control character other than tab. */
const control = (c: number): boolean => (c <= 0x1f && c !== 0x09) || c === 0x7f;
const BARE = /^[A-Za-z0-9_-]+/;
const DEC = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const HEX = /^0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*$/, OCT = /^0o[0-7](?:_?[0-7])*$/, BIN = /^0b[01](?:_?[01])*$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[eE][+-]?[0-9](?:_?[0-9])*)$/;
const SPECIAL = /^[+-]?(?:inf|nan)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const OFFSET = /^(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}
const validTime = (h: number, mi: number, s: number): boolean => h <= 23 && mi <= 59 && s <= 59;

/** True for a bare TOML value: a boolean, a number, or a date or time with valid fields. */
export function validScalar(word: string): boolean {
  if (word === 'true' || word === 'false') return true;
  if (DEC.test(word) || HEX.test(word) || OCT.test(word) || BIN.test(word) || FLOAT.test(word) || SPECIAL.test(word)) return true;
  const date = DATE.exec(word);
  if (date) return validDate(+date[1]!, +date[2]!, +date[3]!);
  const time = TIME.exec(word);
  if (time) return validTime(+time[1]!, +time[2]!, +time[3]!);
  const at = word.search(/[Tt ]/);
  if (at !== 10) return false;
  const d = DATE.exec(word.slice(0, 10)), rest = word.slice(11);
  if (!d || !validDate(+d[1]!, +d[2]!, +d[3]!)) return false;
  const t = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(rest);
  if (!t || !validTime(+t[1]!, +t[2]!, +t[3]!)) return false;
  const off = rest.slice(t[0].length);
  if (off === '') return true;
  const o = OFFSET.exec(off);
  return o !== null && (o[1] === undefined || (+o[1] <= 23 && +o[2]! <= 59));
}

/** Scans a TOML text. Null when it is not TOML 1.0, or when the scanner cannot check a part of it fully. */
export function scanToml(text: string): TomlDefined | null {
  const got = readToml(text);
  return got === null ? null : got.defined;
}

/**
 * Scans a TOML text and reads its value: the tables, the arrays, the strings, the booleans, the integers, and the
 * non-whole floats it holds, whatever the layout (headers, sub-tables, dotted keys, inline tables). Key order is the
 * order of the first definition. A value `Opaque` stands for what the reader does not compare. Null when `scanToml` is.
 */
export function readToml(text: string): { readonly defined: TomlDefined; readonly data: Record<string, unknown> } | null {
  try {
    const got = scan(text);
    return { defined: { headers: got.headers, arrays: got.arrays, values: got.values, dotted: got.dotted }, data: got.data };
  } catch (e) { if (e instanceof Invalid) return null; throw e; }
}

/** The plain value of a node: a table is an object with no prototype, an array of tables is opaque. */
function plainOf(n: Node): unknown {
  if (n.kind === 'value') return n.js;
  if (n.kind === 'aot') return new Opaque('array of tables');
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of n.children) out[k] = plainOf(v);
  return out;
}

/** What a bare word reads as: a boolean, a decimal integer, a float that is not whole; anything else is opaque. */
function wordValue(word: string): unknown {
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (DEC.test(word)) { const n = Number(word.replace(/_/g, '')); return Number.isSafeInteger(n) ? n : new Opaque(word); }
  if (FLOAT.test(word)) { const n = Number(word.replace(/_/g, '')); return Number.isFinite(n) && !Number.isInteger(n) ? n : new Opaque(word); }
  return new Opaque(word);
}

function scan(text: string): TomlDefined & { readonly data: Record<string, unknown> } {
  let i = 0, scope = 0;
  const headers: string[][] = [], arrays: string[][] = [], values: string[][] = [], dotted: string[][] = [];
  const root: Table = { kind: 'table', how: 'implicit', scope: 0, children: new Map(), path: [] };
  let current = root;
  const at = (s: string): boolean => text.startsWith(s, i);
  const blank = (): void => { while (text[i] === ' ' || text[i] === '\t') i++; };
  const comment = (): void => {
    if (text[i] !== '#') return;
    for (i++; i < text.length && text[i] !== '\n'; i++) { if (text[i] === '\r' && text[i + 1] === '\n') break; if (control(text.charCodeAt(i))) fail(); }
  };
  const newline = (): boolean => { if (text[i] === '\n') { i++; return true; } if (at('\r\n')) { i += 2; return true; } return false; };
  const eol = (): void => { blank(); comment(); if (i < text.length && !newline()) fail(); };
  /** White space, newlines, and comments, as allowed inside an array. */
  const gap = (): void => { for (;;) { blank(); comment(); if (!newline()) return; } };

  const escape = (): string => {
    const c = text[i + 1];
    const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
    if (c !== undefined && simple[c] !== undefined) { i += 2; return simple[c]; }
    const width = c === 'u' ? 4 : c === 'U' ? 8 : 0;
    const hex = text.slice(i + 2, i + 2 + width);
    if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) fail();
    const cp = parseInt(hex, 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail();
    i += 2 + width;
    return String.fromCodePoint(cp);
  };
  const basic = (): string => {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail();
      const ch = text[i]!;
      if (ch === '"') { i++; return out; }
      if (ch === '\\') { out += escape(); continue; }
      if (control(ch.charCodeAt(0))) fail();
      out += ch; i++;
    }
  };
  const literal = (): string => {
    i++;
    const start = i;
    for (;;) {
      if (i >= text.length) fail();
      if (text[i] === "'") { i++; return text.slice(start, i - 1); }
      if (control(text.charCodeAt(i))) fail();
      i++;
    }
  };
  const multiline = (q: '"' | "'"): void => {
    i += 3;
    if (!newline()) { /* a newline right after the opening quotes is trimmed; none is fine too */ }
    for (;;) {
      if (i >= text.length) fail();
      if (at(q.repeat(3))) {
        // Up to two more quotes may end the string: they are part of its content.
        let n = 3; while (text[i + n] === q) n++;
        if (n > 5) fail();
        i += n; return;
      }
      const ch = text[i]!;
      if (q === '"' && ch === '\\') {
        // A backslash at the end of a line trims the line break and the white space after it.
        const tail = /^\\[ \t]*(?:\r?\n)/.exec(text.slice(i));
        if (tail) { i += tail[0].length; while (' \t\r\n'.includes(text[i] ?? 'x')) { if (text[i] === '\r' && text[i + 1] !== '\n') fail(); i++; } continue; }
        escape(); continue;
      }
      if (ch === '\r') { if (text[i + 1] !== '\n') fail(); i += 2; continue; }
      if (ch !== '\n' && control(ch.charCodeAt(0))) fail();
      i++;
    }
  };

  const keyPart = (): string => {
    if (text[i] === '"') return basic();
    if (text[i] === "'") return literal();
    const m = BARE.exec(text.slice(i));
    if (!m) fail();
    i += m![0].length;
    return m![0];
  };
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) { blank(); parts.push(keyPart()); blank(); if (text[i] !== '.') return parts; i++; }
  };

  /** The table under `t` at `k`, made or reused as a step of a dotted key. */
  const dottedStep = (t: Table, k: string, local: number): Table => {
    const had = t.children.get(k);
    if (!had) { const n: Table = { kind: 'table', how: 'dotted', scope: local, children: new Map(), path: [...t.path, k] }; t.children.set(k, n); dotted.push(n.path); return n; }
    if (had.kind !== 'table') fail();
    const tb = had as Table;
    // A table that only a header path made on its way is taken over by the dotted key: no header may name it after.
    if (tb.how === 'implicit') { tb.how = 'dotted'; tb.scope = local; dotted.push(tb.path); return tb; }
    // Otherwise a dotted key extends only a table that dotted keys made in this same block.
    if (tb.how !== 'dotted' || tb.scope !== local) fail();
    return tb;
  };
  /** Parses `key = value` into table `t`. */
  const keyValue = (t: Table, local: number, record: boolean): void => {
    const k = key();
    if (text[i] !== '=') fail();
    i++; blank();
    let target = t;
    for (const part of k.slice(0, -1)) target = dottedStep(target, part, local);
    const last = k.at(-1)!;
    if (target.children.has(last)) fail();
    const v = value([...target.path, last]);
    target.children.set(last, v);
    if (record) values.push([...target.path, last]);
  };
  const value = (path: string[]): Node => {
    if (at('"""')) { multiline('"'); return { kind: 'value', js: new Opaque('multi-line string') }; }
    if (at("'''")) { multiline("'"); return { kind: 'value', js: new Opaque('multi-line string') }; }
    if (text[i] === '"') return { kind: 'value', js: basic() };
    if (text[i] === "'") return { kind: 'value', js: literal() };
    if (text[i] === '[') {
      i++;
      const items: unknown[] = [];
      for (;;) {
        gap();
        if (text[i] === ']') { i++; return { kind: 'value', js: items }; }
        items.push(plainOf(value(path))); gap();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { kind: 'value', js: items }; }
        fail();
      }
    }
    if (text[i] === '{') {
      // An inline table: one line, no trailing comma, and closed for good once written.
      i++; blank();
      const local = ++scope;
      const t: Table = { kind: 'table', how: 'inline', scope: local, children: new Map(), path };
      if (text[i] === '}') { i++; return t; }
      for (;;) {
        keyValue(t, local, false);
        blank();
        if (text[i] === ',') { i++; blank(); if (text[i] === '}') fail(); continue; }
        if (text[i] === '}') { i++; return t; }
        fail();
      }
    }
    const m = /^[^\s,\]}#]+/.exec(text.slice(i));
    if (!m) fail();
    let word = m![0];
    // A date and a time may be split by one space.
    if (DATE.test(word) && text[i + word.length] === ' ' && /^\d{2}:/.test(text.slice(i + word.length + 1))) {
      word += ' ' + /^[^\s,\]}#]+/.exec(text.slice(i + word.length + 1))![0];
    }
    if (!validScalar(word)) fail();
    i += word.length;
    return { kind: 'value', js: wordValue(word) };
  };

  /** Walks a header path to its parent table, making implicit tables on the way. */
  const parentOf = (k: string[]): Table => {
    let t = root;
    for (const part of k.slice(0, -1)) {
      const had = t.children.get(part);
      if (!had) { const n: Table = { kind: 'table', how: 'implicit', scope: 0, children: new Map(), path: [...t.path, part] }; t.children.set(part, n); t = n; continue; }
      if (had.kind === 'aot') { t = had.items.at(-1)!; continue; }
      if (had.kind !== 'table' || had.how === 'inline') fail();
      t = had as Table;
    }
    return t;
  };

  for (;;) {
    gap();
    if (i >= text.length) break;
    if (at('[[')) {
      i += 2; const k = key(); if (!at(']]')) fail(); i += 2;
      const parent = parentOf(k), last = k.at(-1)!;
      const had = parent.children.get(last);
      const local = ++scope;
      if (had === undefined) {
        const path = [...parent.path, last], item: Table = { kind: 'table', how: 'header', scope: local, children: new Map(), path: [...path, '\u00000'] };
        parent.children.set(last, { kind: 'aot', items: [item], path });
        arrays.push(path); current = item;
      } else if (had.kind === 'aot') {
        const item: Table = { kind: 'table', how: 'header', scope: local, children: new Map(), path: [...had.path, `\u0000${had.items.length}`] };
        had.items.push(item); arrays.push(had.path); current = item;
      } else fail();
      eol(); continue;
    }
    if (text[i] === '[') {
      i++; const k = key(); if (text[i] !== ']') fail(); i++;
      const parent = parentOf(k), last = k.at(-1)!;
      const had = parent.children.get(last);
      const local = ++scope;
      if (had === undefined) {
        const t: Table = { kind: 'table', how: 'header', scope: local, children: new Map(), path: [...parent.path, last] };
        parent.children.set(last, t); current = t;
      } else if (had.kind === 'table' && had.how === 'implicit') { had.how = 'header'; had.scope = local; current = had; }
      else fail();
      headers.push(current.path);
      eol(); continue;
    }
    keyValue(current, current.scope, true);
    eol();
  }
  return { headers, arrays, values, dotted, data: plainOf(root) as Record<string, unknown> };
}
