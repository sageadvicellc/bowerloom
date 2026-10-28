/**
 * Path patterns. The neutral path language is a subset of Claude Code's gitignore syntax, so Claude Code carries it
 * exactly (locked-in parts spec, section 10: path guardrails are `exact` in Claude Code). Matching-semantics note,
 * section 3:
 *
 * - A pattern is relative to the project root. `*` matches within one segment, and a `**` segment matches any number of
 *   segments. A pattern that matches a folder also covers everything below it.
 * - A pattern with no `/` (a bare name, such as `.env` or `*.pem`) matches at any depth.
 * - A pattern with a `/` matches from the project root in an `allow` rule, and at any depth in a `deny` or `ask` rule.
 *   This is Claude Code's documented reading (note, section 3, "Depth"; vector CC20).
 *
 * Outside the neutral language, and so refused: an absolute or home path, a `..` segment, negation with `!`, and the
 * gitignore classes `?`, `[`, `]`, and braces. Claude Code reads some of these, but other engines do not, and the
 * definition holds no project location to anchor an absolute path.
 */

export type PathMode = 'anchored' | 'any-depth';

/** Why a path pattern is outside the neutral language, or null when it is inside. */
export function pathPatternProblem(pattern: string): string | null {
  const p = pattern.startsWith('./') ? pattern.slice(2) : pattern;
  if (p === '' || p === '/') return 'The path pattern is empty.';
  if (p.startsWith('/') || p.startsWith('~')) return 'An absolute or home path is outside the neutral path language: patterns are relative to the project.';
  if (p.startsWith('!')) return 'Negation with ! is outside the neutral path language. Precedence carries carve-outs instead.';
  if (/[?[\]{}\\]/.test(p)) return 'The characters ? [ ] { } and \\ are outside the neutral path language.';
  if (p.split('/').some(s => s === '..' || s === '.')) return 'A . or .. segment is outside the neutral path language.';
  if (/\/\//.test(p)) return 'An empty segment is outside the neutral path language.';
  return null;
}

/** The pattern without a leading `./`, and whether it names folders only (a trailing `/`). */
export function normalizePath(pattern: string): { readonly body: string; readonly dirOnly: boolean; readonly anchored: boolean } {
  let body = pattern;
  let anchored = false;
  if (body.startsWith('./')) { body = body.slice(2); anchored = true; }
  else if (body.startsWith('/') && !body.startsWith('//')) { body = body.slice(1); anchored = true; }
  const dirOnly = body.endsWith('/');
  if (dirOnly) body = body.slice(0, -1);
  return { body, dirOnly, anchored };
}

/** True when the pattern holds a `/` other than a trailing one, after normalising. */
export function isSlashed(pattern: string): boolean {
  return normalizePath(pattern).body.includes('/');
}

const escape = (text: string) => text.replace(/[.+^$()|{}[\]\\?]/g, '\\$&');

function segmentSource(segment: string): string {
  return segment.split('*').map(escape).join('[^/]*');
}

/** The regular expression of a gitignore-style pattern for paths relative to the project root, with `/` separators. */
export function pathRegex(pattern: string, mode: PathMode): RegExp {
  const { body, dirOnly, anchored } = normalizePath(pattern);
  const segments = body.split('/');
  let source = '';
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      if (last) source += i === 0 ? '.+' : '/.+';
      else source += i === 0 ? '(?:.+/)?' : '/(?:.+/)?';
      return;
    }
    if (i > 0 && segments[i - 1] !== '**') source += '/';
    source += segmentSource(segment);
  });
  const deep = !anchored && (mode === 'any-depth' || !body.includes('/'));
  const head = deep && !body.startsWith('**') ? '(?:.*/)?' : '';
  const tail = dirOnly ? '/.+' : '(?:/.*)?';
  return new RegExp(`^${head}${source}${tail}$`, 's');
}

/** True when the pattern matches the path, or a folder that holds it. */
export function pathMatches(pattern: string, path: string, mode: PathMode): boolean {
  const subject = path.startsWith('./') ? path.slice(2) : path;
  return pathRegex(pattern, mode).test(subject);
}

/**
 * Evaluates one ordered list of gitignore patterns, with `!` negation, as Claude Code does within one list
 * (vectors CC22 and CC23). A folder that the list matches cannot be reopened by a later `!` for a file inside it.
 */
export function listMatches(patterns: readonly string[], path: string, mode: PathMode): boolean {
  const subject = path.startsWith('./') ? path.slice(2) : path;
  const segments = subject.split('/');
  const status = (candidate: string, folder: boolean): boolean => {
    let matched = false;
    for (const raw of patterns) {
      const negated = raw.startsWith('!');
      const pattern = negated ? raw.slice(1) : raw;
      // An ancestor is matched only by the pattern itself, not by the cover-below tail of a deeper pattern.
      const re = pathRegex(pattern, mode);
      if (folder ? exactly(pattern, candidate, mode) : re.test(candidate)) matched = !negated;
    }
    return matched;
  };
  for (let i = 1; i < segments.length; i++) if (status(segments.slice(0, i).join('/'), true)) return true;
  return status(subject, false);
}

function exactly(pattern: string, candidate: string, mode: PathMode): boolean {
  const re = pathRegex(pattern, mode);
  const source = re.source.replace(/\(\?:\/\.\*\)\?\$$/, '$').replace(/\/\.\+\$$/, '$');
  return new RegExp(source, 's').test(candidate);
}
