/**
 * What the reader never keeps. A key, a token or a password can sit in a config file, in a command line, in a web address or in the text of a skill. The reader
 * keeps the NAME of a key and never its value; this file is the one place that decides what looks like a secret. Pure: no file, no clock, no random number.
 *
 * Every pattern here runs in time linear in the text. The rules that made the old version slow were a greedy class in front of a keyword (every start position
 * scanned to the end of a long run and backed up) and a greedy run that failed late (`eyJ-eyJ-...` scanned the whole rest of the text for each `eyJ`). Here a keyword is
 * found first and only then looked past by a bounded amount; a run is measured once (`runEnds`), and a long text is cut into chunks at line ends first.
 */

/** A name that points at a secret: an environment variable, a header, a config key. Only the name is kept, whatever this says about the value. */
export const SECRET_NAME = /(key|token|secret|passw|pwd|auth|credential|bearer|cookie|session|private|signature|jwt|cert|dsn)/i;

/** True when a name looks like it points at a secret. */
export function looksSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** What stands in the place of a hidden value. */
export const HIDDEN = '[hidden key]';

/** The most text one scrub pass looks at. A longer text is scrubbed in pieces, each cut at a line end (or a space) so that a value is not split. */
export const SCRUB_CHUNK = 64 * 1024;
const BREAK_WINDOW = 4096;

const isSpaceCode = (c: number): boolean => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0xfeff;
const isTokenCode = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;

/** For each index, where the run of token characters (`[A-Za-z0-9_-]`) that starts there ends. One backward pass; every later question is a lookup. */
function runEnds(text: string): Uint32Array {
  const ends = new Uint32Array(text.length + 1);
  ends[text.length] = text.length;
  for (let i = text.length - 1; i >= 0; i -= 1) ends[i] = isTokenCode(text.charCodeAt(i)) ? ends[i + 1]! : i;
  return ends;
}

// ---------------------------------------------------------------------------------------------------------------------- the passes

const PEM = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g;

/** `scheme://user:password@host`: the login goes. A login without a colon (`git@host`) is a name, not a secret, and stays. */
const URL_LOGIN = /:\/\/([^\s/@"'`<>]{1,128})@/g;
const hideUrlLogins = (text: string): string => text.replace(URL_LOGIN, (all, login: string) => (login.includes(':') ? `://${HIDDEN}@` : all));

/** The address of a chat webhook is a password: whoever has it can post. */
const WEBHOOK = /(hooks\.slack\.com\/(?:services|workflows|triggers)\/|discord(?:app)?\.com\/api\/webhooks\/)[A-Za-z0-9/_-]{1,200}/g;

const PREFIX_START = /(?<![A-Za-z0-9_])(?:sk-|sk_live_|sk_test_|gh[pousr]_|github_pat_|xox[abprs]-|AKIA|AIza|eyJ|npm_)/g;

/** Tokens that start with a known mark. The length of the run after the mark is looked up, never scanned for again. */
function hidePrefixed(text: string): string {
  let out = '', resume = 0, ends: Uint32Array | null = null;
  for (const m of text.matchAll(PREFIX_START)) {
    const mark = m[0], at = m.index;
    if (at < resume) continue;
    ends ??= runEnds(text);
    const q = at + mark.length, e = ends[q]!;
    let stop = -1;
    if (mark === 'AKIA') { if (/^[0-9A-Z]{16}/.test(text.slice(q, q + 16))) stop = q + 16; }
    else if (mark === 'eyJ') {
      // A JWT: three runs joined by two dots.
      if (e - q >= 8 && text.charCodeAt(e) === 46) {
        const s2 = e + 1, e2 = ends[s2]!;
        if (e2 - s2 >= 8 && text.charCodeAt(e2) === 46) { const s3 = e2 + 1, e3 = ends[s3]!; if (e3 - s3 >= 8) stop = e3; }
      }
    } else {
      const need = mark === 'sk-' ? 12 : mark === 'github_pat_' ? 20 : mark === 'AIza' ? 30 : mark === 'npm_' ? 20 : mark.startsWith('xox') ? 10 : mark.startsWith('sk_') ? 8 : 16;
      if (e - q >= need) stop = e;
    }
    if (stop < 0) continue;
    out += text.slice(resume, at) + HIDDEN; resume = stop;
  }
  return resume === 0 ? text : out + text.slice(resume);
}

// The words that name a secret, in small letters, in capitals and with a first capital. `apiKey` is found at its `Key`, after a small letter. `monkey` and `turkey` are not names of keys.
const SECRET_WORDS = ['api_key', 'api-key', 'apikey', 'access_key', 'access-key', 'accesskey', 'secret_key', 'secret-key', 'secretkey', 'private_key', 'private-key', 'privatekey', 'auth_token', 'auth-token', 'authtoken',
  'password', 'passwd', 'pwd', 'passphrase', 'secret', 'token', 'credentials', 'credential', 'key'];
const capital = (w: string): string => w[0]!.toUpperCase() + w.slice(1);
const longestFirst = (list: readonly string[]): string[] => [...new Set(list)].sort((a, b) => b.length - a.length);
const KEY_START = `(?:(?<![A-Za-z])(?:${longestFirst(SECRET_WORDS.flatMap(w => [w, w.toUpperCase(), capital(w)])).join('|')})|(?<=[a-z])(?:${longestFirst(SECRET_WORDS.map(capital)).join('|')}))`;
/** A name that only points at where a value lives: `bearer_token_env_var`, `key_file`. Its value is a name or a path, not a secret. */
const POINTER_NAME = /[_.-](?:env|env_var|envvar|var|name|file|path|header)$/i;
const NOT_A_SECRET = new Set(['true', 'false', 'null', 'none', 'nil', 'undefined', 'string', 'number', 'required', 'optional']);
// A name, then up to 128 more name characters, then `:` or `=` (with up to 8 spaces round it), then the value: in double quotes or single quotes (up to 256 characters), or up to the next space.
const VALUE = String.raw`(?:"(?<dq>[^"\n]{0,256})"|'(?<sq>[^'\n]{0,256})'|(?<q>["']?)`;
const ASSIGNED = new RegExp(String.raw`(?<pre>(?<name>${KEY_START}[A-Za-z0-9_.-]{0,128})["'` + '`' + String.raw`]?[ \t]{0,8}[:=](?![=~])[ \t]{0,8})` + VALUE + String.raw`(?!\[hidden key\])(?<bare>[^\s"'` + '`' + String.raw`]+))`, 'g');
const AUTH = new RegExp(String.raw`(?<pre>(?<![A-Za-z])(?:[Aa]uthorization|AUTHORIZATION)["'` + '`' + String.raw`]?[ \t]{0,8}[:=][ \t]{0,8}(?![A-Za-z][\w-]{0,23} \[hidden key\]))` + VALUE + String.raw`(?:(?<scheme>[A-Za-z][\w-]{0,23}) (?=[^\s"'` + '`' + String.raw`]))?(?!\[hidden key\])(?<bare>[^\s"'` + '`' + String.raw`]+))`, 'g');

/**
 * A reference to a value kept somewhere else: `$API_KEY`, `${api_key}`, `<YOUR_KEY>`, `{{ secrets.X }}`, `%API_KEY%`. It is not a value, so it stays. A `$` that
 * starts a mixed-case word (`$ecretPass123`) is a value that happens to start with `$`.
 */
export function isReference(raw: string): boolean {
  return /^\$[A-Z_][A-Z0-9_]*$/.test(raw) || /^\$\{[A-Za-z_][\w.:-]{0,63}\}$/.test(raw) || /^<[^<>\s]{1,60}>$/.test(raw) || raw.startsWith('{{') || /^%[A-Za-z_][A-Za-z0-9_]{0,63}%$/.test(raw);
}

/** Whether a value is a value at all: not empty, not just marks, not already hidden, not a reference, not a plain word like `true`. */
function isValue(raw: string, trimmed: string): boolean {
  return trimmed !== '' && /[A-Za-z0-9]/.test(trimmed) && !trimmed.startsWith(HIDDEN) && !isReference(trimmed) && !isReference(raw) && !NOT_A_SECRET.has(trimmed.toLowerCase());
}

/** The value without the marks that close a sentence or a list, and those marks. */
function trimEnd(raw: string): [string, string] {
  let end = raw.length;
  while (end > 0 && /[.,;)\]}>]/.test(raw[end - 1]!)) end -= 1;
  return [raw.slice(0, end), raw.slice(end)];
}

interface Parts { readonly pre: string; readonly name?: string; readonly dq?: string; readonly sq?: string; readonly q?: string; readonly bare?: string; readonly scheme?: string }

/** One match of ASSIGNED or AUTH: the name stays and the value goes, unless the value is a reference or a plain word. */
function hideValue(all: string, g: Parts): string {
  if (g.name !== undefined && POINTER_NAME.test(g.name)) return all;
  if (g.dq !== undefined) return isValue(g.dq, g.dq) ? `${g.pre}"${HIDDEN}"` : all;
  if (g.sq !== undefined) return isValue(g.sq, g.sq) ? `${g.pre}'${HIDDEN}'` : all;
  const raw = g.bare ?? '', [value, tail] = trimEnd(raw);
  return isValue(raw, value) ? `${g.pre}${g.q ?? ''}${g.scheme === undefined ? '' : `${g.scheme} `}${HIDDEN}${tail}` : all;
}

/**
 * `name = value`, `name: "value with spaces"`, `"name": "value"`, `?name=value`, `Authorization: Scheme value`. The name stays; the value goes. A value can start with any
 * character and be any length. The word is found first (at the start of a name), the name is looked past by at most 128 characters, and a quoted value is searched for at
 * most 256, so no part of the text is scanned again and again.
 */
const hideAssigned = (text: string): string => text
  .replace(AUTH, (all, ...rest) => hideValue(all, rest[rest.length - 1] as Parts))
  .replace(ASSIGNED, (all, ...rest) => hideValue(all, rest[rest.length - 1] as Parts));

/** `Bearer abc...` and `Basic abc...` outside a header line. The credential must look like one: a digit or a mark inside, or a long run. */
const BEARER = /\b(Bearer|Basic)[ \t]{1,8}([A-Za-z0-9._~+/=-]{12,})/g;
const hideBearer = (text: string): string => text.replace(BEARER, (all, scheme: string, credential: string) => (/[0-9._~+/=-]/.test(credential) || credential.length >= 20 ? `${scheme} ${HIDDEN}` : all));

/** A long run that is not a word: base64-like (40 or more with capitals, small letters and digits), or letters and digits with no break for 32 or more (hex, base32, tokens). */
const BLOB_MARKED = /[A-Za-z0-9+/=_-]{40,}/g;
const BLOB_PLAIN = /[A-Za-z0-9]{32,}/g;
/** Separators (`-`, `_`, `/`) are rare in base64 (about one in 64) and common in a path or a long hyphenated name, which are not keys. */
const separators = (run: string): number => { let n = 0; for (let i = 0; i < run.length; i += 1) { const c = run.charCodeAt(i); if (c === 45 || c === 95 || c === 47) n += 1; } return n; };
const hideBlobs = (text: string): string => text
  .replace(BLOB_MARKED, run => (/[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run) && separators(run) * 10 <= run.length ? HIDDEN : run))
  .replace(BLOB_PLAIN, run => (/[0-9]/.test(run) && /[A-Za-z]/.test(run) ? HIDDEN : run));

function scrubChunk(text: string): string {
  if (text === '') return text;
  return hideBlobs(hideBearer(hideAssigned(hidePrefixed(hideUrlLogins(text.replace(PEM, HIDDEN).replace(WEBHOOK, `$1${HIDDEN}`))))));
}

/** Where to cut a long text after `from`: the last line end, else the last space, in the window before `end`; else `end` itself (a run with no break for 4 KB is not text). */
function breakPoint(text: string, from: number, end: number): number {
  const low = Math.max(from + 1, end - BREAK_WINDOW);
  for (let i = end; i > low; i -= 1) if (text.charCodeAt(i - 1) === 10) return i;
  for (let i = end; i > low; i -= 1) if (isSpaceCode(text.charCodeAt(i - 1))) return i;
  return end;
}

/**
 * The text with every secret-looking piece replaced: private key blocks, logins in web addresses, webhook addresses, tokens with a known start, JWTs, any
 * `key = value` whatever the value, `Authorization` headers with any scheme, `Bearer` and `Basic` credentials, and long runs that look like keys. The rest of the
 * text is not changed. Time is linear in the length: a long text is scrubbed in chunks of `SCRUB_CHUNK`.
 */
export function scrubText(text: string): string {
  if (text.length <= SCRUB_CHUNK) return scrubChunk(text);
  const parts: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + SCRUB_CHUNK, text.length);
    if (end < text.length) end = breakPoint(text, pos, end);
    parts.push(scrubChunk(text.slice(pos, end)));
    pos = end;
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------------------------------------------------- plain text

const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** One line of plain text from anything: control characters, direction marks and zero-width characters go; runs of space become one space. */
export function cleanLine(text: string): string {
  return text.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

/** A short plain name or label from any text: scrubbed first, then made one line, then cut to `max` characters. Safe to show. */
export function safeText(text: string, max: number): string {
  return cleanLine(scrubText(text.length > 8 * max + 200 ? text.slice(0, 8 * max + 200) : text)).slice(0, max);
}

/** A path with every part made one plain line (a folder or file name can hold control characters or a direction mark) and scrubbed. `/` stays between parts. */
export function cleanPath(path: string): string {
  return path.split('/').map(part => safeText(part, 120)).join('/');
}

/** The text cut to at most `max` characters at a word end, with a mark when something was cut. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max), at = head.lastIndexOf(' ');
  return `${(at > max * 0.5 ? head.slice(0, at) : head).replace(/[\s,;:.-]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------------------------------------------- names that might be values

const KEY_MARKS = /^(?:sk-|sk_|gh[pousr]_|github_pat_|xox[abprs]-|AKIA[0-9A-Z]{8}|AIza|eyJ)/;
const LONGEST_NAME = 40;

/**
 * True when a "name" (an environment variable, a header, a config key) is more likely a pasted value: over 40 characters, a known token mark at the start, anything the
 * scrub would change, six or more digits in a row, or a long mixed-case word with digits and no separator.
 */
export function looksLikeValue(name: string): boolean {
  if (name.length > LONGEST_NAME || KEY_MARKS.test(name) || /\d{6,}/.test(name) || scrubText(name) !== name) return true;
  return name.length >= 16 && !/[_\-. ]/.test(name) && /\d/.test(name) && /[a-z]/.test(name) && /[A-Z]/.test(name);
}

/** The name, or `[hidden key]` when it looks like a value. */
export function keyName(name: string): string {
  const plain = cleanLine(name);
  return looksLikeValue(plain) ? HIDDEN : plain;
}

/**
 * The name of the program a command line starts: no folder, no arguments (an argument can hold a key), and nothing at all when the line starts with a
 * variable assignment (`API_KEY=abc node x.js`), because then the first word is not a program. A word with `@` or `://` in it is an address with a login, not a program.
 */
export function commandName(command: string): string {
  const first = cleanLine(command.length > 2000 ? command.slice(0, 2000) : command).split(' ')[0] ?? '';
  if (first === '' || first.includes('=') || first.includes('@') || first.includes('://')) return '';
  const name = first.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? '';
  if (looksLikeValue(name)) return '';
  return name.length > 60 ? name.slice(0, 60) : name;
}

/** The host of a web address and nothing else: no user name, no password, no path, no query. Empty when the text is not an address. */
export function hostOf(address: string): string {
  try {
    const url = new URL(address.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:' ? url.hostname : '';
  } catch { return ''; }
}

/** The sorted, de-duplicated names of the keys of an object. A name that looks like a value is shown as `[hidden key]`. */
export function keyNames(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return [...new Set(Object.keys(value).map(k => (k.length > 2000 ? HIDDEN : cleanLine(k))).filter(k => k !== '').map(k => (looksLikeValue(k) ? HIDDEN : k)))].sort();
}
