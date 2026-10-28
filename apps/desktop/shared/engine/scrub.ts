/**
 * Text from a plan, made safe to show. The window shows commands and code in full, so nothing is cut and nothing is hidden: a character that would hide or
 * reorder text (a control character, a direction mark, a zero-width character) is written out as a visible mark such as `[U+202E]`, so a person reads what
 * the file really holds. Absolute paths of the person's folders become `~` for the home folder and the folder's label for the project.
 */

/** Characters that would hide or reorder text on a screen. Tab and line feed stay: code needs them. */
const HIDDEN_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁦-⁯ㅤ︀-️﻿ﾠ￹-￻]/g;

const mark = (ch: string): string => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`;

/** The text with every hiding character written out as a visible mark. */
export function visible(text: string): string {
  return text.replace(HIDDEN_CHARS, mark);
}

/** True when the text holds a character that `visible` writes out. */
export function hasHidden(text: string): boolean {
  HIDDEN_CHARS.lastIndex = 0;
  const found = HIDDEN_CHARS.test(text);
  HIDDEN_CHARS.lastIndex = 0;
  return found;
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
