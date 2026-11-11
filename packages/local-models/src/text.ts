/** Small helpers for text that comes from a server and is shown to a person. */

/** The text shown for any name or build is cut at this many characters. */
export const SHOWN_MAX = 120;

/** Control characters, format characters, invisible and look-alike spaces: replaced with a question mark, as the extension loader does. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}឴឵￼\u{1d173}-\u{1d17a}  - ⠀]/gu;

/** Replaces unsafe characters and cuts the text at SHOWN_MAX characters, with an ellipsis. */
export function clean(text: string): string {
  const chars = [...text.replace(UNSAFE, '?')];
  return chars.length > SHOWN_MAX ? `${chars.slice(0, SHOWN_MAX).join('')}…` : chars.join('');
}

/** The last part of a path written with / or \. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '');
  return parts.length === 0 ? '' : (parts[parts.length - 1] as string);
}

/** An absolute path, a home path or a Windows path: it can hold a user name, so only its base name is shown. */
export const isAbsolute = (text: string): boolean => text.startsWith('/') || text.startsWith('~') || text.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(text);
