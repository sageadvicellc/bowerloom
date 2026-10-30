import { realpathSync } from 'node:fs';

/**
 * The final guard over anything that leaves the log. The fields are allowlisted already; this pass catches what a
 * field could still carry, such as engine version output or a typed note: a home folder path, a user folder prefix, or a secret.
 */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME = '[^/\\\\\\s"\'`:;,()<>%&]+';
// Longest forms first, so a prefix inside a longer form never leaves the rest of it behind.
const FOLDERS: readonly RegExp[] = [
  new RegExp(`[A-Za-z]:[\\\\/]+Users[\\\\/]+${NAME}`, 'gi'),
  new RegExp(`/Volumes/${NAME}/Users/${NAME}`, 'gi'),
  new RegExp(`%2F(?:Users|home)%2F${NAME}`, 'gi'),
  new RegExp(`/(?:private/)?var/folders/${NAME}(?:/${NAME})?`, 'gi'),
  new RegExp(`/(?:Users|home)/${NAME}`, 'gi'),
  /(?<![A-Za-z0-9_.-])\/root(?![A-Za-z0-9_.-])/gi,
];
const TOKENS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /npm_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{8,}/g, /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g, /xox[bp]-[A-Za-z0-9-]{8,}/g, /AKIA[0-9A-Z]{16}/g,
];
const KEYWORD_VALUE = /(token|key|secret|password)(["']?\s*[:=]\s*["']?|\s+)[A-Za-z0-9+/=_-]{24,}/gi;

/** A path as it is, and as the file system names it (a symbolic link resolved). Paths that do not exist stay as they are. */
export function pathForms(...paths: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    if (p === undefined || p.length < 2 || !p.startsWith('/')) continue;
    out.add(p.replace(/\/+$/, ''));
    try { out.add(realpathSync(p)); } catch { /* a path that is not there has one form */ }
  }
  return [...out];
}

/** Replaces the given folders (and the user folder forms of every system) with `~`, and token-shaped strings with [redacted]. */
export function redactText(text: string, home: string | readonly string[] = ''): string {
  let out = text;
  const folders = (typeof home === 'string' ? [home] : [...home]).map(h => h.replace(/\/+$/, '')).filter(h => h.startsWith('/') && h.length > 1).sort((a, b) => b.length - a.length);
  for (const folder of folders) out = out.replace(new RegExp(`${escapeRegExp(folder)}(?![A-Za-z0-9_.-])`, 'g'), '~');
  for (const pattern of FOLDERS) out = out.replace(pattern, '~');
  for (const pattern of TOKENS) out = out.replace(pattern, '[redacted]');
  return out.replace(KEYWORD_VALUE, '$1$2[redacted]');
}

/** The same guard over every string of a plain JSON value. */
export function redactDeep<T>(value: T, home: string | readonly string[] = ''): T {
  if (typeof value === 'string') return redactText(value, home) as T;
  if (Array.isArray(value)) return value.map(item => redactDeep(item, home)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, home)])) as T;
  return value;
}
