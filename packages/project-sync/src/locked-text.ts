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

/** Add members to the object at `path`, or items to the array at `path`. Missing objects on the way are created. */
export type JsonOp =
  | { readonly kind: 'members'; readonly path: readonly string[]; readonly members: readonly (readonly [string, Out])[] }
  | { readonly kind: 'items'; readonly path: readonly string[]; readonly items: readonly Out[] };

export type EditResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: 'invalid' } | { readonly ok: false; readonly reason: 'conflict'; readonly at: readonly string[] };

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
  const conflicts: string[] = [];
  const insertMembers = (obj: Extract<JNode, { kind: 'object' }>, depth: number, add: readonly (readonly [string, Out])[]): void => {
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
        if (!sameValue(JSON.parse(text.slice(had.value.start, had.value.end)), plain(v))) conflicts.push([...op.path, k].join('.'));
      }
      if (add.length) insertMembers(node, depth, add);
    } else {
      const key = op.path.at(-1)!;
      const had = node.members.find(x => x.key === key);
      if (!had) { insertMembers(node, depth, [[key, [...op.items]]]); continue; }
      if (had.value.kind !== 'array') { conflicts.push(op.path.join('.')); continue; }
      const arr = had.value;
      const present = arr.items.map(n => JSON.parse(text.slice(n.start, n.end)) as unknown);
      const add = op.items.filter(v => !present.some(p => sameValue(p, plain(v))));
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
  return { ok: true, text };
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

/** What a TOML text defines: table headers, array-of-table headers, key paths, and the tables that dotted keys create. */
export interface TomlDefined {
  readonly headers: readonly (readonly string[])[];
  readonly arrays: readonly (readonly string[])[];
  readonly values: readonly (readonly string[])[];
  readonly dotted: readonly (readonly string[])[];
}

/** Scans a TOML text. Null when it is not valid enough to be sure what it defines. */
export function scanToml(text: string): TomlDefined | null {
  const headers: string[][] = [], arrays: string[][] = [], values: string[][] = [], dotted: string[][] = [];
  let i = 0, table: string[] = [];
  const at = (s: string): boolean => text.startsWith(s, i);
  const fail = (): never => { throw new SyntaxError('not TOML'); };
  const blank = (): void => { while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++; };
  const comment = (): void => { if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++; };
  const eol = (): void => {
    blank(); comment();
    if (i === text.length) return;
    if (at('\r\n')) i += 2; else if (text[i] === '\n') i++; else fail();
  };
  const basic = (): string => {
    i++;
    let out = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\n') fail();
      if (text[i] === '\\') { const m = /^\\(?:[btnfr"\\]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/.exec(text.slice(i, i + 10)); if (!m) fail(); out += JSON.parse(`"${m![0].startsWith('\\U') ? '' : m![0]}"`) as string; i += m![0].length; continue; }
      out += text[i]; i++;
    }
    if (text[i] !== '"') fail();
    i++;
    return out;
  };
  const literal = (): string => {
    const end = text.indexOf("'", i + 1);
    if (end < 0 || text.slice(i + 1, end).includes('\n')) fail();
    const out = text.slice(i + 1, end);
    i = end + 1;
    return out;
  };
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      blank();
      if (text[i] === '"') parts.push(basic());
      else if (text[i] === "'") parts.push(literal());
      else { const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i)); if (!m) fail(); parts.push(m![0]); i += m![0].length; }
      blank();
      if (text[i] === '.') { i++; continue; }
      return parts;
    }
  };
  const ws = (): void => { for (;;) { blank(); comment(); if (at('\r\n')) i += 2; else if (text[i] === '\n') i++; else return; } };
  const value = (): void => {
    blank();
    if (at('"""') || at("'''")) {
      const q = text.slice(i, i + 3);
      i += 3;
      for (;;) {
        if (i >= text.length) fail();
        if (q === '"""' && text[i] === '\\') { i += 2; continue; }
        if (at(q)) { i += 3; while (text[i] === q[0] && at(q[0]!)) i++; return; }
        i++;
      }
    }
    if (text[i] === '"') { basic(); return; }
    if (text[i] === "'") { literal(); return; }
    if (text[i] === '[') {
      i++;
      for (;;) {
        ws();
        if (text[i] === ']') { i++; return; }
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail();
      }
    }
    if (text[i] === '{') {
      i++;
      for (;;) {
        ws();
        if (text[i] === '}') { i++; return; }
        key(); blank();
        if (text[i] !== '=') fail();
        i++; value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail();
      }
    }
    const m = /^[^\s,\]}#]+/.exec(text.slice(i));
    if (!m) fail();
    i += m![0].length;
  };
  try {
    if (text.charCodeAt(0) === 0xfeff) i = 1;
    while (i < text.length) {
      blank();
      if (i >= text.length) break;
      if (text[i] === '#' || text[i] === '\n' || at('\r\n')) { eol(); continue; }
      if (at('[[')) { i += 2; const k = key(); if (!at(']]')) fail(); i += 2; arrays.push(k); table = k; eol(); continue; }
      if (text[i] === '[') { i++; const k = key(); if (text[i] !== ']') fail(); i++; headers.push(k); table = k; eol(); continue; }
      const k = key();
      if (text[i] !== '=') fail();
      i++;
      value();
      values.push([...table, ...k]);
      for (let n = 1; n < k.length; n++) dotted.push([...table, ...k.slice(0, n)]);
      eol();
    }
  } catch { return null; }
  return { headers, arrays, values, dotted };
}

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

/**
 * Adds managed keys at the top and managed tables at the end of a TOML text, or of an empty file. The person's bytes
 * stay as they are, in order. `forbid` names top-level keys whose presence makes the managed content meaningless.
 */
export function editToml(base: string | null, root: readonly (readonly [string, Out])[], tables: readonly TomlTable[], forbid: readonly string[] = []): EditResult {
  const text = base ?? '';
  const d = scanToml(text);
  if (d === null) return { ok: false, reason: 'invalid' };
  const conflicts = [
    ...root.flatMap(([k]) => tomlRootConflicts(d, k)), ...forbid.flatMap(k => tomlRootConflicts(d, k)),
    ...tables.flatMap(t => tomlTableConflicts(d, t.path)),
  ];
  if (conflicts.length) return { ok: false, reason: 'conflict', at: [...new Set(conflicts)] };
  const bom = text.charCodeAt(0) === 0xfeff ? '\ufeff' : '';
  const body = text.slice(bom.length);
  const head = root.length ? `${TOML_KEYS_OPEN}${tomlLines(root)}${TOML_KEYS_CLOSE}${body.length ? '\n' : ''}` : '';
  const tail = tables.length
    ? `${body.length && !body.endsWith('\n') ? '\n' : ''}${body.length || head.length ? '\n' : ''}${TOML_TABLES_OPEN}${tables.map(t => `[${t.path.map(tomlKey).join('.')}]\n${tomlLines(t.entries)}`).join('\n')}${TOML_TABLES_CLOSE}`
    : '';
  const out = `${bom}${head}${body}${tail}`;
  if (scanToml(out) === null) return { ok: false, reason: 'invalid' };
  return { ok: true, text: out };
}

// ---- YAML and frontmatter -------------------------------------------------------------------------------------------------

/** A value that DeepSeek Harness evaluates as JavaScript, written with the tag `!!js`. */
export interface Js { readonly js: string }
export type YamlOut = null | boolean | number | string | Js | readonly YamlOut[] | { readonly [key: string]: YamlOut };
const isJs = (v: unknown): v is Js => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as Js).js === 'string';

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
/** Markdown with YAML frontmatter. Keys are plain, values are JSON; a list of pairs is a nested block mapping. */
export function frontmatter(entries: readonly (readonly [string, unknown])[], body: string): string {
  const lines = entries.map(([k, v]) => {
    if (Array.isArray(v) && v.length > 0 && v.every(x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string')) {
      return `${fmKey(k)}:\n${(v as [string, unknown][]).map(([a, b]) => `  ${JSON.stringify(a)}: ${JSON.stringify(b)}\n`).join('')}`;
    }
    return `${fmKey(k)}: ${JSON.stringify(v)}\n`;
  });
  return `---\n${lines.join('')}---\n${body}`;
}
