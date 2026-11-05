/**
 * One case and Unicode fold for file names, shared by every place that must decide whether two names are one file on a case-insensitive or normalizing volume
 * (APFS, NTFS, exFAT): the bundle path grammar (`packages/harness-bundle`) and the save (`packages/adoption/src/save.ts`).
 *
 * A fold that only lowers case and normalizes with NFC misses pairs that APFS treats as one name: `straße` and `strasse`, a final sigma and a sigma (`ας`, `ασ`), the
 * Cyrillic rounded letters U+1C80 to U+1C88 against `в д о с т ъ ѣ ꙋ`, and others (a review found 458 such pairs among 758,484 variants). This fold lowers, uppers,
 * lowers and uppers again, and normalizes with the compatibility forms, which leaves none of them apart; the second pass is for the capital sharp s (U+1E9E).
 */
export function foldName(name: string): string {
  return name.normalize('NFKD').toUpperCase().toLowerCase().toUpperCase().toLowerCase().normalize('NFKD');
}
