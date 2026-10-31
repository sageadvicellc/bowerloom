/**
 * The names client material must not hold, checked without spelling them out. This repository is public, so the list holds only the sha256 of each
 * lowercased name: one word, or two words joined by one space.
 */
import { createHash } from 'node:crypto';

export const CLIENT_NAME_HASHES: ReadonlySet<string> = new Set([
  '3b9c2144ccfa84fcb90406914c128f88f7bd23cd42161c591ec6fb9258e8d8a2',
  'fc55bb3bd07c9275be787ec3bca0a0d0e8408378b45c07666b3543735138e8cb',
]);

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The word positions of the text where a listed name starts, a word or a pair of words in a row. Empty when the text names none. */
export function clientNames(text: string, hashes: ReadonlySet<string> = CLIENT_NAME_HASHES): number[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (hashes.has(sha256(words[i]!))) out.push(i);
    if (i + 1 < words.length && hashes.has(sha256(`${words[i]} ${words[i + 1]}`))) out.push(i);
  }
  return out;
}
