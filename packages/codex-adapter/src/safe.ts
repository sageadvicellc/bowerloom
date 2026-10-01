import { createHash } from 'node:crypto';
export class AdapterError extends Error { constructor(readonly code: string) { super(code); this.name = 'AdapterError'; } }
export function check(value: unknown, code: string): asserts value { if (!value) throw new AdapterError(code); }
export function sha(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function object(value: unknown): Record<string, any> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT'); return value as Record<string, any>;
}
export function exact(value: unknown, keys: string[]): Record<string, any> {
  const v = object(value); check(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k)), 'INVALID_KEYS'); return v;
}
export function id(value: unknown): string {
  check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
    && !['__proto__','constructor','prototype'].includes(value), 'INVALID_ID'); return value;
}
export function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
export function time(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
// Reject duplicate keys, invalid Unicode, deep/numerous nodes, and nonfinite numbers.
// Parsing happens in memory; caller errors never include input or native messages.
export function strictJson(text: string, maxBytes = 2 * 1024 * 1024): unknown {
  check(typeof text === 'string' && Buffer.byteLength(text) <= maxBytes && Buffer.from(text).toString('utf8') === text, 'JSON_BOUND');
  let at = 0, nodes = 0;
  const ws = () => { while (/[\t\n\r ]/.test(text[at] ?? '\0')) at++; };
  const str = (): string => {
    const start = at++; let escaped = false;
    while (at < text.length) {
      const c = text[at++]!;
      if (!escaped && c === '"') { try { const value=JSON.parse(text.slice(start,at)) as string;check(Buffer.from(value).toString('utf8')===value,'INVALID_UNICODE');return value; } catch { throw new AdapterError('INVALID_JSON'); } }
      if (!escaped && c === '\\') escaped = true; else escaped = false;
    }
    throw new AdapterError('INVALID_JSON');
  };
  const read = (depth: number): unknown => {
    check(depth <= 48 && ++nodes <= 50000, 'JSON_COMPLEXITY'); ws(); const c = text[at];
    if (c === '"') return str();
    if (c === '{') {
      at++; ws(); const out: Record<string, unknown> = Object.create(null);
      if (text[at] === '}') { at++; return out; }
      for (;;) {
        check(text[at] === '"', 'INVALID_JSON'); const key = str(); check(!Object.hasOwn(out,key), 'DUPLICATE_JSON_KEY'); ws();
        check(text[at++] === ':', 'INVALID_JSON'); out[key] = read(depth+1); ws(); const sep = text[at++];
        if (sep === '}') return out; check(sep === ',', 'INVALID_JSON'); ws();
      }
    }
    if (c === '[') {
      at++; ws(); const out: unknown[] = []; if (text[at] === ']') { at++; return out; }
      for (;;) { out.push(read(depth+1)); ws(); const sep = text[at++]; if (sep === ']') return out; check(sep === ',', 'INVALID_JSON'); }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
    check(match, 'INVALID_JSON'); at += match[0].length; const value: unknown = JSON.parse(match[0]);
    check(typeof value !== 'number' || finite(value), 'NONFINITE_JSON'); return value;
  };
  const value = read(0); ws(); check(at === text.length, 'INVALID_JSON'); return value;
}
