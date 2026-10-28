/**
 * Text from a plan, made safe to show. The window shows commands and code in full, so nothing is cut and nothing is hidden: a character that would hide or
 * reorder text (a control character, a direction mark, a zero-width character) is written out as a visible mark such as `[U+202E]`, so a person reads what
 * the file really holds. Absolute paths of the person's folders become `~` for the home folder and the folder's label for the project.
 */

/**
 * Characters that would hide, fake or reorder text on a screen (U17): controls, direction marks, zero-width and joining marks, the combining grapheme joiner,
 * Hangul fillers, Mongolian variation selectors, the braille blank, line and paragraph separators, every space that is not a plain space, the variation
 * selectors and their supplement, and the tag characters. Tab and line feed stay: code needs them. The `u` flag reads astral characters as one.
 */
const HIDDEN_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u2800\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

const mark = (ch: string): string => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`;

/** The scripts a word may mix to fake another word. A word with letters of two of them is marked. */
const SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Greek', /\p{Script=Greek}/u], ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u], ['Cherokee', /\p{Script=Cherokee}/u], ['Hebrew', /\p{Script=Hebrew}/u], ['Arabic', /\p{Script=Arabic}/u],
];
const WORD = /[\p{L}\p{M}\p{N}_-]+/gu;
const scriptsOf = (word: string): string[] => SCRIPTS.filter(([, re]) => [...word].some(ch => re.test(ch))).map(([name]) => name);

/** The text with every hiding character written out as a visible mark, and each word that mixes scripts marked before it. */
export function visible(text: string): string {
  return text.replace(HIDDEN_CHARS, mark).replace(WORD, word => {
    const scripts = scriptsOf(word);
    return scripts.length > 1 ? `[mixed scripts: ${scripts.join('+')}]${word}` : word;
  });
}

/** True when the text holds a character that `visible` writes out, or a word that mixes scripts. */
export function hasHidden(text: string): boolean {
  return visible(text) !== text;
}

export interface Scrub {
  /** Any text: hiding characters made visible, the person's absolute paths replaced. */
  (text: string): string;
}

/**
 * A scrubber for one folder. `places` maps an absolute path to the words that replace it, longest first, so the project folder wins over the home folder
 * that holds it. A path is replaced only where it ends at a separator or the end of a word, so `/Users/a` never eats `/Users/ab`.
 */
export function makeScrub(places: readonly { readonly path: string; readonly as: string }[]): Scrub {
  const list = places.filter(p => p.path.length > 1).sort((a, b) => b.path.length - a.path.length);
  return (text: string): string => {
    let out = visible(text);
    for (const { path, as } of list) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`${escaped}(?=$|[/\\s,;:)'"\`]|\\.(?:\\s|$))`, 'g'), as);
    }
    return out;
  };
}

/** The label of a folder: `~` for the home folder and below it, else the path as it is. */
export function labelOf(path: string, home: string): string {
  if (home.length > 1 && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}
