// Shared by the release and lane tooling (tools/gates.mjs, tools/lane-tree.mjs, tools/lib/run-child.mjs, scripts/release.mjs). Never shipped.
// It keeps secrets out of a child's environment and out of logs: scrubEnv drops secret-named variables, redact blanks token-shaped text,
// and emptyNpmConfigEnv points npm at empty config files so a user's ~/.npmrc (which can hold an auth token) is never read.
import fs from 'node:fs';
import path from 'node:path';

export const REDACTED = '[redacted]';

// A name is secret when it ends in one of these words, case-insensitive.
const SECRET_SUFFIX = /_(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|APIKEY|CREDENTIALS|OTP)$/i;
// Or when it holds one of these anywhere. `_auth` must not be followed by a letter, so GIT_AUTHOR_NAME is kept and npm_config__auth is dropped.
const SECRET_INSIDE = /authtoken|_auth(?![a-z])|:_auth|_password/i;
const SECRET_NAMES = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'VERCEL_TOKEN', 'GH_PAT', 'GITHUB_PAT', 'DATABASE_URL']);
// These match the patterns above ("_AUTH_") but hold no secret: they point at the ssh agent socket and process, which git over ssh needs.
const NOT_SECRET_NAMES = new Set(['SSH_AUTH_SOCK', 'SSH_AGENT_PID']);
// A value shorter than this is not redacted from text: it would blank ordinary words.
const MIN_SECRET_VALUE = 4;

/** True when an environment variable name holds a token, key, password, or auth setting that a child must not see. */
export function isSecretName(name) {
  if (NOT_SECRET_NAMES.has(name.toUpperCase())) return false;
  return SECRET_SUFFIX.test(name) || SECRET_INSIDE.test(name) || SECRET_NAMES.has(name.toUpperCase());
}

/** A copy of `env` without secret-named variables and without undefined values. */
export function scrubEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => value !== undefined && !isSecretName(name)));
}

// Token shapes: npm, GitHub (classic and fine-grained), and OpenAI-style keys; JWTs, Slack tokens, and Google API keys.
const TOKEN_SHAPES = [
  /\bnpm_[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[A-Za-z0-9_-]{35}/g,
];
// An assignment keeps its name and loses its value: the text after the equals sign becomes [redacted].
const ASSIGNMENTS = [
  /(_auth(?:Token)?\s*=\s*["']?)[^\s"']+/gi,
  /(passw(?:or)?d\s*=\s*["']?)[^\s"']+/gi,
  // JSON form, with any prefix on the key ("_password", "db_password"), either quote style, and escaped quotes (JSON inside a JSON string).
  /(\\?["'][\w.:/@-]*(?:_auth(?:Token)?|passw(?:or)?d)\\?["']\s*:\s*\\?["'])[^"'\\]+/gi,
];
// URL userinfo: the password after the first colon, up to the last @ before a slash or a space. The user name and the host stay.
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s/]+(?=@)/gi;
const AUTH_HEADER = /(\bAuthorization["']?\s*:\s*(?:Bearer|Basic|token)\s+)[^\s"']+/gi;
const BEARER = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g;

/** `text` with token-shaped strings, auth assignments, Authorization headers, and the values of secret-named variables in `env` replaced by [redacted]. */
export function redact(text, env = process.env) {
  let out = String(text ?? '');
  const values = Object.entries(env ?? {})
    .filter(([name, value]) => isSecretName(name) && typeof value === 'string' && value.length >= MIN_SECRET_VALUE)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
  for (const value of new Set(values)) out = out.split(value).join(REDACTED);
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, REDACTED);
  for (const assignment of ASSIGNMENTS) out = out.replace(assignment, `$1${REDACTED}`);
  out = out.replace(URL_USERINFO, `$1${REDACTED}`);
  out = out.replace(AUTH_HEADER, `$1${REDACTED}`).replace(BEARER, `$1${REDACTED}`);
  return out;
}

/**
 * Writes an empty `userconfig` and an empty `globalconfig` (mode 0600) in `dir` and returns the two npm variables that point at them.
 * A child that gets these never reads the user's ~/.npmrc or the machine's npmrc, so no registry token reaches it.
 */
export function emptyNpmConfigEnv(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const userconfig = path.join(dir, 'userconfig');
  const globalconfig = path.join(dir, 'globalconfig');
  for (const file of [userconfig, globalconfig]) {
    fs.writeFileSync(file, '', { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  return { npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig };
}
