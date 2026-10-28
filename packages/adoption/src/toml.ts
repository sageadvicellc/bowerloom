/**
 * The TOML subset that adoption reads from Codex files (`.codex/config.toml`, `.codex/agents/*.toml`).
 *
 * Read: comments, `[table]` and `[[array.of.tables]]` headers, bare, quoted, and dotted keys, basic strings with the
 * escapes `\" \\ \b \f \n \r \t \uXXXX \UXXXXXXXX`, literal strings, decimal integers, decimal floats, booleans, arrays
 * of one scalar type (they may span lines and end with a comma), arrays of inline tables, and inline tables.
 *
 * Refused: multi-line strings, dates and times, hex, octal, binary, underscores in numbers, `inf` and `nan`, mixed
 * arrays, a key or table defined twice, and the key `__proto__`. A refusal names its kind and never repeats the input.
 * Adoption lists a refused file with the reason; it never guesses at a form it does not read.
 */
import type { JsonValue } from '../../harness-definition/src/index.js';

export type TomlCode = 'TOML_UNSUPPORTED' | 'TOML_DUPLICATE';
export type TomlResult = { readonly ok: true; readonly value: { readonly [key: string]: JsonValue } } | { readonly ok: false; readonly code: TomlCode; readonly line: number };

type Table = Record<string, JsonValue>;
class TomlFault extends Error { constructor(readonly code: TomlCode, readonly at: number) { super(code); } }

const BARE = /^[A-Za-z0-9_-]+$/;
const isTable = (v: JsonValue | undefined): v is Table => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Parses the subset. Returns plain objects with no prototype tricks. */
export function parseTomlSubset(text: string): TomlResult {
  const p = new Parser(text);
  try { return { ok: true, value: p.document() }; } catch (error) {
    if (error instanceof TomlFault) return { ok: false, code: error.code, line: p.lineAt(error.at) };
    throw error;
  }
}

class Parser {
  private i = 0;
  private readonly root: Table = Object.create(null) as Table;
  /** Tables defined by a header or a dotted key, and tables that are closed (inline tables, values). */
  private readonly defined = new Set<Table>();
  private readonly sealed = new Set<Table>();
  private readonly implicitByDots = new Set<Table>();
  constructor(private readonly s: string) {}

  lineAt(at: number): number { return this.s.slice(0, at).split('\n').length; }
  private fail(code: TomlCode = 'TOML_UNSUPPORTED'): never { throw new TomlFault(code, this.i); }
  private peek(): string { return this.s[this.i] ?? ''; }
  private spaces(): void { while (this.peek() === ' ' || this.peek() === '\t') this.i++; }
  private comment(): void { if (this.peek() === '#') { while (this.i < this.s.length && this.peek() !== '\n') { if (/[\0-\x08\x0a-\x1f\x7f]/.test(this.peek()) && this.peek() !== '\n') this.fail(); this.i++; } } }
  private endOfLine(): void {
    this.spaces(); this.comment();
    if (this.peek() === '\r' && this.s[this.i + 1] === '\n') this.i++;
    if (this.i < this.s.length && this.peek() !== '\n') this.fail();
    this.i++;
  }
  /** Spaces, comments, and line breaks inside an array. */
  private gap(): void {
    for (;;) {
      this.spaces(); this.comment();
      if (this.peek() === '\r' && this.s[this.i + 1] === '\n') { this.i += 2; continue; }
      if (this.peek() === '\n') { this.i++; continue; }
      return;
    }
  }

  document(): Table {
    let current = this.root;
    while (this.i < this.s.length) {
      this.spaces();
      const c = this.peek();
      if (c === '#' || c === '\n' || c === '\r' || c === '') { this.endOfLine(); continue; }
      if (c === '[') { current = this.header(); this.endOfLine(); continue; }
      this.pair(current);
      this.endOfLine();
    }
    return toPlain(this.root) as Table;
  }

  private header(): Table {
    const array = this.s.startsWith('[[', this.i);
    this.i += array ? 2 : 1;
    this.spaces();
    const keys = this.key();
    this.spaces();
    if (!this.s.startsWith(array ? ']]' : ']', this.i)) this.fail();
    this.i += array ? 2 : 1;
    let t = this.root;
    for (const k of keys.slice(0, -1)) t = this.descend(t, k, false);
    const last = keys.at(-1)!;
    if (array) {
      const existing = t[last];
      if (existing === undefined) { const list: Table[] = []; t[last] = list as unknown as JsonValue; }
      else if (!Array.isArray(existing) || this.sealed.has(existing as unknown as Table)) this.fail('TOML_DUPLICATE');
      const item = Object.create(null) as Table;
      (t[last] as unknown as Table[]).push(item);
      this.defined.add(item);
      return item;
    }
    const existing = t[last];
    if (existing === undefined) { const item = Object.create(null) as Table; t[last] = item; this.defined.add(item); return item; }
    if (!isTable(existing) || this.defined.has(existing) || this.sealed.has(existing) || this.implicitByDots.has(existing)) this.fail('TOML_DUPLICATE');
    this.defined.add(existing);
    return existing;
  }

  /** The table under `k`, made when missing. In a header path an array of tables means its last item. */
  private descend(t: Table, k: string, dotted: boolean): Table {
    const v = t[k];
    if (v === undefined) {
      const item = Object.create(null) as Table; t[k] = item;
      if (dotted) { this.implicitByDots.add(item); }
      return item;
    }
    if (Array.isArray(v) && !dotted && !this.sealed.has(v as unknown as Table)) { const last = v.at(-1); if (isTable(last)) return last; }
    if (!isTable(v) || this.sealed.has(v) || (dotted && this.defined.has(v) && !this.implicitByDots.has(v))) this.fail('TOML_DUPLICATE');
    return v;
  }

  private pair(t: Table): void {
    const keys = this.key();
    this.spaces();
    if (this.peek() !== '=') this.fail();
    this.i++;
    this.spaces();
    let target = t;
    for (const k of keys.slice(0, -1)) target = this.descend(target, k, true);
    const last = keys.at(-1)!;
    if (Object.hasOwn(target, last)) this.fail('TOML_DUPLICATE');
    target[last] = this.value();
  }

  private key(): string[] {
    const keys: string[] = [];
    for (;;) {
      this.spaces();
      let k: string;
      if (this.peek() === '"') k = this.basic();
      else if (this.peek() === "'") k = this.literal();
      else {
        const start = this.i;
        while (/[A-Za-z0-9_-]/.test(this.peek())) this.i++;
        k = this.s.slice(start, this.i);
        if (!BARE.test(k)) this.fail();
      }
      if (k === '__proto__') this.fail();
      keys.push(k);
      this.spaces();
      if (this.peek() !== '.') return keys;
      this.i++;
    }
  }

  private value(): JsonValue {
    const c = this.peek();
    if (c === '"') { if (this.s.startsWith('"""', this.i)) this.fail(); return this.basic(); }
    if (c === "'") { if (this.s.startsWith("'''", this.i)) this.fail(); return this.literal(); }
    if (c === '[') return this.array();
    if (c === '{') return this.inline();
    const m = /^(?:true|false|[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)(?=[ \t\r\n,\]}#]|$)/.exec(this.s.slice(this.i, this.i + 64));
    if (!m) this.fail();
    this.i += m[0].length;
    if (m[0] === 'true') return true;
    if (m[0] === 'false') return false;
    const n = Number(m[0]);
    if (!Number.isFinite(n) || (!/[.eE]/.test(m[0]) && !Number.isSafeInteger(n))) this.fail();
    return n;
  }

  private basic(): string {
    this.i++;
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === '' || c === '\n' || c === '\r') this.fail();
      this.i++;
      if (c === '"') return out;
      if (c === '\\') {
        const e = this.peek(); this.i++;
        const simple: Record<string, string> = { '"': '"', '\\': '\\', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (Object.hasOwn(simple, e)) { out += simple[e]; continue; }
        const width = e === 'u' ? 4 : e === 'U' ? 8 : 0;
        const hex = this.s.slice(this.i, this.i + width);
        if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) this.fail();
        const point = Number.parseInt(hex, 16);
        if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) this.fail();
        out += String.fromCodePoint(point); this.i += width; continue;
      }
      if (/[\0-\x08\x0a-\x1f\x7f]/.test(c)) this.fail();
      out += c;
    }
  }

  private literal(): string {
    this.i++;
    const end = this.s.indexOf("'", this.i);
    if (end === -1) this.fail();
    const v = this.s.slice(this.i, end);
    if (/[\0-\x08\x0a-\x1f\x7f]/.test(v)) this.fail();
    this.i = end + 1;
    return v;
  }

  private array(): JsonValue[] {
    this.i++;
    const out: JsonValue[] = [];
    for (;;) {
      this.gap();
      if (this.peek() === ']') { this.i++; break; }
      out.push(this.value());
      this.gap();
      if (this.peek() === ',') { this.i++; continue; }
      if (this.peek() === ']') { this.i++; break; }
      this.fail();
    }
    const kinds = new Set(out.map(v => (isTable(v) ? 'table' : Array.isArray(v) ? 'array' : typeof v)));
    if (kinds.size > 1) this.fail();
    for (const v of out) if (isTable(v)) this.sealed.add(v);
    const list = out as unknown as Table;
    this.sealed.add(list);
    return out;
  }

  private inline(): Table {
    this.i++;
    const t = Object.create(null) as Table;
    this.spaces();
    if (this.peek() === '}') { this.i++; this.sealed.add(t); return t; }
    for (;;) {
      this.pair(t);
      this.spaces();
      if (this.peek() === ',') { this.i++; this.spaces(); continue; }
      if (this.peek() === '}') { this.i++; break; }
      this.fail();
    }
    this.sealed.add(t);
    return t;
  }
}

/** A copy with ordinary prototypes, keys in file order. */
function toPlain(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(toPlain);
  if (isTable(v)) return Object.fromEntries(Object.keys(v).map(k => [k, toPlain(v[k]!)]));
  return v;
}
