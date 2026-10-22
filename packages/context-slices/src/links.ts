/**
 * Links in markdown text (spec 05, section 3.5 step 6). `extractLinks` finds `[[target]]`, `[[target|alias]]`,
 * `[[target#heading]]`, `![[target]]` and `[text](relative/path.md#anchor)` outside fenced code blocks and inline code
 * spans, in the order they appear. It returns the raw target; resolving it is the caller's job. Pure.
 */
export interface RawLink { kind: 'wikilink' | 'markdown'; target: string }
export const LINKS_PER_FILE = 512;

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** Replaces fenced code blocks with blank lines. An unclosed fence runs to the end. */
export function withoutFences(text: string): string {
  const out: string[] = []; let fence: { char: string; length: number } | null = null;
  for (const line of text.split('\n')) {
    if (fence === null) {
      const m = OPEN_FENCE.exec(line);
      if (m !== null && !(m[1]![0] === '`' && line.slice(m[0].length).includes('`'))) { fence = { char: m[1]![0]!, length: m[1]!.length }; out.push(''); }
      else out.push(line);
    } else {
      const close = new RegExp(`^ {0,3}\\${fence.char}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      out.push('');
    }
  }
  return out.join('\n');
}
/** Replaces inline code spans, a run of backticks to the next run of the same length, with spaces. */
export function withoutSpans(text: string): string {
  let out = '', i = 0;
  while (i < text.length) {
    if (text[i] !== '`') { out += text[i]; i++; continue; }
    let n = 0; while (text[i + n] === '`') n++;
    let j = i + n, found = -1;
    while (j < text.length) {
      if (text[j] !== '`') { j++; continue; }
      let m = 0; while (text[j + m] === '`') m++;
      if (m === n) { found = j; break; }
      j += m;
    }
    if (found < 0) { out += text.slice(i, i + n); i += n; continue; }
    out += ' '.repeat(found + n - i); i = found + n;
  }
  return out;
}

const WIKI = /!?\[\[([^\[\]\n]+)\]\]/g;
const MARKDOWN = /\[[^\[\]\n]*\]\((?:<([^<>\n]+)>|([^()\s<>]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;

/** The links of a text, and whether more than LINKS_PER_FILE were found, so the rest were not followed. */
export function scanLinks(text: string): { links: RawLink[]; truncated: boolean } {
  const clean = withoutSpans(withoutFences(text)), found: { at: number; link: RawLink }[] = [];
  for (const m of clean.matchAll(WIKI)) {
    let target = m[1]!; const bar = target.indexOf('|'); if (bar >= 0) target = target.slice(0, bar);
    const hash = target.indexOf('#'); if (hash >= 0) target = target.slice(0, hash);
    target = target.trim(); if (target !== '') found.push({ at: m.index!, link: { kind: 'wikilink', target } });
  }
  for (const m of clean.matchAll(MARKDOWN)) {
    // A wikilink also contains a bracket pair, but it is never followed by a parenthesis group, so no overlap exists.
    found.push({ at: m.index!, link: { kind: 'markdown', target: (m[1] ?? m[2])! } });
  }
  found.sort((a, b) => a.at - b.at);
  return { links: found.slice(0, LINKS_PER_FILE).map(f => f.link), truncated: found.length > LINKS_PER_FILE };
}
export function extractLinks(text: string): RawLink[] { return scanLinks(text).links; }
