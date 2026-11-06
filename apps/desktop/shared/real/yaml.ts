/**
 * A small, tolerant reader for the part of YAML that front matter and tool config files use: nested maps, lists, plain and quoted text, block text (`|` and `>`),
 * and the short forms `[a, b]` and `{a: b}`. Every value comes back as text. It reads no file, runs no code, and never follows an anchor or a tag; a shape it does
 * not know throws a `YamlError`, which the caller turns into "could not read". Pure.
 */

export type YamlValue = string | readonly YamlValue[] | { readonly [key: string]: YamlValue };
export type YamlMap = { readonly [key: string]: YamlValue };

export class YamlError extends Error {}

interface Line { indent: number; text: string; raw: string }

const MAX_DEPTH = 24;

function toLines(text: string): Line[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map(raw => {
    const noTabs = raw.replace(/^\t+/, tabs => '  '.repeat(tabs.length));
    const indent = noTabs.length - noTabs.trimStart().length;
    return { indent, text: noTabs.trim(), raw: noTabs };
  });
}

const isBlank = (line: Line): boolean => line.text === '' || line.text.startsWith('#');

/** Removes a trailing comment (a `#` after a space) from text that is not inside quotes. */
function withoutComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote !== '') { if (c === quote && !(quote === '"' && text[i - 1] === '\\')) quote = ''; continue; }
    if (c === '"' || c === '\'') { if (i === 0 || /[\s[{,:]/.test(text[i - 1]!)) quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(text[i - 1]!))) return text.slice(0, i).trimEnd();
  }
  return text;
}

function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(["\\/nrt])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
  if (t.length >= 2 && t.startsWith('\'') && t.endsWith('\'')) return t.slice(1, -1).replace(/''/g, '\'');
  return t;
}

/** Splits `a, "b, c", d` at the commas that are not inside quotes, brackets or braces. */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i]!;
    if (quote !== '') { if (c === quote && !(quote === '"' && inner[i - 1] === '\\')) quote = ''; continue; }
    if (c === '"' || c === '\'') quote = c;
    else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  const last = inner.slice(start);
  if (last.trim() !== '') parts.push(last);
  return parts.map(p => p.trim()).filter(p => p !== '');
}

/** The index of the `:` that separates a key from its value in `a: b`, or -1. A colon inside quotes, or with no space after it, does not count. */
function colonAt(text: string): number {
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote !== '') { if (c === quote) quote = ''; continue; }
    if ((c === '"' || c === '\'') && i === 0) { quote = c; continue; }
    if (c === ':' && (i === text.length - 1 || text[i + 1] === ' ')) return i;
  }
  return -1;
}

function inlineValue(text: string, depth: number): YamlValue {
  if (depth > MAX_DEPTH) throw new YamlError('too deep');
  const t = withoutComment(text).trim();
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new YamlError('list not closed');
    return splitFlow(t.slice(1, -1)).map(p => inlineValue(p, depth + 1));
  }
  if (t.startsWith('{')) {
    if (!t.endsWith('}')) throw new YamlError('map not closed');
    const out: Record<string, YamlValue> = {};
    for (const part of splitFlow(t.slice(1, -1))) {
      const at = colonAt(part), key = at < 0 ? unquote(part) : unquote(part.slice(0, at));
      if (key === '__proto__') continue;
      out[key] = at < 0 ? '' : inlineValue(part.slice(at + 1), depth + 1);
    }
    return out;
  }
  if (/^[&*!]/.test(t)) throw new YamlError('anchors and tags are not read');
  return unquote(t);
}

function blockScalar(lines: Line[], at: number, parent: number, style: string): { value: string; next: number } {
  const collected: string[] = [];
  let i = at, indent = -1;
  for (; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (l.text === '') { collected.push(''); continue; }
    if (l.indent <= parent) break;
    if (indent < 0) indent = l.indent;
    collected.push(l.raw.slice(Math.min(indent, l.indent)));
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
  const folded = style.startsWith('>');
  const value = folded ? collected.reduce((acc, line) => (line === '' ? `${acc}\n` : acc === '' || acc.endsWith('\n') ? acc + line : `${acc} ${line}`), '') : collected.join('\n');
  return { value, next: i };
}

function nextSignificant(lines: Line[], from: number): number {
  let i = from;
  while (i < lines.length && isBlank(lines[i]!)) i += 1;
  return i;
}

function parseBlock(lines: Line[], at: number, indent: number, depth: number): { value: YamlValue; next: number } {
  if (depth > MAX_DEPTH) throw new YamlError('too deep');
  const first = lines[at]!;
  return first.text === '-' || first.text.startsWith('- ') ? parseSeq(lines, at, indent, depth) : parseMap(lines, at, indent, depth);
}

function parseSeq(lines: Line[], at: number, indent: number, depth: number): { value: YamlValue; next: number } {
  const out: YamlValue[] = [];
  let i = at;
  while (i < lines.length) {
    i = nextSignificant(lines, i);
    const l = lines[i];
    if (l === undefined || l.indent !== indent || !(l.text === '-' || l.text.startsWith('- '))) break;
    const rest = l.text === '-' ? '' : l.text.slice(2).trimStart();
    if (rest === '') {
      const n = nextSignificant(lines, i + 1);
      if (n < lines.length && lines[n]!.indent > indent) { const r = parseBlock(lines, n, lines[n]!.indent, depth + 1); out.push(r.value); i = r.next; } else { out.push(''); i += 1; }
      continue;
    }
    if (colonAt(rest) > 0 && !rest.startsWith('[') && !rest.startsWith('{') && !rest.startsWith('"') && !rest.startsWith('\'')) {
      // A map that starts on the dash line: its other keys line up with the first one.
      const inner = indent + (l.text.length - rest.length);
      lines[i] = { indent: inner, text: rest, raw: ' '.repeat(inner) + rest };
      const r = parseMap(lines, i, inner, depth + 1);
      out.push(r.value); i = r.next;
      continue;
    }
    out.push(inlineValue(rest, depth)); i += 1;
  }
  return { value: out, next: i };
}

function parseMap(lines: Line[], at: number, indent: number, depth: number): { value: YamlValue; next: number } {
  const out: Record<string, YamlValue> = {};
  let i = at;
  while (i < lines.length) {
    i = nextSignificant(lines, i);
    const l = lines[i];
    if (l === undefined || l.indent < indent) break;
    if (l.indent > indent) throw new YamlError('unexpected indent');
    if (l.text === '-' || l.text.startsWith('- ')) break;
    const at2 = colonAt(l.text);
    if (at2 < 0) throw new YamlError('no key');
    const key = unquote(l.text.slice(0, at2)), rest = withoutComment(l.text.slice(at2 + 1)).trim();
    i += 1;
    if (key === '__proto__') continue;
    if (rest === '') {
      const n = nextSignificant(lines, i);
      const sameIndentList = n < lines.length && lines[n]!.indent === indent && (lines[n]!.text === '-' || lines[n]!.text.startsWith('- '));
      if (n < lines.length && (lines[n]!.indent > indent || sameIndentList)) { const r = parseBlock(lines, n, lines[n]!.indent, depth + 1); out[key] = r.value; i = r.next; } else out[key] = '';
      continue;
    }
    if (/^[|>][+-]?\d*$/.test(rest)) { const r = blockScalar(lines, i, indent, rest); out[key] = r.value; i = r.next; continue; }
    if ((rest.startsWith('"') && !(rest.length > 1 && rest.endsWith('"'))) || (rest.startsWith('\'') && !(rest.length > 1 && rest.endsWith('\'')))) {
      // A quoted text that goes on over more lines.
      const quote = rest[0]!;
      let joined = rest;
      while (i < lines.length && !(joined.length > 1 && joined.endsWith(quote))) { joined += ` ${lines[i]!.text}`; i += 1; }
      out[key] = unquote(joined);
      continue;
    }
    if (rest.startsWith('[') && !rest.endsWith(']')) {
      let joined = rest;
      while (i < lines.length && !joined.trimEnd().endsWith(']')) { joined += ` ${lines[i]!.text}`; i += 1; }
      out[key] = inlineValue(joined, depth);
      continue;
    }
    // A plain text goes on over the more indented lines that follow.
    let value = rest;
    if (!rest.startsWith('[') && !rest.startsWith('{')) {
      while (i < lines.length) {
        const n = lines[i]!;
        if (n.text === '') { i += 1; continue; }
        if (n.indent <= indent || n.text.startsWith('#')) break;
        value += ` ${withoutComment(n.text)}`; i += 1;
      }
    }
    out[key] = inlineValue(value, depth);
  }
  return { value: out, next: i };
}

/** Reads a YAML text whose top level is a map. Throws `YamlError` for a shape it does not know. */
export function parseYaml(text: string): YamlMap {
  const lines = toLines(text);
  const at = nextSignificant(lines, 0);
  if (at >= lines.length) return {};
  const first = lines[at]!;
  if (first.text === '-' || first.text.startsWith('- ')) throw new YamlError('a list at the top');
  const { value } = parseMap(lines, at, first.indent, 0);
  return value as YamlMap;
}

export const isMap = (value: YamlValue | undefined): value is YamlMap => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isList = (value: YamlValue | undefined): value is readonly YamlValue[] => Array.isArray(value);

/** A value as text, or '' when it is not text. */
export const textOf = (value: YamlValue | undefined): string => (typeof value === 'string' ? value : '');

/** A value as a list of text: a list stays one, a comma separated text is split, a map gives its key names. */
export function listOf(value: YamlValue | undefined): string[] {
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(s => s !== '');
  if (Array.isArray(value)) return (value as readonly YamlValue[]).flatMap(v => (typeof v === 'string' ? [v.trim()] : [])).filter(s => s !== '');
  if (isMap(value)) return Object.keys(value);
  return [];
}
