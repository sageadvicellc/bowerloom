#!/usr/bin/env node
// Release tooling, never shipped. Safety class: read-only (it runs git diff and git log, and reads the files it is given).
// Checks that a branch and its pull request text leak no private detail into a public repository:
//   node tools/public-scan.mjs [--base REF] [--pr-body FILE] [--terms-file ABS_FILE] [--allow-empty] [--allow-intermediate-binary] [--json]
// (a) The added lines of `git diff <base>...HEAD`, the added lines of EVERY commit patch in `<base>..HEAD` (so a secret added in one commit and removed in a later one
//     is still found), the file paths the diff touches, every commit message in `<base>..HEAD`, and the author and committer name and address of each of those
//     commits are scanned for structural leaks only: home paths, session links and ids, scratch folders, email addresses, and likely secrets (token shapes, JWTs,
//     Slack and Google keys, _authToken and password assignments, passwords inside URLs, private key headers). A password assignment whose unquoted value is code in one of
//     five strict shapes (a call or index on an identifier, a member chain with no digit, a ${...} template, a $name variable, a keyword such as undefined) is not a secret,
//     unless a hardcoded fallback follows it (`?? "literal"`, `|| "literal"`, `or "literal"`). Any other bare word is flagged when it has 8 or more characters (and, after
//     a colon, a digit); a shorter bare word is a known limit. A quoted value (also with escaped quotes) is flagged unless it is a placeholder.
//     A marker "public-scan: allow <kind>" (kind: secret, email, home-path, url-credential; whole words) skips that kind of finding on its own physical line, in an
//     ADDED TEXT LINE of the diff only. A bare marker or an unknown kind skips nothing. It is never honoured in file paths, binary files, commit messages, author names, or the
//     PR body, and never skips the private terms of (b). Every skipped finding is listed in the result as allowedLines (count, file, line, kind).
// (b) --terms-file names a file OUTSIDE the repository with one private term per line (blank lines and lines starting with # are skipped; lines end in LF, CR LF, or
//     CR; a file with no terms is an error). Each term is matched case-insensitively as a whole word (letters and digits make a word; an underscore does not) in the
//     added lines, paths, commit messages and names, and the PR body. A finding shows the file, the line, and the line number in the terms file, and never the term.
//     Output says "terms: N checked" or "terms: NOT checked". An excerpt for a home path or an email is a constant, never the real text.
// (c) --pr-body checks the house shape: the first non-empty line is a GitHub alert opener, the body has at most 300 whitespace-separated words, and it leaks nothing.
// A line longer than 4000 characters is scanned in overlapping windows of 4000 characters (overlap 200), so no line is skipped and no pattern runs on more than
// 4000 characters at a time. A leak that sits on a window edge is found once.
// A binary file (git diff --numstat shows "-") that the range adds or changes is scanned from its HEAD blob (git cat-file, decoded as latin1, with the same patterns and
// the terms); the names are listed as binaryScanned. A binary file over 5 MiB, or one whose blob cannot be read, is listed as unscanned and makes the exit 1.
// A path finding is reported with the file "file-path" and the line set to the path's position in `git diff --name-only`. A binary file name that matches a leak
// pattern is listed as "[path withheld]".
// An empty range (no commits, or nothing added) exits 1 unless --allow-empty is given; with it the output says "accepted by --allow-empty", never "clean".
// Binary content is read as raw bytes (latin1). A compressed format (zip, gz, dmg, docx, pdf streams) is not inspected, and the output says so (binaryNote).
// Only committed work is scanned: a change that is not committed is not in `<base>...HEAD`. A binary file added (or changed) and then removed (or put back) inside the
// branch is not scanned, because only the HEAD blob of a binary file the net diff adds is. Such files are listed as binaryIntermediate and printed as a warning, and the
// exit is 1 unless --allow-intermediate-binary is given (the files stay listed).
// A binary file is scanned line by line (a line break is LF, CR LF, or CR). The file name in EVERY finding is shown as "[path withheld]" when the name itself matches a leak
// pattern or a term.
// Exit 0: nothing found. Exit 1: findings, an unscanned binary file, an intermediate binary file, or an empty range. Exit 2: wrong use, an unreadable base or repository, or an internal error
// (with --json, one object {ok:false, exit:2, error}). Exit 130: interrupted.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './lib/run-child.mjs';
import { splitFlag, jsonWanted, boolValueRefusal, flagLikeValueRefusal, reportUsage, guarded, entryState, mismatchMessage } from './lib/cli.mjs';
import { installInterruptHandlers } from './lib/interrupt.mjs';

export const DEFAULT_BASE = 'origin/release/0.9.0-beta.1';
export const MAX_WORDS = 300;
const MAX_FINDINGS = 200;
const MAX_SHOWN = 20;
const MAX_DIFF_BYTES = 64 * 1024 * 1024;
const MAX_PATCH_BYTES = 128 * 1024 * 1024;
/** A line longer than this is scanned in windows of this many characters. */
export const WINDOW_CHARS = 4000;
/** Two neighbouring windows share this many characters, so a leak shorter than this is whole in at least one of them. */
export const WINDOW_OVERLAP = 200;
/** A binary file over this size is reported as unscanned. */
export const MAX_BINARY_BYTES = 5 * 1024 * 1024;
/** Said in every result: what the binary scan can and cannot see. */
export const BINARY_NOTE = 'binary files are read as raw bytes; compressed formats (zip, gz, dmg, docx, pdf streams) are not inspected, so a leak inside one is not found; a binary file changed A->B->C inside the range is scanned only at its final (HEAD) version, never at A or B';

const USAGE = `Usage: node tools/public-scan.mjs [--base REF] [--pr-body FILE] [--terms-file ABS_FILE] [--allow-empty] [--allow-intermediate-binary] [--json]
  --base REF           scan git diff REF...HEAD and the commits REF..HEAD (default ${DEFAULT_BASE})
  --pr-body FILE       check the pull request text: alert opener first, at most ${MAX_WORDS} words, no leaks
  --terms-file ABS_FILE  private terms, one per line, in a file outside the repository; findings never print a term
  --allow-empty        accept a range with no commits or nothing added (otherwise exit 1)
  --allow-intermediate-binary  accept a binary file that a commit added and a later commit removed (it was never scanned); otherwise exit 1
  --json               print one JSON object on stdout (also for a usage error: {ok:false, exit:2, error})
A flag that takes no value rejects one: --json=x is a usage error.
Exit 0: nothing found. Exit 1: findings, an unscanned binary file, an intermediate binary file, or an empty range. Exit 2: wrong use. Exit 130: interrupted.`;

// Names that stand for "a person" in an example. Anything in angle brackets never matches the patterns below, because a name must start with a letter or digit.
const PLACEHOLDER_NAMES = new Set(['you', 'user', 'name', 'example', 'username', 'me', 'runner', 'shared', 'public', 'default']);
const NAME = String.raw`([A-Za-z0-9][^/\\\s'"` + '`' + String.raw`)\]>:*,;]*)`;
const AFTER_UNIX = String.raw`(?=[/\s'"` + '`' + String.raw`)\]>:,;]|$)`;
const AFTER_WIN = String.raw`(?=[\\\s'"` + '`' + String.raw`)\]>:,;]|$)`;
const BEFORE = String.raw`(?<![A-Za-z0-9_])`;

const allowedPlaceholder = match => PLACEHOLDER_NAMES.has(match[1].toLowerCase());
const ALLOWED_EMAIL = /(?:@example\.com|@users\.noreply\.github\.com|^noreply@anthropic\.com|^noreply@github\.com|^git@github\.com)$/i;
// A value that only stands for a secret. The WHOLE value must be one of these: an environment reference in capitals (`$NAME`, `${NAME}`, `%NAME%`), an
// angle-bracket placeholder (`<your password>`), a template (`${{ secrets.X }}`, `{{ x }}`), or a row of mask characters. A value that only starts like one
// (`$ecret99`, `<x>tail`) is a secret.
// The environment forms are case-sensitive on purpose: `$ecret99` is a secret, `$DB_PASS` is a reference. The other forms ignore case.
const ENV_REFERENCE = /^(?:\$\{?[A-Z][A-Z0-9_]*\}?|%[A-Z][A-Z0-9_]*%)$/;
const OTHER_PLACEHOLDER = /^(?:<[^<>]*>|\$?\{\{[^{}]*\}\}|\*+|x+|\.+)$/i;
const inUrlCredential = match => /:\/\/[^\s:@/'"]*:$/.test(match.input.slice(Math.max(0, match.index - 200), match.index));
const isPlaceholderValue = value => ENV_REFERENCE.test(value) || OTHER_PLACEHOLDER.test(value);

// An unquoted value is code, and not a secret, only in one of these five strict shapes. Anything else goes to the length and digit rule.
//  (a) a call or an index on an identifier: `name(`, `a.b.c(`, `name[`, with brackets that close at the end of the token or run on past it (`f(a,` ends at a space)
//  (b) a plain member chain: `opts.password`, `process.env.DB_PASSWORD`. A segment with a digit makes it a possible token (`Sup3r.Secret1`, `abc.def.ghi1234567890`), so it is not code.
//  (c) a template: `${name}`, `${opts.password}`
//  (d) a variable: `$name`, `$DB_PASS`
//  (e) a keyword: undefined, null, true, false, None, nil (and a typed-array name such as Uint8Array)
// A value such as `Pass{word}12`, `pa$$w0rd123`, `my$ecretpass1`, or `Tr0ub4dor.&3x` is none of these.
const CODE_KEYWORDS = /^(?:undefined|null|true|false|none|nil)$/i;
const TYPED_ARRAY = /^(?:Big)?(?:Int|Uint|Float)\d+(?:Clamped)?Array$/;
const IDENTIFIER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/;
const MEMBER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+;?$/;
const TEMPLATE_REFERENCE = /^\$\{[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\}$/;
// `$name` or `${name}`. In capitals it is an environment reference (ENV_REFERENCE). In any case it is a variable when the name holds no digit; `$ecret99` is a secret.
const VARIABLE_REFERENCE = /^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/;
const isVariableReference = value => VARIABLE_REFERENCE.test(value) && !/\d/.test(value);
/** The value without the closing punctuation of the code around it: `;`, `,`, `)`, `]`, and a `}` that has no `{` of its own. */
function trimClosers(value) {
  let text = value;
  while (text !== '') {
    const last = text.at(-1);
    const open = (text.match(/\{/g) ?? []).length, close = (text.match(/\}/g) ?? []).length;
    if (';,)]'.includes(last) || (last === '}' && close > open)) text = text.slice(0, -1);
    else break;
  }
  return text;
}
/** (a) A call or an index: an identifier chain, then `(` or `[`. A bracket that closes inside the token must be the last thing in it. */
function isCallOrIndex(raw) {
  const text = raw.replace(/[;,]+$/, '');
  const head = IDENTIFIER_CHAIN.exec(text);
  if (!head || !'(['.includes(text[head[0].length] ?? '')) return false;
  let depth = 0;
  for (const character of text) { if ('([{'.includes(character)) depth++; else if (')]}'.includes(character)) depth--; }
  return depth > 0 || ')]'.includes(text.at(-1));
}
function isCodeValue(raw, trimmed) {
  if (CODE_KEYWORDS.test(trimmed) || TYPED_ARRAY.test(trimmed)) return true;
  if (isCallOrIndex(raw)) return true;
  if (MEMBER_CHAIN.test(trimmed) && !/\d/.test(trimmed)) return true;
  return TEMPLATE_REFERENCE.test(trimmed) && !/\d/.test(trimmed);
}

/**
 * A secret assignment: a name (`password`, `_authToken`), an optional closing quote of the name, `=` or `:`, an optional opening quote, and the value. A quote may carry a
 * backslash (`\"`), as in JSON inside a string. The value is a template or an angle-bracket placeholder that ends the value, or a run of characters that are not white space or quotes.
 * Groups: 1 the separator, 2 the quote ('' when none), 3 the value.
 */
function assignment(name) {
  return new RegExp(name + String.raw`(?:\\?["'])?\s*([=:])\s*(\\?["']|)((?:\$?\{\{[^{}\n]*\}\}|<[^<>\n]*>)(?![^\s'"\\])|[^\s'"]{3,})`, 'gi');
}
// A fallback after the value: `?? "literal"`, `|| 'literal'`, `or "literal"`, also chained (`a ?? b ?? "literal"`), after a call or an index (`os.environ.get("X") or "literal"`,
// `process.env["X"] ?? "literal"`), and after a cast (`process.env.X as string || "literal"`). Only the text that follows the value through such operands is read, so a literal
// fallback of a later property or statement on the same line (after `,`, `;`, `}`, `//`, or `#`) is not this value's fallback. The literal is a secret unless it is a
// placeholder; fewer than 3 characters is not read.
const FALLBACK_OPERATOR = /^\s*(?:\?\?|\|\||or(?=[\s"'\\]))\s*/;
const FALLBACK_LITERAL = /^\\?(["'])([^"'\\\n]{3,})\\?\1/;
const SHORT_LITERAL = /^\\?(["'])[^"'\\\n]*\\?\1/;
const FALLBACK_OPERAND = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*/;
const CAST = /^\s+as\s+[A-Za-z_$][\w$.]*(?:<[^<>\n]*>)?(?:\[\])*/;
/** The index just past the bracket that closes the one at `at` (quotes inside are skipped), or -1. */
function closingBracket(text, at) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const character = text[i];
    if (character === '"' || character === "'" || character === '`') {
      const close = text.indexOf(character, i + 1);
      if (close < 0) return -1;
      i = close;
    } else if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character) && --depth === 0) return i + 1;
  }
  return -1;
}
/** The text after any calls, indexes, `!`, member steps, and `as <type>` casts that directly follow an operand. */
function skipTrailers(text) {
  let rest = text;
  for (;;) {
    if (rest[0] === '(' || rest[0] === '[') {
      const end = closingBracket(rest, 0);
      if (end < 0) return '';
      rest = rest.slice(end);
      continue;
    }
    const step = /^!|^\??\.[A-Za-z_$][\w$]*/.exec(rest) ?? CAST.exec(rest);
    if (!step) return rest;
    rest = rest.slice(step[0].length);
  }
}
/** The text after the value of `match`. A value that stops inside a call or an index (`os.environ.get(`, `process.env[`) is followed through the closing bracket; a closing quote of the value is skipped. */
function textAfterValue(match) {
  const input = match.input;
  let at = match.index + match[0].length;
  const count = (text, characters) => [...text].filter(character => characters.includes(character)).length;
  let depth = count(match[0], '([') - count(match[0], ')]');
  for (; depth > 0 && at < input.length; at++) {
    const character = input[at];
    if (character === '"' || character === "'") {
      const close = input.indexOf(character, at + 1);
      if (close < 0) return '';
      at = close;
    } else if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth--;
  }
  const rest = input.slice(at);
  const after = match[2] !== '' && /^\\?["']/.test(rest) ? rest.replace(/^\\?["']/, '') : rest;
  // A value that runs straight into its operator (`process.env.X??"literal"`) ends with that operator.
  const glued = /(\?\?|\|\|)$/.exec(match[3]);
  return glued ? glued[1] + after : after;
}
function hasHardcodedFallback(match) {
  let rest = textAfterValue(match);
  for (;;) {
    rest = skipTrailers(rest);
    const operator = FALLBACK_OPERATOR.exec(rest);
    if (!operator) return false;
    rest = rest.slice(operator[0].length);
    const literal = FALLBACK_LITERAL.exec(rest);
    if (literal) {
      if (!isPlaceholderValue(literal[2])) return true;
      rest = rest.slice(literal[0].length);
      continue;
    }
    const short = SHORT_LITERAL.exec(rest);
    const operand = short ?? FALLBACK_OPERAND.exec(rest);
    if (!operand) return false;
    rest = rest.slice(operand[0].length);
  }
}
/**
 * A match of `assignment` is allowed when its value is a placeholder, a variable reference, or (unquoted) code in one of the five shapes above. An unquoted bare word is a secret
 * only when it is 8 or more characters long and, after a colon, holds a digit (after `=` any such word counts). A shorter bare word is not flagged: this is a known limit.
 * A quoted value that is not a placeholder is always a secret. A code value followed by a hardcoded fallback (`?? "literal"`) is a secret.
 */
function allowedAssignment(match) {
  const [, separator, quote, rawValue] = match;
  const raw = quote.startsWith('\\') ? rawValue.replace(/\\+$/, '') : rawValue;
  const value = quote === '' ? trimClosers(raw) : raw;
  let allowed;
  if (value === '' || isPlaceholderValue(value) || isVariableReference(value)) allowed = true;
  else if (quote !== '' || (value.startsWith('$') && VARIABLE_REFERENCE.test(value))) allowed = false;
  else allowed = isCodeValue(raw, value) || value.length < 8 || (separator === ':' && !/\d/.test(value));
  return allowed && !hasHardcodedFallback(match);
}

// A password inside a URL: a scheme, `://`, a user, a colon, the secret, `@`, a host. Group 1 is the password. A URL with only a user, or with an empty or placeholder password, is allowed.
const URL_CREDENTIAL = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/'"]*:([^\s@/'"]+)@[^\s/'"]+/g;
// A URL password that only stands for one: `{name}`, `%s`, `%d`, as well as the placeholders and variables above.
const URL_PLACEHOLDER = /^(?:\{[A-Za-z_][\w.]*\}|%[sd])$/;
const allowedUrlCredential = match => isPlaceholderValue(match[1]) || URL_PLACEHOLDER.test(match[1]) || isVariableReference(match[1]);
/** True when an email match sits inside a URL credential that is itself allowed (`postgres://u:$pass@db.example.org`), so it is not an address. */
function inAllowedUrlCredential(match) {
  const from = Math.max(0, match.index - 300);
  const text = match.input.slice(from, match.index + match[0].length + 1);
  const at = match.index - from;
  for (const url of text.matchAll(URL_CREDENTIAL)) {
    if (url.index <= at && at < url.index + url[0].length && allowedUrlCredential(url)) return true;
  }
  return false;
}
// The line marker: `public-scan: allow <kind>`. The kind is required and matched as a whole word. It skips that kind of finding on its own physical line, in an added line
// of the diff only. A bare marker or an unknown kind skips nothing.
const ALLOW_MARKER = 'public-scan' + ': allow';
export const MARKER_KINDS = ['secret', 'email', 'home-path', 'url-credential'];
const MARKER_EXPRESSION = new RegExp(String.raw`(?<![\w-])` + ALLOW_MARKER + String.raw`[ \t]+(` + MARKER_KINDS.join('|') + String.raw`)(?![\w-])`, 'g');
const LINE_BREAK = /[\r\n\v\f\u0085\u2028\u2029]/g;
/** The physical lines of `text` that hold a marker with a kind: [{ start, end, kinds }]. Null when the text holds no marker at all. */
function markerSegments(text) {
  if (!text.includes(ALLOW_MARKER)) return null;
  const segments = [];
  let start = 0;
  const close = end => {
    const kinds = new Set([...text.slice(start, end).matchAll(MARKER_EXPRESSION)].map(match => match[1]));
    if (kinds.size > 0) segments.push({ start, end, kinds });
  };
  for (const match of text.matchAll(LINE_BREAK)) { close(match.index); start = match.index + 1; }
  close(text.length);
  return segments.length > 0 ? segments : null;
}

// Each pattern: a kind, an expression (global), an optional `allow(match)`, and how the excerpt is written. Excerpts of secrets never hold the match, and
// the excerpt of a home path or an email is a constant, so a real name or address is never printed.
// The expressions are written so that this file does not match them itself (escaped slashes, split literals, one-letter classes).
const HOME_EXCERPT = { 'unix-users': '/Us' + 'ers/[name]', 'unix-home': '/ho' + 'me/[name]', windows: 'C:\\Us' + 'ers\\[name]' };
const PATTERNS = [
  { kind: 'home-path', re: new RegExp(BEFORE + String.raw`\/Users\/` + NAME + AFTER_UNIX, 'g'), allow: allowedPlaceholder, excerpt: () => HOME_EXCERPT['unix-users'] },
  { kind: 'home-path', re: new RegExp(BEFORE + String.raw`\/home\/` + NAME + AFTER_UNIX, 'g'), allow: allowedPlaceholder, excerpt: () => HOME_EXCERPT['unix-home'] },
  { kind: 'home-path', re: new RegExp(String.raw`[A-Za-z]:\\{1,2}Users\\{1,2}` + NAME + AFTER_WIN, 'gi'), allow: allowedPlaceholder, excerpt: () => HOME_EXCERPT.windows },
  { kind: 'session-link', allowKind: null, re: /claude\.ai\/code\/session/g, excerpt: () => 'claude.ai/code/' + 'session…' },
  { kind: 'tmp-path', allowKind: null, re: /\/tmp\/claude-/g, excerpt: () => '/tmp/' + 'claude-…' },
  { kind: 'session-id', allowKind: null, re: /(?<![A-Za-z0-9])local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, excerpt: () => 'local_[id]' },
  // The local part is anchored (nothing local-looking before it) and capped at 64 characters, as in RFC 5321, so a long run cannot cost quadratic time.
  { kind: 'email', re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, needs: '@', allow: match => ALLOWED_EMAIL.test(match[0]) || inUrlCredential(match) || inAllowedUrlCredential(match), excerpt: () => '[redacted]@domain' },
  { kind: 'secret', re: /(?<![A-Za-z0-9])gh[p]_[A-Za-z0-9]{20,}/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])github_pa[t]_[A-Za-z0-9_]{20,}/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])np[m]_[A-Za-z0-9]{30,}/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])s[k]-[A-Za-z0-9]{20,}/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])s[k]-(?:proj|ant|svcacct)-[A-Za-z0-9_-]{20,}/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])AKI[A][0-9A-Z]{16}/g, secret: true },
  { kind: 'secret', re: /BEGIN [A-Z ]*PRIVATE KE[Y]/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9_-])ey[J][A-Za-z0-9_-]{8,}\.ey[J][A-Za-z0-9_-]{8,}/g, needs: '.', secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])xo[x][baprs]-[A-Za-z0-9-]{10,}/g, secret: true },
  { kind: 'secret', re: /(?<![A-Za-z0-9])AI[z]a[A-Za-z0-9_-]{35}/g, secret: true },
  { kind: 'secret', re: URL_CREDENTIAL, needs: '://', secret: true, allowKind: 'url-credential', allow: allowedUrlCredential },
  { kind: 'secret', re: assignment('_auth(?:T[o]ken)?'), secret: true, allow: allowedAssignment },
  { kind: 'secret', re: assignment('pass[w]ord'), secret: true, allow: allowedAssignment },
];

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Reads a terms file: one term per line; blank lines and lines starting with # are skipped. Returns [{ term, line }] with 1-based line numbers. */
export function parseTerms(text) {
  const terms = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const term = raw.trim();
    if (term !== '' && !term.startsWith('#')) terms.push({ term, line: index + 1 });
  });
  return terms;
}

// A word is made of letters and digits; an underscore ends a word, so "term_x" matches the term "term".
const termExpression = term => new RegExp(String.raw`(?<![\p{L}\p{N}])` + escapeRegExp(term).replace(/\s+/g, String.raw`\s+`) + String.raw`(?![\p{L}\p{N}])`, 'giu');

/**
 * Scans one line of text. `terms` is the result of parseTerms. A line longer than WINDOW_CHARS is read in windows of WINDOW_CHARS characters that overlap by
 * WINDOW_OVERLAP; each window starts one character early, so the one-character look-behind of a pattern sees the real previous character, and a match that
 * only touches the front or the back edge of a window is left to the neighbouring window. Terms are matched on the whole line.
 * With `options.allowMarker` (set only for the added lines of a diff), a marker `public-scan: allow <kind>` on the same physical line skips that kind. A carriage return,
 * vertical tab, form feed, NEL, or line or paragraph separator ends a physical line, so one marker cannot cover a minified blob. The private terms are never skipped.
 * Returns { found: [{ kind, excerpt, termLine? }], allowed: [kind] }. A secret or a term is never in an excerpt, and a term that sits inside another finding is masked there too.
 */
export function scanLineDetailed(text, terms = [], options = {}) {
  const found = [];
  const allowed = [];
  const expressions = terms.map(entry => ({ entry, re: termExpression(entry.term) }));
  const mask = value => expressions.reduce((current, { re }) => current.replace(re, '[redacted]'), value);
  const seen = new Set();
  const segments = options.allowMarker === true ? markerSegments(text) : null;
  const kindsAt = index => segments?.find(segment => segment.start <= index && index <= segment.end)?.kinds;
  const step = WINDOW_CHARS - WINDOW_OVERLAP;
  for (let start = 0; ; start += step) {
    const from = start === 0 ? 0 : start - 1;
    const to = Math.min(text.length, from + WINDOW_CHARS);
    const windowText = text.length <= WINDOW_CHARS ? text : text.slice(from, to);
    const last = to >= text.length;
    // Where the next window's slice begins (absolute); a match that starts after it and touches this window's end is found whole there.
    const nextFrom = start + step - 1;
    PATTERNS.forEach((pattern, index) => {
      if (pattern.needs && !windowText.includes(pattern.needs)) return;
      for (const match of windowText.matchAll(pattern.re)) {
        if (from > 0 && match.index === 0) continue;
        const absolute = from + match.index;
        if (!last && match.index + match[0].length === windowText.length && absolute > nextFrom) continue;
        const key = `${index}:${absolute}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (pattern.allow?.(match)) continue;
        const markerKind = 'allowKind' in pattern ? pattern.allowKind : (MARKER_KINDS.includes(pattern.kind) ? pattern.kind : null);
        if (markerKind !== null && kindsAt(absolute)?.has(markerKind)) { if (!allowed.includes(markerKind)) allowed.push(markerKind); continue; }
        const excerpt = pattern.secret ? '[redacted]' : pattern.excerpt ? pattern.excerpt(match) : mask(match[0]).slice(0, 80);
        found.push({ kind: pattern.kind, excerpt });
      }
    });
    if (last) break;
  }
  for (const { entry, re } of expressions) {
    for (let count = [...text.matchAll(re)].length; count > 0; count--) found.push({ kind: 'term', excerpt: '[redacted]', termLine: entry.line });
  }
  return { found, allowed };
}

/** Scans one line of text: the findings of scanLineDetailed. */
export const scanLine = (text, terms = [], options = {}) => scanLineDetailed(text, terms, options).found;

/** The added lines of a unified diff (made with --unified=0): [{ file, line, text }] with the line number in the new file. Deleted files and binary files add none. */
export function addedLines(diff) {
  const added = [];
  let file = null, inHunk = false, next = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) { file = null; inHunk = false; continue; }
    if (!inHunk && raw.startsWith('+++ ')) {
      const target = raw.slice(4).replace(/\t.*$/, '');
      file = target === '/dev/null' ? null : target.replace(/^"|"$/g, '').replace(/^b\//, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { inHunk = true; next = Number(hunk[1]); continue; }
    if (!inHunk || file === null) continue;
    if (raw.startsWith('+')) { added.push({ file, line: next, text: raw.slice(1).replace(/\r$/, '') }); next++; } else if (raw.startsWith(' ')) next++;
  }
  return added;
}

const ALERT = /^> \[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

/** Checks pull request text. Returns { words, findings } where findings use file 'pr-body'. */
export function checkPrBody(text, terms = []) {
  const findings = [];
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  const first = lines.findIndex(line => line.trim() !== '');
  if (first === -1 || !ALERT.test(lines[first])) {
    findings.push({ kind: 'pr-body-alert', file: 'pr-body', line: first === -1 ? 1 : first + 1, excerpt: 'the first non-empty line must be a GitHub alert opener such as > [!NOTE]' });
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) findings.push({ kind: 'pr-body-words', file: 'pr-body', line: 1, excerpt: `${words} words; the limit is ${MAX_WORDS}` });
  lines.forEach((line, index) => { for (const hit of scanLine(line, terms)) findings.push({ ...hit, file: 'pr-body', line: index + 1 }); });
  return { words, findings };
}

/** Reads the command line. Returns { help: true }, or { usage: message }, or the options. */
export function parseArgs(argv) {
  const out = { help: false, usage: null, base: DEFAULT_BASE, prBody: null, termsFile: null, json: false, allowEmpty: false, allowIntermediateBinary: false };
  const bad = message => { out.usage = message; return out; };
  const BOOLEAN = { '--help': 'help', '-h': 'help', '--json': 'json', '--allow-empty': 'allowEmpty', '--allow-intermediate-binary': 'allowIntermediateBinary' };
  for (let i = 0; i < argv.length; i++) {
    const { flag, value: inline } = splitFlag(argv[i]);
    if (Object.hasOwn(BOOLEAN, flag)) {
      const refusal = boolValueRefusal(flag, inline);
      if (refusal) return bad(refusal);
      out[BOOLEAN[flag]] = true;
      continue;
    }
    if (flag !== '--base' && flag !== '--pr-body' && flag !== '--terms-file') return bad(`unknown argument: ${argv[i]}`);
    const flagLike = flagLikeValueRefusal(flag, inline);
    if (flagLike) return bad(flagLike);
    let value = inline;
    if (value === null) { value = argv[i + 1]; if (value === undefined || value.startsWith('--')) return bad(`${flag} needs a value`); i++; }
    if (flag === '--base') {
      if (value.startsWith('-')) return bad('--base must not start with -');
      out.base = value;
    } else if (flag === '--pr-body') out.prBody = value;
    else {
      if (!path.isAbsolute(value)) return bad('--terms-file needs an absolute path to a file outside the repository');
      out.termsFile = value;
    }
  }
  return out;
}

async function git(args, cwd, maxBytes = 4 * 1024 * 1024, options = {}) {
  const result = await runChild('git', args, { cwd, timeoutMs: 5 * 60 * 1000, maxBytes, ...options, env: { GIT_TERMINAL_PROMPT: '0', GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined } });
  return { ...result, ok: result.code === 0 && result.reason === null };
}

const realpath = target => fs.realpathSync.native(target);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const WITHHELD = '[path withheld]';
const failure = result => result.message ?? result.stderr.trim().split('\n')[0];

/** Reads `git diff --numstat -z` output: [{ path, binary }]. A binary file has "-" for both counts. */
export function parseNumstat(text) {
  return text.split('\0').filter(Boolean).map(record => {
    const [added, deleted, ...rest] = record.split('\t');
    return { path: rest.join('\t'), binary: added === '-' && deleted === '-' };
  }).filter(entry => entry.path !== '');
}

/** Splits the output of `git log -p --format=<marker><sha>` into [{ sha, lines }] where lines are the added lines of that commit's patch. */
export function patchAddedLines(output, marker) {
  const commits = [];
  let current = null;
  for (const raw of output.split('\n')) {
    if (raw.startsWith(marker)) { current = { sha: raw.slice(marker.length).trim(), text: [] }; commits.push(current); continue; }
    if (current) current.text.push(raw);
  }
  return commits.map(({ sha, text }) => ({ sha, lines: addedLines(text.join('\n')) }));
}

/** Reads `git log -z --format=%H%n%an%n%ae%n%cn%n%ce%n%B`: [{ sha, authorName, authorEmail, committerName, committerEmail, message }]. */
export function parseCommitRecords(output) {
  return output.split('\0').map(record => record.replace(/^\n/, '')).filter(record => record.trim() !== '').map(record => {
    const lines = record.split('\n');
    const [sha, authorName, authorEmail, committerName, committerEmail] = lines;
    return { sha, authorName, authorEmail, committerName, committerEmail, message: lines.slice(5).join('\n') };
  });
}

/** Runs the whole scan in `cwd`. Returns { exitCode, result } or { exitCode: 2, error }. */
export async function scanRepository(args, cwd = process.cwd()) {
  const top = await git(['rev-parse', '--show-toplevel'], cwd);
  if (!top.ok) return { exitCode: 2, error: 'this is not inside a git repository' };
  const repoRoot = realpath(top.stdout.trim());

  let terms = [];
  if (args.termsFile !== null) {
    let real;
    try { real = realpath(args.termsFile); } catch { return { exitCode: 2, error: 'the terms file cannot be read' }; }
    if (real === repoRoot || real.startsWith(repoRoot + path.sep)) return { exitCode: 2, error: 'the terms file must be outside the repository' };
    try { terms = parseTerms(fs.readFileSync(real, 'utf8')); } catch { return { exitCode: 2, error: 'the terms file cannot be read' }; }
    if (terms.length === 0) return { exitCode: 2, error: 'the terms file has no terms (only blank lines and comments); a scan that checks no terms would pass for the wrong reason' };
  }
  let body = null;
  if (args.prBody !== null) {
    try { body = fs.readFileSync(args.prBody, 'utf8'); } catch { return { exitCode: 2, error: 'the PR body file cannot be read' }; }
  }
  const known = await git(['rev-parse', '--verify', '--quiet', `${args.base}^{commit}`], repoRoot);
  if (!known.ok) return { exitCode: 2, error: `the base ${JSON.stringify(args.base)} is not a commit in this repository` };

  const range = `${args.base}...HEAD`;
  const commitRange = `${args.base}..HEAD`;
  const diffFlags = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '--unified=0'];
  const diff = await git(['-c', 'core.quotepath=false', 'diff', ...diffFlags, range], repoRoot, MAX_DIFF_BYTES);
  if (!diff.ok) return { exitCode: 2, error: `git diff failed: ${failure(diff)}` };
  const names = await git(['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', range], repoRoot, MAX_DIFF_BYTES);
  if (!names.ok) return { exitCode: 2, error: `git diff --name-only failed: ${failure(names)}` };
  const numstat = await git(['diff', '--numstat', '-z', '--diff-filter=d', '--no-renames', '--no-ext-diff', '--no-textconv', range], repoRoot, MAX_DIFF_BYTES);
  if (!numstat.ok) return { exitCode: 2, error: `git diff --numstat failed: ${failure(numstat)}` };
  const added = await git(['log', '--numstat', '-z', '--diff-filter=AM', '--no-renames', '--no-ext-diff', '--no-textconv', '--format=', commitRange], repoRoot, MAX_DIFF_BYTES);
  if (!added.ok) return { exitCode: 2, error: `git log --numstat failed: ${failure(added)}` };
  const log = await git(['log', '-z', '--format=%H%n%an%n%ae%n%cn%n%ce%n%B', commitRange], repoRoot, MAX_DIFF_BYTES);
  if (!log.ok) return { exitCode: 2, error: `git log failed: ${failure(log)}` };
  const marker = `patch-${crypto.randomBytes(16).toString('hex')}-`;
  const patches = await git(['-c', 'core.quotepath=false', 'log', '-p', ...diffFlags, `--format=${marker}%H`, commitRange], repoRoot, MAX_PATCH_BYTES);
  if (!patches.ok) return { exitCode: 2, error: `git log -p failed: ${failure(patches)}` };

  const findings = [];
  const allowedLines = [];
  // A file name that holds a leak (or a term) is never printed, in any kind of finding.
  const shownNames = new Map();
  const safeName = name => {
    if (!shownNames.has(name)) shownNames.set(name, scanLine(name, terms).length ? WITHHELD : name);
    return shownNames.get(name);
  };
  const add = (hits, file, line, commit = null) => {
    const shown = file === 'file-path' || file === 'pr-body' || file.startsWith('commit:') ? file : safeName(file);
    for (const hit of hits) findings.push({ kind: hit.kind, file: shown, line, excerpt: hit.excerpt, ...(commit ? { commit } : {}), ...(hit.termLine ? { termLine: hit.termLine } : {}) });
  };
  // The added lines of the diff are the only place the allow marker is honoured. A marker that skipped something is listed in allowedLines.
  const addDiffLine = (entry, commit = null) => {
    const { found, allowed } = scanLineDetailed(entry.text, terms, { allowMarker: true });
    add(found, entry.file, entry.line, commit);
    for (const kind of allowed) allowedLines.push({ file: safeName(entry.file), line: entry.line, kind, ...(commit ? { commit } : {}) });
  };
  // The net diff first. A line that it holds is not scanned again from a commit patch.
  const lines = addedLines(diff.stdout);
  const seen = new Set();
  for (const entry of lines) { seen.add(`${entry.file}\0${entry.text}`); addDiffLine(entry); }
  // A path can hold a leak too. The finding names no path: its line is the position in `git diff --name-only`.
  const paths = names.stdout.split('\0').filter(Boolean);
  paths.forEach((name, index) => add(scanLine(name, terms), 'file-path', index + 1));

  // Binary files the range adds or changes: scan the HEAD blob.
  const binaryNames = parseNumstat(numstat.stdout).filter(entry => entry.binary).map(entry => entry.path);
  const binaryScanned = [], unscanned = [];
  for (const name of binaryNames) {
    const shown = safeName(name);
    const size = await git(['cat-file', '-s', `HEAD:${name}`], repoRoot);
    if (!size.ok || !/^\d+$/.test(size.stdout.trim())) { unscanned.push({ file: shown, reason: 'the blob could not be read' }); continue; }
    if (Number(size.stdout.trim()) > MAX_BINARY_BYTES) { unscanned.push({ file: shown, reason: `larger than the ${MAX_BINARY_BYTES / 1024 / 1024} MiB scan cap (${size.stdout.trim()} bytes)` }); continue; }
    const blob = await git(['cat-file', 'blob', `HEAD:${name}`], repoRoot, MAX_BINARY_BYTES + 1, { encoding: 'latin1' });
    if (!blob.ok) { unscanned.push({ file: shown, reason: 'the blob could not be read' }); continue; }
    binaryScanned.push(shown);
    // A binary file is read line by line and never honours the allow marker.
    blob.stdout.split(/\r\n|\r|\n/).forEach((text, index) => add(scanLine(text, terms), name, index + 1));
  }

  // A binary file that some commit added or changed but that the net diff does not carry (it was removed again, or put back) is never read.
  const netBinary = new Set(binaryNames);
  const binaryIntermediate = [...new Set(parseNumstat(added.stdout).filter(entry => entry.binary && !netBinary.has(entry.path)).map(entry => entry.path))].map(safeName);

  const commits = parseCommitRecords(log.stdout);
  for (const record of commits) {
    const label = `commit:${record.sha.slice(0, 7)}`;
    for (const text of new Set([record.authorName, record.authorEmail, record.committerName, record.committerEmail])) add(scanLine(text, terms), label, 0);
    record.message.split('\n').forEach((line, index) => add(scanLine(line.replace(/\r$/, ''), terms), label, index + 1));
  }

  // Every commit patch: a line that was added and later removed is in no net diff, but it was published with the branch.
  const patchCommits = patchAddedLines(patches.stdout, marker);
  let patchLines = 0;
  for (const { sha, lines: added } of patchCommits) {
    patchLines += added.length;
    for (const entry of added) {
      const key = `${entry.file}\0${entry.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      addDiffLine(entry, sha.slice(0, 7));
    }
  }

  let prBody = null;
  if (body !== null) {
    const checked = checkPrBody(body, terms);
    prBody = { checked: true, words: checked.words };
    findings.push(...checked.findings.map(({ kind, file, line, excerpt, termLine }) => ({ kind, file, line, excerpt, ...(termLine ? { termLine } : {}) })));
  }

  const counts = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  const empty = commits.length === 0 || (lines.length === 0 && patchLines === 0 && binaryScanned.length === 0 && unscanned.length === 0);
  const emptyNote = empty ? `the range ${args.base}...HEAD has ${commits.length === 0 ? 'no commits' : 'no added lines'}; nothing was scanned (use --allow-empty to accept that)` : null;
  const intermediateRefused = binaryIntermediate.length > 0 && !args.allowIntermediateBinary;
  const result = {
    ok: findings.length === 0 && unscanned.length === 0 && !intermediateRefused && (!empty || args.allowEmpty), base: args.base, commits: commits.length, files: new Set(lines.map(l => l.file)).size, addedLines: lines.length,
    patchLines, paths: paths.length, binaryFiles: binaryNames.length, binaryScanned, binaryIntermediate, intermediateRefused, binaryNote: BINARY_NOTE,
    allowedLines: { count: allowedLines.length, items: allowedLines.slice(0, MAX_FINDINGS) }, unscanned, empty, emptyNote: args.allowEmpty ? null : emptyNote,
    termsChecked: args.termsFile === null ? null : terms.length, prBody, counts, findings: findings.slice(0, MAX_FINDINGS), truncated: findings.length > MAX_FINDINGS, total: findings.length,
  };
  return { exitCode: result.ok ? 0 : 1, result };
}


/** The short text a person reads: the totals, the terms line, any warnings, then the first findings. */
export function formatResult(result) {
  const lines = [];
  const unscannedText = result.unscanned.length ? `${plural(result.unscanned.length, 'unscanned binary file')}: ${result.unscanned.slice(0, 5).map(u => `${u.file} (${u.reason})`).join(', ')}` : null;
  const intermediate = result.binaryIntermediate ?? [];
  const intermediateText = intermediate.length > 0 ? `${plural(intermediate.length, 'binary file')} ${intermediate.length === 1 ? 'was' : 'were'} added and removed again inside the range and ${intermediate.length === 1 ? 'was' : 'were'} never scanned: ${intermediate.slice(0, 5).join(', ')}${intermediate.length > 5 ? ', ...' : ''}` : null;
  const refusedText = result.intermediateRefused && intermediateText ? `${intermediateText}. Use --allow-intermediate-binary to accept that.` : null;
  if (result.ok && result.empty) lines.push(`public-scan: nothing to scan (${plural(result.commits, 'commit')}, ${plural(result.addedLines, 'added line')}; accepted by --allow-empty)`);
  else if (result.ok) lines.push(`public-scan: clean (${plural(result.commits, 'commit')}, ${plural(result.addedLines, 'added line')} in ${plural(result.files, 'file')}${result.patchLines > result.addedLines ? `; ${plural(result.patchLines, 'patch line')} across all commits` : ''})`);
  else if (result.total === 0) lines.push(`public-scan: NOT CLEAN. ${[result.emptyNote, unscannedText, refusedText].filter(Boolean).join(' ')}`);
  else {
    const kinds = Object.entries(result.counts).map(([kind, n]) => `${kind} ${n}`).join(', ');
    lines.push(`public-scan: ${result.total} findings (${kinds})`);
    for (const f of result.findings.slice(0, MAX_SHOWN)) lines.push(`  ${f.kind} ${f.file}:${f.line} ${f.excerpt}${f.commit ? ` (in commit ${f.commit})` : ''}${f.termLine ? ` (terms file line ${f.termLine})` : ''}`);
    if (result.total > MAX_SHOWN) lines.push(`  ... and ${result.total - MAX_SHOWN} more; use --json for the list`);
    if (result.emptyNote) lines.push(`public-scan: ${result.emptyNote}`);
    if (unscannedText || refusedText) lines.push(`public-scan: NOT CLEAN. ${[unscannedText, refusedText].filter(Boolean).join(' ')}`);
  }
  lines.push(result.termsChecked === null ? 'terms: NOT checked' : `terms: ${result.termsChecked} checked`);
  lines.push(`binary: ${(result.binaryNote ?? BINARY_NOTE).replace(/^binary /, '')}`);
  if (intermediateText) lines.push(`warning: ${intermediateText}`);
  const allowed = result.allowedLines?.items ?? [];
  if ((result.allowedLines?.count ?? 0) > 0) lines.push(`allowed: ${plural(result.allowedLines.count, 'line')} skipped by a marker: ${allowed.slice(0, 5).map(a => `${a.file}:${a.line} ${a.kind}`).join(', ')}${result.allowedLines.count > 5 ? ', ...' : ''}`);
  if (result.binaryScanned.length > 0) lines.push(`binary: ${plural(result.binaryScanned.length, 'file')} scanned from its HEAD blob: ${result.binaryScanned.slice(0, 5).join(', ')}${result.binaryScanned.length > 5 ? ', ...' : ''}`);
  return lines.join('\n') + '\n';
}

/** Entry point. Returns the exit code. */
export async function main(argv, out = process.stdout, err = process.stderr) {
  const json = jsonWanted(argv);
  return guarded('public-scan', { json, out, err }, async () => {
    const args = parseArgs(argv);
    if (args.help) { out.write(USAGE + '\n'); return 0; }
    if (args.usage) return reportUsage('public-scan', args.usage, USAGE, { json, out, err });
    const scanned = await scanRepository(args);
    if (scanned.error) return reportUsage('public-scan', scanned.error, USAGE.split('\n')[0], { json, out, err });
    out.write(args.json ? JSON.stringify(scanned.result) + '\n' : formatResult(scanned.result));
    return scanned.exitCode;
  });
}

const entry = entryState(process.argv[1], import.meta.url);
if (entry === 'main') {
  installInterruptHandlers();
  process.exitCode = await main(process.argv.slice(2));
} else if (entry === 'mismatch') {
  process.stderr.write(mismatchMessage('public-scan', process.argv[1], import.meta.url));
  process.exitCode = 2;
}
