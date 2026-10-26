/**
 * The text budget of the Bowerloom 0.8 home screens, as a pure check on rendered markup (React's `renderToStaticMarkup` output).
 * A label has at most 5 words and a hint at most 12. A heading or a button has at most 5 words, whatever sits inside it. Text inside an element marked
 * `data-budget="popover"` (the text behind a "?" button) may run to 25 words, and only there may it say "MCP". Text inside `data-budget="paragraph"` (a short paragraph of the "How it will work" sheet) may run to 25 words too, and keeps every banned word. Text inside an element marked
 * `data-budget="content"` is the person's own content (the full text of a skill, shown read only): it has no word limit, because it is not our wording, and it
 * keeps the banned list, because the sample content is ours to write. The `title` of an element marked `data-budget="tooltip"` (the hover text of a clipped job line) may run to 12 words, like a hint; every other title has 5. The banned words never appear.
 * Every screen test of the home app calls `assertTextBudget` on what it renders. No DOM, no clock, no file.
 */

/**
 * The words and phrases that must never reach a screen, in lower case. A plural ("teams", "harnesses") counts too.
 * "undo" left the list on 2026-10-25: Hanna chose it for the note after Remove, for the Undo beside each change, and for "Undo all changes".
 */
export const BANNED: readonly string[] = Object.freeze([
  'harness', 'global', 'project', 'scope', 'slice', 'version', 'apply', 'scan', 'adopt', 'conflict', 'interface', 'export', 'import',
  'access class', 'helper', 'team', 'plan', 'grant', 'wire', 'ghost', 'lasso', 'mcp', 'token',
]);

/** The one banned word a "?" popover may use, because it is where the term is explained. */
export const POPOVER_OK: readonly string[] = Object.freeze(['mcp']);

/**
 * A phrase that holds a banned word and is still the right screen word. It is taken out before the check.
 * "Version history" is Hanna's own name for the list of earlier copies (2026-10-25): the exact phrase passes, the single word "history" is not banned, and
 * "version" alone (or "versions") stays banned. "Decided in the plan" is the source line of the "How it will work" sheet (Wave E): it says where a statement comes from,
 * and "plan" alone stays banned.
 */
export const ALLOWED_PHRASES: readonly string[] = Object.freeze(['this project only', 'version history', 'decided in the plan']);

/** Limits, in words. */
export const LIMITS = Object.freeze({ label: 5, hint: 12, popover: 25, paragraph: 25 });

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternOf = (words: readonly string[]): RegExp => new RegExp(`\\b(?:${words.map(w => escapeRegex(w).replace(/ /g, '\\s+')).join('|')})(?:e?s)?\\b`, 'i');

/** Matches any banned word as a whole word (a longer word such as "planet" is fine). Not global, so `test` has no memory. */
export const BANNED_PATTERN: RegExp = patternOf(BANNED);
const BANNED_PATTERN_POPOVER: RegExp = patternOf(BANNED.filter(w => !POPOVER_OK.includes(w)));
const ALLOWED_PATTERN: RegExp = new RegExp(ALLOWED_PHRASES.map(p => escapeRegex(p).replace(/ /g, '\\s+')).join('|'), 'gi');

/** The banned word in `text`, or null. `popover` lets the words in `POPOVER_OK` through. */
export function bannedIn(text: string, popover = false): string | null {
  const m = (popover ? BANNED_PATTERN_POPOVER : BANNED_PATTERN).exec(text.replace(ALLOWED_PATTERN, ' '));
  return m === null ? null : m[0];
}

/** How many words `text` holds. A bare dot or dash is not a word. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

/** One piece of text found in markup. `kind` is `text` for a text node and `label` for an attribute that a person can hear (aria-label, title, alt, placeholder). */
export interface TextPiece {
  readonly text: string; readonly kind: 'text' | 'label'; readonly popover: boolean;
  /** True inside `data-budget="content"`: no word limit. */
  readonly content: boolean;
  /** True inside `data-budget="paragraph"`: a short paragraph of plain words (at most 25 words), the one place besides a popover that may run past a hint. It keeps the banned list, "MCP" included. */
  readonly paragraph?: boolean;
  /** True for the `title` of an element marked `data-budget="tooltip"`: a hover tooltip that repeats a hint a tile clips, so it may run as long as a hint (12 words). */
  readonly tooltip?: boolean;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SKIP = new Set(['script', 'style']);
const BOXES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button']);
const LABEL_ATTRS = ['aria-label', 'title', 'alt', 'placeholder'];
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (all, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
    return ENTITIES[(name ?? '').toLowerCase()] ?? all;
  });
}
const tidy = (text: string): string => decode(text).replace(/\s+/g, ' ').trim();

interface Frame { readonly name: string; readonly popover: boolean; readonly content: boolean; readonly paragraph: boolean; readonly skip: boolean; text: string }
interface Walk { readonly pieces: TextPiece[]; readonly boxes: { name: string; text: string; popover: boolean; content: boolean }[] }

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|</g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function walk(markup: string): Walk {
  const out: Walk = { pieces: [], boxes: [] };
  const stack: Frame[] = [];
  let run = '';
  const flush = (): void => {
    const text = tidy(run); run = '';
    if (text === '') return;
    const top = stack[stack.length - 1];
    if (top !== undefined && stack.some(f => f.skip)) return;
    out.pieces.push({ text, kind: 'text', popover: top?.popover ?? false, content: top?.content ?? false, ...(top?.paragraph === true ? { paragraph: true } : {}) });
  };
  for (const m of markup.matchAll(TOKEN)) {
    const [whole, closing, rawName, rawAttrs, text] = m;
    if (whole.startsWith('<!--')) continue;
    if (text !== undefined) {
      run += text;
      for (const f of stack) f.text += ` ${text}`;
      continue;
    }
    if (rawName === undefined) { run += whole; continue; }
    flush();
    const name = rawName.toLowerCase();
    if (closing === '/') {
      let at = stack.length - 1;
      while (at >= 0 && stack[at]!.name !== name) at -= 1;
      if (at < 0) continue;
      for (let i = stack.length - 1; i >= at; i -= 1) {
        const frame = stack.pop()!;
        if (BOXES.has(frame.name)) out.boxes.push({ name: frame.name, text: tidy(frame.text), popover: frame.popover, content: frame.content });
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (rawAttrs ?? '').matchAll(ATTR)) attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const popover = (stack[stack.length - 1]?.popover ?? false) || attrs['data-budget'] === 'popover';
    const paragraph = (stack[stack.length - 1]?.paragraph ?? false) || attrs['data-budget'] === 'paragraph';
    const content = (stack[stack.length - 1]?.content ?? false) || attrs['data-budget'] === 'content';
    for (const key of LABEL_ATTRS) {
      const value = attrs[key];
      if (value !== undefined && tidy(value) !== '' && name !== 'svg') out.pieces.push({ text: tidy(value), kind: 'label', popover, content: false, ...(key === 'title' && attrs['data-budget'] === 'tooltip' ? { tooltip: true } : {}) });
    }
    if (VOID.has(name) || (rawAttrs ?? '').trimEnd().endsWith('/')) continue;
    stack.push({ name, popover, content, paragraph, skip: SKIP.has(name), text: '' });
  }
  flush();
  return out;
}

/** Every text node and every spoken label of the markup, in order, with whether it sits inside a popover. */
export function extractText(markup: string): TextPiece[] { return walk(markup).pieces; }

const quote = (text: string): string => `"${text.length > 48 ? `${text.slice(0, 45)}...` : text}"`;

/**
 * Checks rendered markup against the budget and answers every problem as one plain sentence. An empty list means the markup is within budget.
 * Text nodes: at most 12 words (25 in a popover, and in a `data-budget="paragraph"`). Headings and buttons, and attribute labels: at most 5 words (25 in a popover).
 * The banned words fail anywhere; "MCP" passes inside a popover. Content (`data-budget="content"`) has no word limit and still has the banned words.
 */
export function assertTextBudget(markup: string): string[] {
  const { pieces, boxes } = walk(markup);
  const problems: string[] = [];
  for (const p of pieces) {
    const words = countWords(p.text), limit = p.kind === 'label' ? (p.popover ? LIMITS.popover : p.tooltip === true ? LIMITS.hint : LIMITS.label) : (p.popover ? LIMITS.popover : p.paragraph === true ? LIMITS.paragraph : LIMITS.hint);
    if (words > limit && !p.content) problems.push(`${p.kind === 'label' ? 'Label' : 'Text'} ${quote(p.text)} has ${words} words, and the limit is ${limit}.`);
    const banned = bannedIn(p.text, p.popover);
    if (banned !== null) problems.push(`The word "${banned}" is banned, in ${quote(p.text)}.`);
  }
  for (const b of boxes) {
    const words = countWords(b.text), limit = b.popover ? LIMITS.popover : LIMITS.label;
    if (words > limit && !b.content) problems.push(`The ${b.name === 'button' ? 'button' : 'heading'} ${quote(b.text)} has ${words} words, and the limit is ${limit}.`);
  }
  return problems;
}
