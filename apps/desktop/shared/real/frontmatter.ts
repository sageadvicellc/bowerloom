/**
 * The front matter of a markdown file (the block between two `---` lines at the top), the first sentence of a text, and JSON with comments.
 * A block that cannot be understood is not an error: the file is still listed, `state` says `bad`, and whatever top-level `key: value` lines could be read are kept.
 * Pure: no file, no clock.
 */
import { parseYaml } from './yaml.js';
import type { YamlMap } from './yaml.js';
import { cleanLine, cut } from './redact.js';

export interface Front {
  readonly data: YamlMap;
  /** The text after the block, or the whole text when there is no block. */
  readonly body: string;
  /** `none`: no block. `ok`: read. `bad`: a block that could not be understood (only simple lines were kept). */
  readonly state: 'none' | 'ok' | 'bad';
}

const OPEN = /^﻿?---[ \t]*\r?\n/;

export function parseFrontmatter(text: string): Front {
  const open = text.match(OPEN);
  if (open === null) return { data: {}, body: text.replace(/^﻿/, ''), state: 'none' };
  const rest = text.slice(open[0].length);
  const close = rest.match(/(^|\r?\n)---[ \t]*(\r?\n|$)/);
  if (close === null || close.index === undefined) return { data: lenient(rest.split(/\r?\n/).slice(0, 40).join('\n')), body: text.replace(/^﻿/, ''), state: 'bad' };
  const block = rest.slice(0, close.index), body = rest.slice(close.index + close[0].length);
  try { return { data: parseYaml(block), body, state: 'ok' }; } catch { return { data: lenient(block), body, state: 'bad' }; }
}

/** The simple `key: value` lines at the left edge of a block that would not parse as a whole. */
function lenient(block: string): YamlMap {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):[ \t]+(.+)$/);
    if (m === null || m[1] === '__proto__') continue;
    out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** The first sentence of a text's first paragraph, skipping headings, lists markers, code fences and comments. Empty when there is none. */
export function firstSentence(body: string, max = 200): string {
  let inFence = false;
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) { inFence = !inFence; continue; }
    if (inFence || line === '' || line.startsWith('#') || line.startsWith('<!--') || line.startsWith('---') || line.startsWith('|') || /^[-*_=]{3,}$/.test(line)) continue;
    const plain = cleanLine(line.replace(/^[-*+>\d.)\s]+/, '').replace(/[*_`]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    if (plain === '') continue;
    const end = plain.search(/[.!?](\s|$)/);
    return cut(end > 0 ? plain.slice(0, end + 1) : plain, max);
  }
  return '';
}

/** The text of the first heading of a markdown body, or ''. */
export function firstHeading(body: string): string {
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n').slice(0, 60)) {
    const m = raw.match(/^#{1,3}\s+(.+?)\s*#*$/);
    if (m !== null) return cleanLine(m[1]!.replace(/[*_`]+/g, ''));
  }
  return '';
}

/** JSON that may hold comments and trailing commas (OpenCode's `opencode.jsonc`). Throws a SyntaxError for text that is still not JSON after that. */
export function parseJsonLoose(text: string): unknown {
  let out = '', i = 0;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; }
    else if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; }
    else { out += c; i += 1; }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
