/**
 * Reads the front matter of a file (the lines between the two `---` lines at its top) as plain data, for the file view and the details column.
 * The text of a file is the person's own and is only ever drawn as plain text. Nothing here builds markup.
 */

export interface FrontMatter {
  /** The `key: value` lines, in order. A line that is not of that shape is left out. */
  readonly fields: readonly { readonly key: string; readonly value: string }[];
  /** The text after the closing line, with the blank line that follows it taken off. */
  readonly body: string;
  /** True when the file starts with a front matter block that closes. */
  readonly found: boolean;
}

export function parseFrontMatter(text: string): FrontMatter {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { fields: [], body: text, found: false };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return { fields: [], body: text, found: false };
  const fields: { key: string; value: string }[] = [];
  for (const line of lines.slice(1, end)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    fields.push({ key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
  }
  const rest = lines.slice(end + 1);
  if (rest[0]?.trim() === '') rest.shift();
  return { fields, body: rest.join('\n'), found: true };
}

/** The name of a front matter key as a label: `model` becomes "Model". */
export const fieldLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/** The first lines of a file for the details column: the front matter with only its first three fields. A file with no front matter gives its first five lines. */
export function excerptOf(text: string, fields = 3): string {
  const parsed = parseFrontMatter(text);
  if (!parsed.found) return text.split('\n').slice(0, 5).join('\n');
  return ['---', ...parsed.fields.slice(0, fields).map(f => `${f.key}: ${f.value}`), '---'].join('\n');
}

/** The file name of a path: `agents/researcher.md` becomes `researcher.md`. */
export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** A value as the file view's left column shows it. A list of skill names (`summarize-sources, check-facts`) reads as words ("Summarize sources, Check facts"). */
export function fieldValue(key: string, value: string): string {
  if (key !== 'skills') return value;
  return value.split(',').map(item => { const words = item.trim().replace(/-/g, ' '); return words.charAt(0).toUpperCase() + words.slice(1); }).filter(item => item !== '').join(', ');
}
