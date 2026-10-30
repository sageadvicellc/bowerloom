/**
 * The final guard over anything that leaves the log. The fields are allowlisted already; this pass catches what a
 * field could still carry, such as engine version output: a home folder path, a user folder prefix, or a secret.
 */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const USER_FOLDER = /\/(?:Users|home)\/[^/\s"'`\\:;,()<>]+/g;
const TOKENS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /npm_[A-Za-z0-9]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g, /sk-[A-Za-z0-9_-]{16,}/g, /xox[bp]-[A-Za-z0-9-]{8,}/g, /AKIA[0-9A-Z]{16}/g,
];
const KEYWORD_VALUE = /(token|key|secret|password)(["']?\s*[:=]\s*["']?|\s+)[A-Za-z0-9+/=_-]{24,}/gi;

/** Replaces the home folder and any /Users/<name> or /home/<name> prefix with `~`, and token-shaped strings with [redacted]. */
export function redactText(text: string, home = ''): string {
  let out = text;
  const folder = home.length > 1 ? home.replace(/\/+$/, '') : '';
  if (folder.startsWith('/') && folder.length > 1) out = out.replace(new RegExp(`${escapeRegExp(folder)}(?![A-Za-z0-9_.-])`, 'g'), '~');
  out = out.replace(USER_FOLDER, '~');
  for (const pattern of TOKENS) out = out.replace(pattern, '[redacted]');
  return out.replace(KEYWORD_VALUE, '$1$2[redacted]');
}

/** The same guard over every string of a plain JSON value. */
export function redactDeep<T>(value: T, home = ''): T {
  if (typeof value === 'string') return redactText(value, home) as T;
  if (Array.isArray(value)) return value.map(item => redactDeep(item, home)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, home)])) as T;
  return value;
}
