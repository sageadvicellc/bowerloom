/**
 * What the reader never keeps. A key, a token or a password can sit in a config file, in a command line, in a web address or in the text of a skill. The reader
 * keeps the NAME of a key and never its value; this file is the one place that decides what looks like a secret. Pure: no file, no clock, no random number.
 */

/** A name that points at a secret: an environment variable, a header, a config key. Only the name is kept, whatever this says about the value. */
export const SECRET_NAME = /(key|token|secret|passw|pwd|auth|credential|bearer|cookie|session|private|signature|jwt|cert|dsn)/i;

/** True when a name looks like it points at a secret. */
export function looksSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const PREFIXED = /\b(?:sk-[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9]{20,})/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g;
/** `api_key = "abc123def456"` or `"password": "hunter2hunter2"`: the name stays, the value goes. A reference to another variable (`$X`, `${X}`, `<X>`, `{{X}}`) is not a value. */
const ASSIGNED = /\b([A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|credential)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)(?![$<{%])([^\s"'`,;)}\]]{8,})/gi;
const HIDDEN = '[hidden key]';

/** The text with every secret-looking piece replaced. The rest of the text is not changed. */
export function scrubText(text: string): string {
  return text.replace(PEM, HIDDEN).replace(PREFIXED, HIDDEN).replace(BEARER, (_all, scheme: string) => `${scheme} ${HIDDEN}`).replace(ASSIGNED, (_all, name: string, glue: string) => `${name}${glue}${HIDDEN}`);
}

const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** One line of plain text from anything: control characters, direction marks and zero-width characters go; runs of space become one space. */
export function cleanLine(text: string): string {
  return text.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

/** The text cut to at most `max` characters at a word end, with a mark when something was cut. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max), at = head.lastIndexOf(' ');
  return `${(at > max * 0.5 ? head.slice(0, at) : head).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * The name of the program a command line starts: no folder, no arguments (an argument can hold a key), and nothing at all when the line starts with a
 * variable assignment (`API_KEY=abc node x.js`), because then the first word is not a program.
 */
export function commandName(command: string): string {
  const first = cleanLine(command).split(' ')[0] ?? '';
  if (first === '' || first.includes('=')) return '';
  const name = first.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? '';
  return name.length > 60 ? name.slice(0, 60) : name;
}

/** The host of a web address and nothing else: no user name, no password, no path, no query. Empty when the text is not an address. */
export function hostOf(address: string): string {
  try {
    const url = new URL(address.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:' ? url.hostname : '';
  } catch { return ''; }
}

/** The sorted, de-duplicated names of the keys of an object. A name that is not plain text, or is very long, is left out. */
export function keyNames(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return [...new Set(Object.keys(value).map(cleanLine).filter(k => k !== '' && k.length <= 80))].sort();
}
