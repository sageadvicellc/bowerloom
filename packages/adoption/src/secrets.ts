/**
 * Secrets in engine files (definition spec section 8, rule 3). A literal secret value is never copied: adoption replaces
 * it with a `${NAME}` reference, reports the place and the reference (never the value), and marks the entry as needing
 * approval. The test is the contract's own scan (`scanSecrets`), applied to one value at a time.
 */
import { isSafeName, scanSecrets } from '../../harness-definition/src/index.js';
import type { JsonValue } from '../../harness-definition/src/index.js';

/** The scan rule a value breaks under its key, or null when the value is not a secret. */
export function secretRule(key: string, value: JsonValue): string | null {
  const bytes = Buffer.from(JSON.stringify({ [key]: value }));
  return scanSecrets([{ path: 'value.json', bytes }])[0]?.rule ?? null;
}

/** The scan rule a text file breaks, or null. The path decides prose and JSON handling, as in the loader. */
export function textSecretRule(path: string, bytes: Uint8Array): string | null {
  return scanSecrets([{ path, bytes }])[0]?.rule ?? null;
}

/** A reference name: upper case letters, digits, and `_`, starting with a letter, at most 64 characters. */
export function referenceName(...parts: readonly string[]): string {
  const name = parts.join('_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = /^[A-Z]/.test(name) ? name : `SECRET_${name}`;
  return safe.slice(0, 64).replace(/_+$/, '') || 'SECRET';
}

const SCHEME = /^((?:Bearer|Basic|Token)\s+)/i;
const FLAG = /^(--?[A-Za-z][A-Za-z0-9_-]*=)/;

/**
 * A value with its secret replaced, or the value itself. A scheme word (`Bearer `) or a flag (`--token=`) before the
 * secret stays, so the reference keeps the form the engine expects.
 */
export function withoutSecret(key: string, value: string, name: string): { readonly value: string; readonly replaced: boolean } {
  if (secretRule(key, value) === null) return { value, replaced: false };
  const prefix = SCHEME.exec(value)?.[1] ?? FLAG.exec(value)?.[1] ?? '';
  return { value: `${prefix}\${${name}}`, replaced: true };
}

/** One replaced secret: its JSON pointer and the reference that took its place. */
export interface Replaced { readonly pointer: string; readonly reference: string }

/**
 * A JSON tree with every secret leaf replaced by `${NAME}`. Names come from `hint` and the key path. A number under a
 * secret-named key counts as a secret, as in the scan.
 */
export function scrubTree(value: JsonValue, hint: string, pointer = '', key = ''): { readonly value: JsonValue; readonly replaced: readonly Replaced[] } {
  const replaced: Replaced[] = [];
  const walk = (v: JsonValue, at: string, k: string, names: readonly string[]): JsonValue => {
    if (typeof v === 'string' || typeof v === 'number') {
      if (secretRule(k || 'value', v) === null) return v;
      const name = referenceName(hint, ...names);
      replaced.push({ pointer: at || '/', reference: `\${${name}}` });
      return typeof v === 'string' ? withoutSecret(k || 'value', v, name).value : `\${${name}}`;
    }
    if (Array.isArray(v)) {
      const out = v.map((x, i) => walk(x, `${at}/${i}`, k, [...names, String(i)]));
      // A flag and its value in two elements: ["--token", "value"].
      return out.map((x, i) => {
        const prev = out[i - 1];
        if (typeof x === 'string' && typeof prev === 'string' && /^--?[A-Za-z]/.test(prev) && !x.includes('${') && secretRule('args', [prev, x]) !== null && secretRule('args', [prev]) === null) {
          const name = referenceName(hint, ...names, prev.replace(/^-+/, ''));
          replaced.push({ pointer: `${at}/${i}`, reference: `\${${name}}` });
          return `\${${name}}`;
        }
        return x;
      });
    }
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([kk, x], i) => [kk, walk(x, `${at}/${isSafeName(kk) ? kk : `#${i}`}`, kk, [...names, isSafeName(kk) ? kk : 'KEY'])]));
    }
    return v;
  };
  return { value: walk(value, pointer, key, []), replaced };
}

/** True when a name (a key, a server name, a tool name, a pattern) holds a secret shape, read as a key or as text. */
export function secretName(name: string): boolean {
  return scanSecrets([{ path: 'name.json', bytes: Buffer.from(JSON.stringify({ [name]: null })) }]).length > 0 || secretRule('name', name) !== null;
}
