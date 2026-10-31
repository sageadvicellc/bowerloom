/**
 * The choices of an import, checked. Notes names come from a bundle, so they are untrusted keys: `constructor` is a valid name, and a plain-object lookup of it
 * reaches the object prototype. This module reads plain input with own-property reads only (`Object.hasOwn`, `Object.keys`), checks every count BEFORE it copies
 * anything, and hands back a Map and a Set. Nothing but a `BundleRefusal` escapes: a getter or a Proxy that throws is `BUNDLE_USAGE` too.
 * Built, not a stub: it depends on nothing else, and the tests of stage 1 use it.
 */
import { BundleRefusal } from './codes.js';
import { BUNDLE_LIMITS } from './limits.js';
import type { ImportChoices } from './types.js';

const bad = (): never => { throw new BundleRefusal('BUNDLE_USAGE'); };
/** An object made by a literal, `JSON.parse` or `Object.create(null)`: its prototype is `Object.prototype` or null. A Date, a class instance, an array and a Map are not. */
const plain = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};
/** A control character (`Cc`, NEL among them), a format character (`Cf`: bidirectional marks, zero-width space, the byte order mark) or a line or paragraph separator. The joiners U+200C and U+200D stay: Persian, Indic and other scripts need them inside ordinary words (as `oneLine` keeps them). */
const TEXT_ODD = new RegExp('\\p{Cc}|(?![' + String.fromCharCode(0x200c, 0x200d) + '])\\p{Cf}|[' + String.fromCharCode(0x2028, 0x2029) + ']', 'u');

/**
 * `raw` is plain input: `{ link?: Record<string, string> | Map<string, string>, leave?: string[] | Set<string> }`, or null or undefined for no choices.
 * `names` are the notes names the bundle lists. Refuses `BUNDLE_USAGE` for: a root that is not a plain object; a key other than `link` and `leave`; a name the
 * bundle does not list; a name in both; a repeated name in `leave`; a link value that is not a non-empty string of at most BUNDLE_LIMITS.pathChars characters
 * without a control (`Cc`), format (`Cf`) or line-separator character; more than BUNDLE_LIMITS.notesNames names in all (counted before anything is copied); a name longer
 * than BUNDLE_LIMITS.nameChars; and any input whose property read throws. The refusal names no value. Names not in `link` or `leave` are left out.
 */
export function importChoicesOf(raw: unknown, names: readonly string[]): ImportChoices {
  try {
    return choicesOf(raw, names);
  } catch (error) {
    throw error instanceof BundleRefusal ? error : new BundleRefusal('BUNDLE_USAGE');
  }
}

function choicesOf(raw: unknown, names: readonly string[]): ImportChoices {
  if (raw === null || raw === undefined) return { link: new Map(), leave: new Set() };
  if (!plain(raw)) return bad();
  if (Object.keys(raw).some(k => k !== 'link' && k !== 'leave')) return bad();
  const known = new Set(names);
  const linkIn: unknown = Object.hasOwn(raw, 'link') ? raw.link : undefined;
  const leaveIn: unknown = Object.hasOwn(raw, 'leave') ? raw.leave : undefined;
  // Sizes first. Nothing is copied until the whole is known to fit.
  const linkSize = linkIn === undefined ? 0 : linkIn instanceof Map ? linkIn.size : plain(linkIn) ? Object.keys(linkIn).length : bad();
  const leaveSize = leaveIn === undefined ? 0 : leaveIn instanceof Set ? leaveIn.size : Array.isArray(leaveIn) ? leaveIn.length : bad();
  if (linkSize + leaveSize > BUNDLE_LIMITS.notesNames) bad();
  const linkEntries: [unknown, unknown][] = linkIn === undefined ? [] : linkIn instanceof Map ? [...linkIn.entries()] : Object.entries(linkIn as Record<string, unknown>);
  const leaveList: unknown[] = leaveIn === undefined ? [] : leaveIn instanceof Set ? [...leaveIn] : [...(leaveIn as unknown[])];
  const link = new Map<string, string>(), leave = new Set<string>();
  for (const [name, value] of linkEntries) {
    if (typeof name !== 'string' || name.length > BUNDLE_LIMITS.nameChars || !known.has(name) || link.has(name)) bad();
    if (typeof value !== 'string' || value === '' || value.length > BUNDLE_LIMITS.pathChars || TEXT_ODD.test(value)) bad();
    link.set(name as string, value as string);
  }
  for (const name of leaveList) {
    if (typeof name !== 'string' || name.length > BUNDLE_LIMITS.nameChars || !known.has(name) || leave.has(name) || link.has(name)) bad();
    leave.add(name as string);
  }
  return { link, leave };
}
