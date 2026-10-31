/**
 * The text of a library item, the way a file holds it: a short header of `name: value` lines between two lines of dashes, then the body. The header says what the
 * item does, who made it, which release it is, what a tool reaches and how far it can go. An item that came from the web carries all of it, so it describes
 * itself and a copy of it can be made without a side table. The body is the lines a person reads under "Show the full text".
 * Pure: no React, no DOM, no clock, no random number.
 */

/** The header fields of a library item's text. All are optional. */
export interface TextFields {
  readonly description?: string;
  readonly author?: string;
  readonly release?: string;
  readonly reach?: string;
  readonly access?: 'read-only' | 'read-write';
}

const FIELD_ORDER = ['description', 'author', 'release', 'reach', 'access'] as const;
const HEADER = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** A text with a header and a body. A field that is empty or absent is left out; a value never holds a line break. */
export function makeText(fields: TextFields, lines: readonly string[]): string {
  const head = FIELD_ORDER.flatMap(key => {
    const value = fields[key];
    return value === undefined || value.trim() === '' ? [] : [`${key}: ${value.replace(/\s+/g, ' ').trim()}`];
  });
  return `${head.length === 0 ? '' : `---\n${head.join('\n')}\n---\n\n`}${lines.join('\n')}\n`;
}

/** The header fields of a text. A text without a header, or a line that is not `name: value`, gives nothing for that field. */
export function fieldsOf(text: string): TextFields {
  const match = HEADER.exec(text);
  if (match === null) return {};
  const found: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase(), value = line.slice(at + 1).trim();
    if (value !== '' && (FIELD_ORDER as readonly string[]).includes(key) && found[key] === undefined) found[key] = value;
  }
  const access = found.access === 'read-only' || found.access === 'read-write' ? found.access : undefined;
  return {
    ...(found.description === undefined ? {} : { description: found.description }),
    ...(found.author === undefined ? {} : { author: found.author }),
    ...(found.release === undefined ? {} : { release: found.release }),
    ...(found.reach === undefined ? {} : { reach: found.reach }),
    ...(access === undefined ? {} : { access }),
  };
}

/** The body of a text as lines, without its header and without blank lines. */
export function bodyOf(text: string): string[] {
  return text.replace(HEADER, '').split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
}
