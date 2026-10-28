/**
 * The secret scan (section 8, rule 3; section 12, check 3). A definition holds no secret value: a secret is a reference
 * to a variable name, `${NAME}`, or a keychain entry, `{ "keychain": "<entry>" }`.
 *
 * The scan is linear. A line is split into tokens on spaces, quotes, and punctuation, and every pattern is anchored at
 * the start of a token or a piece of one, so no pattern backtracks across a line. A text line over 4096 characters is
 * not scanned: it is a `line-too-long` finding, and the loader refuses it.
 *
 * Rules:
 * - Shapes: well-known credential forms (cloud keys, chat and forge tokens, JWTs, webhook URLs, passwords in URLs, and
 *   private key blocks), in every file, binary files too.
 * - Assignments: `NAME=value`, `name: value`, `--flag value`, `--flag=value`, and `?name=value` where the name is
 *   secret-named, such as `API_KEY` or `password`. In prose files (`.md`, `.txt`), `name: value` counts only when the
 *   value looks like a credential, so a sentence such as "Password: ask the owner" passes.
 * - Fields: in JSON files and Markdown frontmatter, a value under a secret-named key, or anywhere below one, must be a
 *   reference, a scheme word, or a word such as `none`. Numbers count. Every string value is also scanned with the
 *   shape and assignment rules, so a JSON escape cannot hide a token.
 * - A `.json` file that is not strict JSON is an `unparseable-json` finding, and its lines are scanned as text.
 * A finding names the file, the line or the JSON pointer, and the rule. It never holds the value it found.
 */
import { decodeText, isRecord, parseStrictJson, readFrontmatter } from './json.js';
import type { DefinitionFile, JsonValue } from './types.js';
import { DEFINITION_LIMITS } from './words.js';

export interface SecretFinding {
  readonly path: string;
  readonly rule: string;
  /** The 1-based line of a text or binary file. */
  readonly line?: number;
  /** The JSON pointer of a value. Unsafe key names are shown as `*`. */
  readonly pointer?: string;
}

/** Rules that mean the scan could not finish. The loader reports them as SECRET_SCAN_INCOMPLETE. */
export const INCOMPLETE_RULES = Object.freeze(['line-too-long', 'token-too-long', 'unparseable-json'] as const);

/** Shapes, each anchored at the start of a token. The third item asks for a digit in the match. */
const SHAPES: readonly (readonly [string, RegExp, boolean])[] = [
  ['aws-access-key', /^(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}(?![0-9A-Z])/, false],
  ['github-token', /^gh[pousr]_[A-Za-z0-9]{36}/, false],
  ['github-token', /^github_pat_[A-Za-z0-9_]{22}/, false],
  ['gitlab-token', /^glpat-[A-Za-z0-9_-]{20}/, false],
  ['anthropic-key', /^sk-ant-[A-Za-z0-9_-]{20}/, true],
  ['openai-key', /^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20}/, true],
  ['slack-token', /^xox[abposr]-[A-Za-z0-9-]{10}/, false],
  ['google-api-key', /^AIza[0-9A-Za-z_-]{35}/, false],
  ['stripe-key', /^[sr]k_live_[0-9A-Za-z]{16}/, false],
  ['npm-token', /^npm_[A-Za-z0-9]{36}/, false],
  ['huggingface-token', /^hf_[A-Za-z0-9]{34}/, false],
  ['supabase-token', /^sbp_[a-f0-9]{40}/, false],
  ['notion-token', /^(?:ntn_[A-Za-z0-9]{40}|secret_[A-Za-z0-9]{43})/, true],
  ['twilio-key', /^SK[0-9a-fA-F]{32}(?![0-9a-fA-F])/, false],
  ['telegram-token', /^[0-9]{8,10}:[A-Za-z0-9_-]{35}/, false],
  ['discord-token', /^[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/, false],
  ['jwt', /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8}/, false],
  ['webhook-url', /^https?:\/\/(?:(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]{20}|hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]{8})/, false],
  // A password inside a URL. A `${NAME}` password is a reference and passes.
  ['url-credentials', /^[a-z][a-z0-9+.-]{0,30}:\/\/[^:/@$]{1,256}:[^@/$]{1,256}@/i, false],
];
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY/;
const SPLIT = /[\s"'`,;()[\]<>|\\]+/;
const BINARY_SPLIT = /[^\x21-\x7e]+|["'`,;()[\]<>|\\]+/;
const PROSE = /\.(?:md|markdown|txt|rst)$/i;

const SECRET_WORDS = new Set([
  'secret', 'secrets', 'token', 'tokens', 'password', 'passwords', 'passwd', 'pwd', 'passphrase', 'credential', 'credentials',
  'auth', 'authorization', 'bearer', 'cookie', 'cookies', 'apikey', 'apikeys', 'privatekey', 'accesskey', 'secretkey',
]);
/** Words that name a secret only as the last word: `DB_PASS`, `GITLAB_PAT`, `OPENAI_KEY`. */
const LAST_ONLY = new Set(['pass', 'pat', 'key', 'keys']);
const KEY_BENIGN_BEFORE = new Set([
  'public', 'sort', 'primary', 'partition', 'cache', 'foreign', 'short', 'hot', 'lookup', 'group', 'object', 'map', 'unique',
  'routing', 'idempotency', 'dedupe', 'row', 'hash', 'index', 'cursor', 'shortcut', 'hotkey', 'react', 'i18n', 'translation',
]);
/** A last word that makes the name describe a secret rather than hold one: `token_url`, `api_key_env`, `apiKeyHelper`. */
const QUALIFIERS = new Set([
  'type', 'types', 'kind', 'url', 'uri', 'urls', 'endpoint', 'host', 'file', 'path', 'dir', 'name', 'names', 'id', 'ids',
  'length', 'len', 'min', 'max', 'size', 'count', 'limit', 'budget', 'header', 'mode', 'method', 'policy', 'scheme',
  'format', 'expiry', 'expires', 'expiration', 'ttl', 'timeout', 'env', 'var', 'vars', 'variable', 'ref', 'reference',
  'helper', 'command', 'cmd', 'provider', 'field', 'enabled', 'disabled', 'required', 'hint', 'description', 'label',
  'prompt', 'placeholder', 'pattern', 'regex', 'keychain', 'store', 'source', 'location', 'prefix', 'suffix', 'version',
  'scope', 'scopes', 'audience', 'issuer', 'algorithm', 'alg', 'strategy', 'usage', 'user', 'username', 'login', 'email',
]);
const COUNT_FIRST = new Set(['max', 'min', 'num', 'total', 'count', 'n']);
/** Keys below a secret-named key whose value describes the secret: `auth: { type: "oauth" }`. */
const NESTED_SAFE = new Set([
  'type', 'kind', 'scheme', 'method', 'url', 'uri', 'endpoint', 'host', 'keychain', 'env', 'var', 'provider', 'header',
  'mode', 'name', 'id', 'path', 'file', 'enabled', 'required', 'description',
]);
/** Values that say there is no secret. */
const BENIGN = new Set([
  'none', 'null', 'nil', 'undefined', 'true', 'false', 'yes', 'no', 'on', 'off', 'enabled', 'disabled', 'required',
  'optional', 'default', 'empty', 'unset', 'n/a', 'na', 'tbd', 'todo', 'placeholder', 'example', 'redacted', 'string',
  'number', 'boolean', 'secret', 'password', 'token', 'bearer', 'basic', 'oauth', 'oauth2',
]);

function words(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when a key names a secret: `API_KEY`, `apiKey`, `STRIPE_SECRET_KEY`, `DB_PASS`, `Authorization`, `tokens`. */
export function isSecretKey(key: string): boolean {
  if (key.length > 128) return false;
  const w = words(key);
  const last = w.at(-1);
  if (last === undefined || QUALIFIERS.has(last) || (w.length > 1 && COUNT_FIRST.has(w[0]!))) return false;
  if (w.some(x => SECRET_WORDS.has(x))) return true;
  if (!LAST_ONLY.has(last)) return false;
  if (last === 'key' || last === 'keys') return w.length > 1 && !KEY_BENIGN_BEFORE.has(w.at(-2)!);
  return true;
}

const REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const SCHEME = /\b(?:bearer|basic|token)\b/gi;

/** True when a string holds only `${NAME}` references, an auth scheme word, and spaces. */
export function isReferenceOnly(value: string): boolean {
  return value.replace(REFERENCE, '').replace(SCHEME, '').trim() === '';
}

/** True when a value given to a secret-named name is a literal, not a reference, a placeholder, or a word like `none`. */
function literal(raw: string, prose: boolean): boolean {
  const value = raw.replace(REFERENCE, '').replace(SCHEME, '').trim().replace(/^["']+|["']+$/g, '');
  if (value === '' || /^[$%<]|^\{\{/.test(value) || BENIGN.has(value.toLowerCase()) || /^(.)\1*$/.test(value)) return false;
  return prose ? credentialLike(value) : true;
}
function credentialLike(v: string): boolean {
  return (v.length >= 8 && /[0-9]/.test(v) && /[A-Za-z]/.test(v)) || (v.length >= 12 && /[a-z]/.test(v) && /[A-Z]/.test(v.slice(1)));
}

/** The shape rule a token matches, or null. Tests the token and its pieces between `=`, `&`, `?`, `:`, `@`, and `/`. */
function shapeOf(token: string): string | null {
  const candidates = new Set<string>([token, ...token.split(/[=&?]/), ...token.split(/[=&?:@/]/)]);
  for (const raw of candidates) {
    const c = raw.replace(/^[^A-Za-z0-9]+/, '');
    if (c.length < 8) continue;
    for (const [rule, re, digit] of SHAPES) { const m = re.exec(c); if (m && (!digit || /[0-9]/.test(m[0]))) return rule; }
  }
  return null;
}

const PAIR = /^(-{0,2}[A-Za-z_][A-Za-z0-9_.-]{0,127})([=:])(.*)$/;
/** True when the tokens of one line assign a literal to a secret-named name. */
function assigns(tokens: readonly string[], prose: boolean): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if ((t === '=' || t === ':') && i > 0 && next !== undefined) {
      if (isSecretKey(tokens[i - 1]!.replace(/^-+/, '')) && literal(next, t === ':' && prose)) return true;
      continue;
    }
    if (/^--?[A-Za-z]/.test(t) && !/[=:]/.test(t)) {
      if (isSecretKey(t.replace(/^-+/, '')) && next !== undefined && !next.startsWith('-') && literal(next, false)) return true;
      continue;
    }
    for (const piece of t.split(/[?&]/)) {
      const m = PAIR.exec(piece);
      if (!m || !isSecretKey(m[1]!.replace(/^-+/, ''))) continue;
      const proseHere = m[2] === ':' && prose;
      if (m[3] !== '' ? literal(m[3]!, proseHere) : next !== undefined && literal(next, proseHere)) return true;
    }
  }
  return false;
}

/** The rule one text line breaks, or null. */
function lineRule(line: string, prose: boolean, assignments: boolean): string | null {
  if (line.length > DEFINITION_LIMITS.lineChars) return 'line-too-long';
  if (PRIVATE_KEY.test(line)) return 'private-key';
  const tokens = line.split(SPLIT).filter(Boolean);
  for (const t of tokens) { const rule = shapeOf(t); if (rule) return rule; }
  return assignments && assigns(tokens, prose) ? 'secret-assignment' : null;
}

/** The rule a string value breaks, line by line, or null. String values may be prose. */
function stringRule(value: string): string | null {
  for (const line of value.split(/\r\n|\r|\n/)) { const rule = lineRule(line, true, true); if (rule) return rule; }
  return null;
}

/** Scans every file. The result is in file order, then line order, then value order. */
export function scanSecrets(files: readonly DefinitionFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    const text = decodeText(file.bytes);
    if (text === null) { scanBinary(file, findings); continue; }
    const isJson = file.path.endsWith('.json');
    let value: JsonValue | undefined;
    let parsed = true;
    if (isJson) { const r = parseStrictJson(text); if (r.ok) value = r.value; else { parsed = false; findings.push({ path: file.path, rule: 'unparseable-json' }); } }
    else if (file.path.endsWith('.md')) { const fm = readFrontmatter(text); if (fm.ok) value = fm.data; }
    // A parsed JSON file is scanned through its values, which covers every string and undoes every escape.
    if (!(isJson && parsed)) {
      const prose = PROSE.test(file.path);
      text.split(/\r\n|\r|\n/).forEach((line, index) => {
        const rule = lineRule(line, prose, true);
        if (rule) findings.push({ path: file.path, rule, line: index + 1 });
      });
    }
    if (value !== undefined) fields(value, '', file.path, findings, false);
  }
  return findings;
}

function scanBinary(file: DefinitionFile, findings: SecretFinding[]): void {
  Buffer.from(file.bytes).toString('latin1').split('\n').forEach((line, index) => {
    if (PRIVATE_KEY.test(line)) { findings.push({ path: file.path, rule: 'private-key', line: index + 1 }); return; }
    for (const t of line.split(BINARY_SPLIT)) {
      if (t.length > DEFINITION_LIMITS.lineChars) { findings.push({ path: file.path, rule: 'token-too-long', line: index + 1 }); return; }
      const rule = t.length >= 8 ? shapeOf(t) : null;
      if (rule) { findings.push({ path: file.path, rule, line: index + 1 }); return; }
    }
  });
}

function fields(value: JsonValue, pointer: string, path: string, out: SecretFinding[], secret: boolean): void {
  if (typeof value === 'string') {
    if (secret && literal(value, false)) { out.push({ path, rule: 'secret-named-field', pointer }); return; }
    const rule = stringRule(value);
    if (rule) out.push({ path, rule, pointer });
    return;
  }
  if (typeof value === 'number') { if (secret) out.push({ path, rule: 'secret-named-field', pointer }); return; }
  if (Array.isArray(value)) {
    const before = out.length;
    value.forEach((v, i) => fields(v, `${pointer}/${i}`, path, out, secret));
    // Flags and their values sit in separate elements: `["--token", "value"]`.
    if (out.length === before && value.length > 1 && value.every(v => typeof v === 'string')) {
      const rule = stringRule((value as string[]).join(' '));
      if (rule) out.push({ path, rule, pointer });
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, v] of Object.entries(value)) {
    if (key.length >= 8 && shapeOf(key) !== null) out.push({ path, rule: 'secret-in-key', pointer: `${pointer}/*` });
    const below = secret ? !NESTED_SAFE.has(words(key).at(-1) ?? '') : isSecretKey(key);
    fields(v, `${pointer}/${safeSegment(key)}`, path, out, below);
  }
}

/** A key as a JSON pointer segment, or `*` when the key is not safe to show. */
function safeSegment(key: string): string {
  return isSafeName(key) ? key.replace(/~/g, '~0').replace(/\//g, '~1') : '*';
}

/** True when a name can appear in a message: short, plain characters, and no secret shape. */
export function isSafeName(name: string): boolean {
  return /^[A-Za-z0-9_.@:-]{1,64}$/.test(name) && shapeOf(name) === null;
}
/** A name for a message: the name in quotes when it is safe, else a fixed phrase. Never a value. */
export function safeName(name: unknown): string {
  return typeof name === 'string' && isSafeName(name) ? `"${name}"` : '(a name not shown)';
}
