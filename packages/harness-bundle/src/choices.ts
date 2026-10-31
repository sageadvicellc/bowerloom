/**
 * The choices of an import, checked. Notes names come from a bundle, so they are untrusted keys: `constructor` is a valid name, and a plain-object lookup of it
 * reaches the object prototype. This module reads plain input with own-property reads only (`Object.hasOwn`, `Object.entries`), and hands back a Map and a Set.
 * Built, not a stub: it depends on nothing else, and the tests of stage 1 use it.
 */
import { BundleRefusal } from './codes.js';
import { BUNDLE_LIMITS } from './limits.js';
import type { ImportChoices } from './types.js';

const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
const bad = (): never => { throw new BundleRefusal('BUNDLE_USAGE'); };

/**
 * `raw` is plain input: `{ link?: Record<string, string> | Map<string, string>, leave?: string[] | Set<string> }`, or null or undefined for no choices.
 * `names` are the notes names the bundle lists. Refuses `BUNDLE_USAGE` for: a key other than `link` and `leave`; a name the bundle does not list; a name in both;
 * a repeated name in `leave`; a link value that is not a non-empty string of at most BUNDLE_LIMITS.pathChars characters without a control character; more than
 * BUNDLE_LIMITS.notesNames names in all; a name longer than BUNDLE_LIMITS.nameChars. The refusal names no value. Names not in `link` or `leave` are left out.
 */
export function importChoicesOf(raw: unknown, names: readonly string[]): ImportChoices {
  if (raw === null || raw === undefined) return { link: new Map(), leave: new Set() };
  if (!plain(raw)) return bad();
  if (Object.keys(raw).some(k => k !== 'link' && k !== 'leave')) return bad();
  const known = new Set(names);
  const linkIn = Object.hasOwn(raw, 'link') ? raw.link : undefined;
  const leaveIn = Object.hasOwn(raw, 'leave') ? raw.leave : undefined;
  const linkEntries: [unknown, unknown][] = linkIn === undefined ? [] : linkIn instanceof Map ? [...linkIn.entries()] : plain(linkIn) ? Object.entries(linkIn) : bad();
  const leaveList: unknown[] = leaveIn === undefined ? [] : leaveIn instanceof Set ? [...leaveIn] : Array.isArray(leaveIn) ? [...leaveIn] : bad();
  if (linkEntries.length + leaveList.length > BUNDLE_LIMITS.notesNames) bad();
  const link = new Map<string, string>(), leave = new Set<string>();
  for (const [name, value] of linkEntries) {
    if (typeof name !== 'string' || name.length > BUNDLE_LIMITS.nameChars || !known.has(name) || link.has(name)) bad();
    if (typeof value !== 'string' || value === '' || value.length > BUNDLE_LIMITS.pathChars || /[\u0000-\u001f\u007f]/.test(value)) bad();
    link.set(name as string, value as string);
  }
  for (const name of leaveList) {
    if (typeof name !== 'string' || name.length > BUNDLE_LIMITS.nameChars || !known.has(name) || leave.has(name) || link.has(name)) bad();
    leave.add(name as string);
  }
  return { link, leave };
}
