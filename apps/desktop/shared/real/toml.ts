/**
 * A small, tolerant reader for the part of TOML that Codex config and agent files use: tables (`[a.b]`, `[[a]]`), text values (plain, literal and multi-line),
 * lists, and inline tables. A value is kept only when it is text; for a list the text items are kept; for an inline table only its key NAMES are kept.
 * Anything else is marked `other`. It reads no file and runs no code. A line it cannot read is skipped. Pure.
 */

export type TomlValue =
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'arr'; readonly v: readonly string[] }
  | { readonly t: 'tbl'; readonly keys: readonly string[] }
  | { readonly t: 'other' };

export interface TomlTable { readonly path: readonly string[]; readonly values: ReadonlyMap<string, TomlValue> }

/** Splits `a.b."c d"` into its parts, honoring quotes. */
export function splitPath(text: string): string[] {
  const parts: string[] = [];
  let cur = '', quote = '';
  for (const c of text) {
    if (quote !== '') { if (c === quote) quote = ''; else cur += c; continue; }
    if (c === '"' || c === '\'') { quote = c; continue; }
    if (c === '.') { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  return parts.filter(p => p !== '');
}

function stripComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quote !== '') { if (c === quote && !(quote === '"' && line[i - 1] === '\\')) quote = ''; continue; }
    if (c === '"' || c === '\'') quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function unescape(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|["\\nrt])/g, (_m, c: string) => (c.startsWith('u') ? String.fromCharCode(parseInt(c.slice(1), 16)) : c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
}

/** The depth change of brackets and braces in a piece of value text, outside quotes. */
function balance(text: string): number {
  let depth = 0, quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote !== '') { if (c === quote && !(quote === '"' && text[i - 1] === '\\')) quote = ''; continue; }
    if (c === '"' || c === '\'') quote = c;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
  }
  return depth;
}

/** The text items of a list, and the key names of an inline table, read from the raw value text. */
function textItems(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/"((?:[^"\\\n]|\\.)*)"|'([^'\n]*)'/g)) out.push(m[1] !== undefined ? unescape(m[1]) : (m[2] ?? ''));
  return out;
}

function tableKeys(raw: string): string[] {
  const inner = raw.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys: string[] = [];
  let depth = 0, quote = '', start = 0;
  const take = (piece: string): void => {
    const eq = piece.indexOf('=');
    if (eq > 0) { const key = splitPath(piece.slice(0, eq).trim()).join('.'); if (key !== '') keys.push(key); }
  };
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i]!;
    if (quote !== '') { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === '\'') quote = c;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { take(inner.slice(start, i)); start = i + 1; }
  }
  take(inner.slice(start));
  return [...new Set(keys)].sort();
}

function valueOf(raw: string): TomlValue {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return { t: 'str', v: unescape(t.slice(1, -1)) };
  if (t.startsWith('\'') && t.endsWith('\'') && t.length >= 2) return { t: 'str', v: t.slice(1, -1) };
  if (t.startsWith('[')) return { t: 'arr', v: textItems(t) };
  if (t.startsWith('{')) return { t: 'tbl', keys: tableKeys(t) };
  return { t: 'other' };
}

/** Reads a TOML text into its tables, in order. The first table has an empty path and holds the keys before any header. Never throws. */
export function parseToml(text: string): TomlTable[] {
  const tables: { path: string[]; values: Map<string, TomlValue> }[] = [{ path: [], values: new Map() }];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const body = stripComment(line).trim();
    if (body === '') continue;
    const header = body.match(/^\[\[?\s*(.+?)\s*\]\]?$/);
    if (header !== null && !body.includes('=')) { tables.push({ path: splitPath(header[1]!), values: new Map() }); continue; }
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = splitPath(body.slice(0, eq).trim()).join('.');
    let raw = body.slice(eq + 1).trim();
    if (key === '') continue;
    if (raw.startsWith('"""') || raw.startsWith('\'\'\'')) {
      const fence = raw.slice(0, 3);
      let rest = raw.slice(3), joined = '';
      for (;;) {
        const end = rest.indexOf(fence);
        if (end >= 0) { joined += rest.slice(0, end); break; }
        joined += `${rest}\n`;
        i += 1;
        if (i >= lines.length) break;
        rest = lines[i]!;
      }
      tables[tables.length - 1]!.values.set(key, { t: 'str', v: fence === '"""' ? unescape(joined.replace(/^\n/, '')) : joined.replace(/^\n/, '') });
      continue;
    }
    if (raw.startsWith('[') || raw.startsWith('{')) {
      // The depth is counted line by line and added up: the text joined so far is not counted again for every new line (that would be quadratic in the size of the value).
      let guard = 0, depth = balance(raw);
      while (depth > 0 && i + 1 < lines.length && guard < 2000) { i += 1; guard += 1; const piece = stripComment(lines[i]!).trim(); raw += ` ${piece}`; depth += balance(piece); }
    }
    tables[tables.length - 1]!.values.set(key, valueOf(raw));
  }
  return tables;
}

/** The text a table holds under a key, or ''. */
export function tomlText(table: TomlTable | undefined, key: string): string {
  const v = table?.values.get(key);
  return v !== undefined && v.t === 'str' ? v.v : '';
}
