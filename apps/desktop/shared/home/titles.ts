/** The one helper for turning a file-style name into words, kept apart so the card words and the topic words can both use it without importing each other. */

const MAX_NAME_WORDS = 5;

/** A name as words: dashes and underscores become spaces, each word gets a capital, and at most 5 words stay. */
export function itemTitle(name: string): string {
  return name.split(/[\s_-]+/).filter(w => w !== '').slice(0, MAX_NAME_WORDS).map(w => `${w.charAt(0).toUpperCase()}${w.slice(1)}`).join(' ');
}
