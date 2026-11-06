/**
 * The strict JSON reader of a bundle. The text can be 48 MiB, so the reader in `harness-definition` (1 MiB, quadratic on numbers) does not fit. This one:
 *  - refuses a duplicate key, the key `__proto__`, a comment, a trailing comma, a control character in a string, a bad escape, a lone surrogate, a number that is not
 *    finite, and anything after the one value;
 *  - stops at `maxDepth` levels of nesting (a recursion of that depth is all it ever makes, so nesting cannot overflow the stack) and at `maxNodes` values;
 *  - builds each object with no prototype, so a key such as `constructor` is only a key;
 *  - finds the end of a string with `indexOf`, and checks it with one native scan, so a 40 MiB string costs little;
 *  - takes a turn after each value of a container whenever it has run for a while (see `turn.ts`).
 * It throws `JsonFault` and nothing else for any text. A fault never repeats the text.
 */
import { turnTaker } from './turn.js';
import { isWellFormedText } from './well-formed.js';

export type JsonNode = null | boolean | number | string | JsonNode[] | { [key: string]: JsonNode };
export type JsonFaultKind = 'syntax' | 'depth' | 'nodes';

export class JsonFault extends Error {
  constructor(readonly kind: JsonFaultKind) { super(`The text is not accepted JSON (${kind}).`); this.name = 'JsonFault'; }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const CONTROL = /[\u0000-\u001f]/;
/** The longest key a bundle may hold. The known keys are short; a longer one is refused before it is stored. */
const KEY_CHARS = 200;

export async function parseStrictJson(text: string, limits: { readonly maxDepth: number; readonly maxNodes: number }): Promise<JsonNode> {
  const turn = turnTaker();
  let at = 0, nodes = 0;
  const fail = (kind: JsonFaultKind = 'syntax'): never => { throw new JsonFault(kind); };
  const ws = (): void => {
    for (;;) {
      const c = text.charCodeAt(at);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) at += 1; else return;
    }
  };

  const string = (): string => {
    const start = at;
    let end = at;
    for (;;) {
      end = text.indexOf('"', end + 1);
      if (end === -1) return fail();
      let slashes = 0;
      while (text.charCodeAt(end - 1 - slashes) === 0x5c && end - 1 - slashes > start) slashes += 1;
      if (slashes % 2 === 0) break;
    }
    const raw = text.slice(start, end + 1);
    at = end + 1;
    if (CONTROL.test(raw)) return fail();
    if (!raw.includes('\\')) return raw.slice(1, -1);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return fail(); }
    if (typeof value !== 'string' || !isWellFormedText(value)) return fail();
    return value;
  };

  const value = async (depth: number): Promise<JsonNode> => {
    if (++nodes > limits.maxNodes) return fail('nodes');
    ws();
    const c = text[at];
    if (c === '"') return string();
    if (c === '{') {
      if (depth + 1 > limits.maxDepth) return fail('depth');
      at += 1; ws();
      const out: { [key: string]: JsonNode } = Object.create(null) as { [key: string]: JsonNode };
      if (text[at] === '}') { at += 1; return out; }
      for (;;) {
        ws();
        if (text[at] !== '"') return fail();
        const key = string();
        if (key.length > KEY_CHARS || key === '__proto__' || Object.hasOwn(out, key)) return fail();
        ws();
        if (text[at] !== ':') return fail();
        at += 1;
        out[key] = await value(depth + 1);
        const wait = turn(); if (wait) await wait;
        ws();
        const sep = text[at]; at += 1;
        if (sep === '}') return out;
        if (sep !== ',') return fail();
      }
    }
    if (c === '[') {
      if (depth + 1 > limits.maxDepth) return fail('depth');
      at += 1; ws();
      const out: JsonNode[] = [];
      if (text[at] === ']') { at += 1; return out; }
      for (;;) {
        out.push(await value(depth + 1));
        const wait = turn(); if (wait) await wait;
        ws();
        const sep = text[at]; at += 1;
        if (sep === ']') return out;
        if (sep !== ',') return fail();
      }
    }
    if (text.startsWith('true', at)) { at += 4; return true; }
    if (text.startsWith('false', at)) { at += 5; return false; }
    if (text.startsWith('null', at)) { at += 4; return null; }
    NUMBER.lastIndex = at;
    const m = NUMBER.exec(text);
    if (m === null) return fail();
    at += m[0].length;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : fail();
  };

  const root = await value(0);
  ws();
  if (at !== text.length) return fail();
  return root;
}
