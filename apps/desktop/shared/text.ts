/**
 * Text that is safe to show: hidden and control characters become visible `\uXXXX` escapes, as the command line's
 * `oneLine` does. Joiners (zero-width non-joiner and joiner) stay, because some scripts need them.
 */
const JOINERS = `${String.fromCharCode(0x200c)}${String.fromCharCode(0x200d)}`;
const HIDDEN = new RegExp(`[\\p{Cc}\\p{Zl}\\p{Zp}]|(?![${JOINERS}])\\p{Cf}`, 'gu');
const HIDDEN_KEEP_LINES = new RegExp(`[\\p{Cc}\\p{Zl}\\p{Zp}]|(?![${JOINERS}])\\p{Cf}`, 'gu');
const escape = (c: string): string => Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');

/** One line: every control and invisible character is shown as an escape. */
export function safeLine(value: string): string { return value.replace(HIDDEN, escape); }

/** Many lines: new lines and tabs stay; every other control and invisible character is shown as an escape. */
export function safeText(value: string): string {
  return value.replace(HIDDEN_KEEP_LINES, c => (c === '\n' || c === '\t' || c === '\r' ? c : escape(c)));
}
