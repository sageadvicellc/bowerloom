/**
 * Frontmatter of a markdown file or an agent file (spec 01a, section 4.1). The block is the lines between a first
 * `---` line and the next `---` line. Pure.
 */
const FENCE = /^---[ \t]*$/;

export interface Frontmatter {
  /** The opening fence line, without its line break. */
  head: string;
  /** The lines between the fences, joined with line breaks; no trailing line break. */
  block: string;
  /** Everything from the closing fence line to the end of the text, unchanged. */
  tail: string;
  /** The text after the closing fence line. */
  rest: string;
}

/** Splits at the fences, or returns null when the text has no opening fence on its first line or no closing fence. */
export function splitFrontmatter(text: string): Frontmatter | null {
  if (!FENCE.test(text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n')))) return null;
  const lines = text.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (end < 0) return null;
  const closing = lines.slice(end);
  return { head: lines[0]!, block: lines.slice(1, end).join('\n'), tail: closing.join('\n'), rest: lines.slice(end + 1).join('\n') };
}
