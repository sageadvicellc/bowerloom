/**
 * The secret scan (section 8, rule 3; section 12, check 3). A definition holds no secret value: a secret is a reference
 * to a variable name, `${NAME}`, or a keychain entry, `{ "keychain": "<entry>" }`.
 *
 * Two kinds of rule run over every file:
 * - Shape rules find well-known credential forms in any text or binary file, line by line.
 * - The field rule reads JSON files and Markdown frontmatter. A string under a secret-named key, such as `API_KEY` or
 *   `Authorization`, must hold nothing but `${NAME}` references and an auth scheme word.
 * A finding names the file, the line or the JSON pointer, and the rule. It never holds the value it found.
 */
import { decodeText, isRecord, parseStrictJson, readFrontmatter } from './json.js';
import type { DefinitionFile, JsonValue } from './types.js';

export interface SecretFinding {
  readonly path: string;
  readonly rule: string;
  /** The 1-based line, for a shape rule. */
  readonly line?: number;
  /** The JSON pointer of the value, for the field rule. */
  readonly pointer?: string;
}

const SHAPES: readonly (readonly [string, RegExp])[] = [
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['github-token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['anthropic-key', /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['stripe-key', /\b[sr]k_live_[0-9A-Za-z]{16,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  // A password inside a URL. A `${NAME}` password is a reference and passes.
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s@/'"$]+@/i],
];

/** `TOKEN=value` or `api_key: value` in a text file that is not JSON. The value has letters and digits and no `$`. */
const ASSIGNMENT = /\b[A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([^\s"'`,;]{8,})/i;
const assignmentValue = (value: string) => !/^[$<{%]/.test(value) && /[A-Za-z]/.test(value) && /[0-9]/.test(value);

const SENSITIVE_KEY = /(?:^|_)(?:secret|token|password|passwd|pwd|api_?key|apikey|access_?key|private_?key|client_?secret|credentials?|authorization|auth|bearer|cookie)$/;
/** True when a key names a secret: `API_KEY`, `apiKey`, `X-Auth-Token`, `Authorization`, `clientSecret`. */
export function isSecretKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase());
}
/** True when a string holds only `${NAME}` references, an auth scheme word, and spaces. */
export function isReferenceOnly(value: string): boolean {
  return value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '').replace(/\b(?:bearer|basic|token)\b/gi, '').trim() === '';
}

/** Scans every file. The result is in file order, then line order. */
export function scanSecrets(files: readonly DefinitionFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    const text = decodeText(file.bytes);
    const lines = (text ?? Buffer.from(file.bytes).toString('latin1')).split(/\r\n|\r|\n/);
    const isJson = file.path.endsWith('.json');
    lines.forEach((line, index) => {
      const shape = SHAPES.find(([, re]) => re.test(line));
      if (shape) { findings.push({ path: file.path, rule: shape[0], line: index + 1 }); return; }
      if (text !== null && !isJson) {
        const m = ASSIGNMENT.exec(line);
        if (m && assignmentValue(m[1]!)) findings.push({ path: file.path, rule: 'secret-assignment', line: index + 1 });
      }
    });
    if (text === null) continue;
    let value: JsonValue | undefined;
    if (isJson) { const parsed = parseStrictJson(text); if (parsed.ok) value = parsed.value; }
    else if (file.path.endsWith('.md')) { const fm = readFrontmatter(text); if (fm.ok) value = fm.data; }
    if (value !== undefined) fields(value, '', file.path, findings);
  }
  return findings;
}

function fields(value: JsonValue, pointer: string, path: string, out: SecretFinding[]): void {
  if (Array.isArray(value)) { value.forEach((v, i) => fields(v, `${pointer}/${i}`, path, out)); return; }
  if (!isRecord(value)) return;
  for (const [key, v] of Object.entries(value)) {
    const at = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (typeof v === 'string' && isSecretKey(key) && !isReferenceOnly(v)) out.push({ path, rule: 'secret-named-field', pointer: at });
    else fields(v, at, path, out);
  }
}
