/** The colour and letters of an agent's round avatar. Pure: the same name always gives the same answer. */

/** The avatar colours are the app's eight graph tokens (--graph-1 to --graph-8), which are each seen against a card at 3 to 1 in both looks. */
export const AVATAR_SLOTS = 8;

const words = (name: string): string[] => name.split(/[\s_-]+/).filter(w => w !== '');

/** Which of the eight colours (1 to 8) a name gets. Case and spacing do not matter. */
export function avatarSlot(name: string): number {
  const key = words(name).join(' ').toLowerCase();
  let hash = 2166136261;
  for (const ch of key) { hash ^= ch.codePointAt(0)!; hash = Math.imul(hash, 16777619) >>> 0; }
  return (hash >>> 0) % AVATAR_SLOTS + 1;
}

/** The first letter of up to two words, in capitals. An empty name has none (the avatar then shows a person). */
export function initialsOf(name: string): string {
  return words(name).slice(0, 2).map(w => Array.from(w)[0]!.toLocaleUpperCase()).join('');
}
