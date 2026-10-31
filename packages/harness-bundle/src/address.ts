/**
 * The address a tool reaches, read the way a client reads it. A summary names the host a `${NAME}` reference goes to, and a person ticks on that name, so it must be
 * the host a client would really use. A text cut at `/` or `:` shows a trusted name for `https://github.com:${TOKEN}@evil.example/`, where the real host is
 * `evil.example` and the value goes in the URL password. So the address is parsed with the WHATWG `URL` (what Node and browsers use) after every `${NAME}` is replaced
 * by a placeholder that no address holds, and the placeholders are put back when the host is shown. Built, not a stub: the tests of stage 1 use it, and lane A calls it.
 */
import { BUNDLE_LIMITS } from './limits.js';

/**
 * What is odd about an address, for the screen to say:
 *  - `credentials`: the address holds a user name or a password (`user:pass@host`);
 *  - `backslash`: the address holds a backslash, which clients read as a slash;
 *  - `scheme`: the scheme is not http, https, ws or wss;
 *  - `unreadable`: the address does not parse, has no host, holds a space or a control character (`URL` silently drops a tab, a CR or a LF, and trims spaces, which
 *    would join two host names), or holds a placeholder that is not one that was placed. The shown host is the fixed text `unreadable address`.
 */
export type AddressFlag = 'credentials' | 'backslash' | 'scheme' | 'unreadable';
export interface AddressRead { readonly host: string; readonly flags: readonly AddressFlag[] }

/** The text shown when no host can be read. */
export const UNREADABLE_ADDRESS = 'unreadable address';
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;
const SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);
const TOKEN = 'qxrefq';

/**
 * The host a client would reach for `url`, as `hostname` plus `:port` when the port is not the scheme's own, with each `${NAME}` shown as written. An IPv6 host
 * keeps its brackets. Never throws. The text is cut to BUNDLE_LIMITS.displayChars.
 */
export function addressOf(url: string): AddressRead {
  const flags: AddressFlag[] = [];
  const unreadable = (): AddressRead => ({ host: UNREADABLE_ADDRESS, flags: [...new Set<AddressFlag>([...flags, 'unreadable'])] });
  if (typeof url !== 'string' || url.length === 0 || url.length > 8192) return unreadable();
  for (let i = 0; i < url.length; i += 1) { const c = url.charCodeAt(i); if (c <= 0x20 || c === 0x7f) return unreadable(); }
  if (url.includes('\\')) flags.push('backslash');
  const names: string[] = [];
  const masked = url.replace(REFERENCE, (_m, name: string) => { names.push(name); return `${TOKEN}${names.length - 1}q`; });
  let parsed: URL;
  try { parsed = new URL(masked); } catch { return unreadable(); }
  // `URL` lowercases the host and decodes percent escapes, so text in the address can turn into a placeholder (`%71xrefq0q`, `QXREFQ0Q`). The placeholders in the
  // parsed address must be exactly the ones placed, once each and in order, compared without regard to case. Otherwise the shown host could name a variable that is not there.
  const found = [...parsed.href.matchAll(new RegExp(`${TOKEN}(\\d+)q`, 'gi'))].map(m => Number(m[1]));
  if (found.length !== names.length || found.some((n, i) => n !== i)) return unreadable();
  if (!SCHEMES.has(parsed.protocol)) flags.push('scheme');
  if (parsed.username !== '' || parsed.password !== '') flags.push('credentials');
  if (parsed.hostname === '') return unreadable();
  const shown = parsed.hostname + (parsed.port === '' ? '' : `:${parsed.port}`);
  const host = shown.replace(new RegExp(`${TOKEN}(\\d+)q`, 'g'), (_m, i: string) => `\${${names[Number(i)] ?? '?'}}`);
  return { host: host.length > BUNDLE_LIMITS.displayChars ? `${host.slice(0, BUNDLE_LIMITS.displayChars)}…` : host, flags };
}
