/**
 * The path pattern language of context slices (spec 05, section 4.2). Bowerloom defines it itself, so a result never
 * depends on the Node version. Pure: no file is read.
 *
 * A pattern is split at `/`. A segment of exactly `**` matches zero or more whole segments. `*` matches a run of
 * characters inside one segment, `?` one character. `\` makes the next character literal. `[`, `]`, `{`, `}` and a
 * leading `!` are refused unless escaped. A wildcard never matches a segment that starts with a dot, and a pattern
 * segment that starts with a dot is refused, so a hidden entry is never a member.
 */
type Token = { kind: 'char'; value: string } | { kind: 'star' } | { kind: 'one' };
type Segment = { kind: 'globstar' } | { kind: 'tokens'; tokens: Token[]; wildcard: boolean; literal: string };
export interface CompiledPattern { readonly source: string; readonly segments: readonly Segment[]; readonly literal: boolean }
export type PatternResult = { ok: true; pattern: CompiledPattern } | { ok: false; detail: string };

const CONTROL = /[\p{Cc}\p{Cf}]/u;
const fail = (detail: string): PatternResult => ({ ok: false, detail });

/** Splits at unescaped `/`. Returns null for a trailing lone escape. */
function splitSegments(text: string): string[] | null {
  const out: string[] = []; let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\') { if (i + 1 >= text.length) return null; cur += c + text[i + 1]!; i++; }
    else if (c === '/') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

export function compilePattern(text: string): PatternResult {
  if (typeof text !== 'string' || text.length === 0) return fail('a pattern is not empty');
  if (CONTROL.test(text)) return fail('a pattern holds a control character');
  if (text.startsWith('!')) return fail('a pattern does not start with !, use exclude');
  if (text.startsWith('/')) return fail('a pattern does not start with /');
  if (text.startsWith('./')) return fail('a pattern does not start with ./');
  const parts = splitSegments(text.normalize('NFC'));
  if (parts === null) return fail('a pattern does not end with a lone \\');
  const segments: Segment[] = []; let literal = true;
  for (const part of parts) {
    if (part === '') return fail('a pattern has an empty segment');
    if (part === '**') { segments.push({ kind: 'globstar' }); literal = false; continue; }
    const first = part.startsWith('\\') ? part.slice(1, 3) : part.slice(0, 1);
    if (part.startsWith('.') || first.startsWith('.')) return fail('a pattern segment does not start with a dot');
    const tokens: Token[] = []; let wildcard = false, lit = '';
    for (let i = 0; i < part.length; i++) {
      const c = part[i]!;
      if (c === '\\') {
        const cp = String.fromCodePoint(part.codePointAt(i + 1)!); i += cp.length;
        tokens.push({ kind: 'char', value: cp }); lit += cp;
      } else if (c === '[' || c === ']' || c === '{' || c === '}') return fail('a pattern does not use [, ], { or }, unless escaped');
      else if (c === '*') { wildcard = true; if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' }); }
      else if (c === '?') { wildcard = true; tokens.push({ kind: 'one' }); }
      else { const cp = String.fromCodePoint(part.codePointAt(i)!); i += cp.length - 1; tokens.push({ kind: 'char', value: cp }); lit += cp; }
    }
    if (part === '.' || part === '..') return fail('a pattern has no . or .. segment');
    segments.push({ kind: 'tokens', tokens, wildcard, literal: lit });
    if (wildcard) literal = false;
  }
  return { ok: true, pattern: { source: text, segments, literal } };
}

const cache = new Map<string, CompiledPattern | null>();
function use(pattern: string | CompiledPattern): CompiledPattern | null {
  if (typeof pattern !== 'string') return pattern;
  if (cache.has(pattern)) return cache.get(pattern)!;
  const r = compilePattern(pattern), value = r.ok ? r.pattern : null;
  if (cache.size > 512) cache.clear();
  cache.set(pattern, value); return value;
}

function segmentMatches(seg: Extract<Segment, { kind: 'tokens' }>, name: string): boolean {
  if (name.startsWith('.')) return false;
  const chars = Array.from(name), t = seg.tokens;
  // Dynamic programming over (token index, char index).
  let row = new Array<boolean>(chars.length + 1).fill(false); row[0] = true;
  for (const token of t) {
    const next = new Array<boolean>(chars.length + 1).fill(false);
    if (token.kind === 'star') { let any = false; for (let j = 0; j <= chars.length; j++) { any = any || row[j]!; next[j] = any; } }
    else for (let j = 1; j <= chars.length; j++) if (row[j - 1]! && (token.kind === 'one' || chars[j - 1] === token.value)) next[j] = true;
    row = next;
  }
  return row[chars.length]!;
}

/** True when the pattern matches the path, which is relative to the root and uses `/`. */
export function matchPattern(pattern: string | CompiledPattern, path: string): boolean {
  const p = use(pattern); if (p === null) return false;
  const parts = path.normalize('NFC').split('/');
  if (parts.some(s => s === '' || s.startsWith('.'))) return false;
  const segs = p.segments;
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = i * 1024 + j; const known = memo.get(key); if (known !== undefined) return known;
    let result: boolean;
    if (i === segs.length) result = j === parts.length;
    else {
      const s = segs[i]!;
      if (s.kind === 'globstar') { result = go(i + 1, j); for (let k = j; !result && k < parts.length; k++) result = go(i + 1, k + 1); }
      else result = j < parts.length && segmentMatches(s, parts[j]!) && go(i + 1, j + 1);
    }
    memo.set(key, result); return result;
  };
  return parts.length <= 1000 && go(0, 0);
}

/** True when some path under `folder` (relative to the root, '' for the root) could match. */
export function canMatchBelow(pattern: string | CompiledPattern, folder: string): boolean {
  const p = use(pattern); if (p === null) return false;
  const parts = folder === '' || folder === '.' ? [] : folder.normalize('NFC').split('/');
  if (parts.some(s => s === '' || s.startsWith('.'))) return false;
  const segs = p.segments;
  // States are pattern positions. A globstar can consume zero segments, so positions are closed over it.
  const close = (set: Set<number>): Set<number> => { for (const i of [...set]) { let k = i; while (k < segs.length && segs[k]!.kind === 'globstar') { k++; set.add(k); } } return set; };
  let states = close(new Set([0]));
  for (const part of parts) {
    const next = new Set<number>();
    for (const i of states) {
      if (i >= segs.length) continue;
      const s = segs[i]!;
      if (s.kind === 'globstar') next.add(i); else if (segmentMatches(s, part)) next.add(i + 1);
    }
    states = close(next); if (states.size === 0) return false;
  }
  // A path below the folder needs at least one more segment, so some state must still have a segment to match.
  for (const i of states) if (i < segs.length) return true;
  return false;
}

/** True when the pattern has no unescaped wildcard. */
export function isLiteral(pattern: string | CompiledPattern): boolean {
  const p = use(pattern); return p !== null && p.literal;
}

/** The literal path of a literal pattern, escapes removed, or null. */
export function literalPath(pattern: string | CompiledPattern): string | null {
  const p = use(pattern); if (p === null || !p.literal) return null;
  return p.segments.map(s => s.kind === 'tokens' ? s.literal : '').join('/');
}
