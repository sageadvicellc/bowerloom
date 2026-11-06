/**
 * Characters that one-line text and a shown message never hold (rulings T6 and V5): control characters (C0, DEL, C1),
 * format characters (Cf), surrogates, private-use characters, the line and paragraph separators U+2028 and U+2029,
 * and the variation selectors U+FE00 to U+FE0F and U+E0100 to U+E01EF.
 */
export const BAD_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}︀-️\u{E0100}-\u{E01EF}]/u;
export const BAD_TEXT_ALL = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}︀-️\u{E0100}-\u{E01EF}]/gu;
