#!/usr/bin/env node
// Release tooling, never shipped. Safety class: read-only (it runs git diff and git log, and reads the files it is given).
// Checks that a branch and its pull request text leak no private detail into a public repository:
//   node tools/public-scan.mjs [--base REF] [--pr-body FILE] [--terms-file ABS_FILE] [--allow-empty] [--json]
// (a) The added lines of `git diff <base>...HEAD`, the added lines of EVERY commit patch in `<base>..HEAD` (so a secret added in one commit and removed in a later one
//     is still found), the file paths the diff touches, every commit message in `<base>..HEAD`, and the author and committer name and address of each of those
//     commits are scanned for structural leaks only: home paths, session links and ids, scratch folders, email addresses, and likely secrets (token shapes, JWTs,
//     Slack and Google keys, _authToken and password assignments, private key headers).
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
// Only committed work is scanned: a change that is not committed is not in `<base>...HEAD`. A binary file added and removed again inside the branch is not scanned (only
// the HEAD blob of a binary file the net diff adds is).
// Exit 0: nothing found. Exit 1: findings, an unscanned binary file, or an empty range. Exit 2: wrong use, an unreadable base or repository, or an internal error
// (with --json, one object {ok:false, exit:2, error}). Exit 130: interrupted.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChild } from './lib/run-child.mjs';
import { splitFlag, jsonWanted, boolValueRefusal, flagLikeValueRefusal, reportUsage, guarded, entryState, mismatchMessage } from './lib/cli.mjs';
import { installInterruptHandlers } from './lib/interrupt.mjs';

export const DEFAULT_BASE = 'origin/release/0.8.0-beta.2';
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

const USAGE = `Usage: node tools/public-scan.mjs [--base REF] [--pr-body FILE] [--terms-file ABS_FILE] [--allow-empty] [--json]
  --base REF           scan git diff REF...HEAD and the commits REF..HEAD (default ${DEFAULT_BASE})
  --pr-body FILE       check the pull request text: alert opener first, at most ${MAX_WORDS} words, no leaks
  --terms-file ABS_FILE  private terms, one per line, in a file outside the repository; findings never print a term
  --allow-empty        accept a range with no commits or nothing added (otherwise exit 1)
  --json               print one JSON object on stdout (also for a usage error: {ok:false, exit:2, error})
A flag that takes no value rejects one: --json=x is a usage error.
Exit 0: nothing found. Exit 1: findings, an unscanned binary file, or an empty range. Exit 2: wrong use. Exit 130: interrupted.`;

// Names that stand for "a person" in an example. Anything in angle brackets never matches the patterns below, because a name must start with a letter or digit.
const PLACEHOLDER_NAMES = new Set(['you', 'user', 'name', 'example', 'username', 'me', 'runner', 'shared', 'public', 'default']);
const NAME = String.raw`([A-Za-z0-9][^/\\\s'"` + '`' + String.raw`)\]>:*,;]*)`;
const AFTER_UNIX = String.raw`(?=[/\s'"` + '`' + String.raw`)\]>:,;]|$)`;
const AFTER_WIN = String.raw`(?=[\\\s'"` + '`' + String.raw`)\]>:,;]|$)`;
const BEFORE = String.raw`(?<![A-Za-z0-9_])`;

const allowedPlaceholder = match => PLACEHOLDER_NAMES.has(match[1].toLowerCase());
const ALLOWED_EMAIL = /(?:@example\.com|@users\.noreply\.github\.com|^noreply@anthropic\.com|^noreply@github\.com|^git@github\.com)$/i;
// A value that only stands for a secret: an environment reference, an angle-bracket or template placeholder, or a row of mask characters.
const PLACEHOLDER_VALUE = /^(?:\$|<|\{\{|%|\*+$|x+$|\.+$)/i;

// Each pattern: a kind, an expression (global), an optional `allow(match)`, and how the excerpt is written. Excerpts of secrets never hold the match, and
// the excerpt of a home path or an email is a constant, so a real name or address is never printed.
// The expressions are written so that this file does not match them itself (escaped slashes, split literals, one-letter classes).
const HOME_EXCERPT = { 'unix-users': '/Us' + 'ers/[name]', 'unix-home': '/ho' + 'me/[name]', windows: 'C:\\Us' + 'ers\\[name]' };
const PATTERNS = [
  { kind: 'home-path', re: new RegExp(BEFORE + String.raw`\/Users\/` + NAME + AFTER_UNIX, 'g'), allow: allowedPlaceholder, excerpt: () => HOME_EXCERPT['unix-users'] },
  { kind: 'home-path', re: new RegExp(BEFORE + String.raw`\/home\/` + NAME + AFTER_UNIX, 'g'), allow: allowedPlaceholder, excerpt: () => HOME_EXCERPT['unix-home'] },
  { kind: 'home-path', re: new RegExp(String.raw`[A-Za-z]:\\{1,2}Users\\{1,2}` + NAME + AFTER_WIN, 'gi'), allow: allowedPlaceholder, excerpt: () => HOME_EXCERPT.windows },
  { kind: 'session-link', re: /claude\.ai\/code\/session/g, excerpt: () => 'claude.ai/code/' + 'session…' },
  { kind: 'tmp-path', re: /\/tmp\/claude-/g, excerpt: () => '/tmp/' + 'claude-…' },
  { kind: 'session-id', re: /(?<![A-Za-z0-9])local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, excerpt: () => 'local_[id]' },
  // The local part is anchored (nothing local-looking before it) and capped at 64 characters, as in RFC 5321, so a long run cannot cost quadratic time.
  { kind: 'email', re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, needs: '@', allow: match => ALLOWED_EMAIL.test(match[0]), excerpt: () => '[redacted]@domain' },
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
  { kind: 'secret', re: /_auth(?:T[o]ken)?\s*=\s*[^\s'"]{3,}/gi, needs: '=', secret: true, allow: match => PLACEHOLDER_VALUE.test(match[0].replace(/^[^=]*=\s*/, '')) },
  { kind: 'secret', re: /pass[w]ord\s*=\s*[^\s'"]{3,}/gi, needs: '=', secret: true, allow: match => PLACEHOLDER_VALUE.test(match[0].replace(/^[^=]*=\s*/, '')) },
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
 * Returns [{ kind, excerpt, termLine? }]. A secret or a term is never in an excerpt, and a term that sits inside another finding is masked there too.
 */
export function scanLine(text, terms = []) {
  const found = [];
  const expressions = terms.map(entry => ({ entry, re: termExpression(entry.term) }));
  const mask = value => expressions.reduce((current, { re }) => current.replace(re, '[redacted]'), value);
  const seen = new Set();
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
        const excerpt = pattern.secret ? '[redacted]' : pattern.excerpt ? pattern.excerpt(match) : mask(match[0]).slice(0, 80);
        found.push({ kind: pattern.kind, excerpt });
      }
    });
    if (last) break;
  }
  for (const { entry, re } of expressions) {
    for (let count = [...text.matchAll(re)].length; count > 0; count--) found.push({ kind: 'term', excerpt: '[redacted]', termLine: entry.line });
  }
  return found;
}

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
  const out = { help: false, usage: null, base: DEFAULT_BASE, prBody: null, termsFile: null, json: false, allowEmpty: false };
  const bad = message => { out.usage = message; return out; };
  const BOOLEAN = { '--help': 'help', '-h': 'help', '--json': 'json', '--allow-empty': 'allowEmpty' };
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
  const log = await git(['log', '-z', '--format=%H%n%an%n%ae%n%cn%n%ce%n%B', commitRange], repoRoot, MAX_DIFF_BYTES);
  if (!log.ok) return { exitCode: 2, error: `git log failed: ${failure(log)}` };
  const marker = `patch-${crypto.randomBytes(16).toString('hex')}-`;
  const patches = await git(['-c', 'core.quotepath=false', 'log', '-p', ...diffFlags, `--format=${marker}%H`, commitRange], repoRoot, MAX_PATCH_BYTES);
  if (!patches.ok) return { exitCode: 2, error: `git log -p failed: ${failure(patches)}` };

  const findings = [];
  const add = (hits, file, line, commit = null) => {
    for (const hit of hits) findings.push({ kind: hit.kind, file, line, excerpt: hit.excerpt, ...(commit ? { commit } : {}), ...(hit.termLine ? { termLine: hit.termLine } : {}) });
  };
  // The net diff first. A line that it holds is not scanned again from a commit patch.
  const lines = addedLines(diff.stdout);
  const seen = new Set();
  for (const entry of lines) { seen.add(`${entry.file}\0${entry.text}`); add(scanLine(entry.text, terms), entry.file, entry.line); }
  // A path can hold a leak too. The finding names no path: its line is the position in `git diff --name-only`.
  const paths = names.stdout.split('\0').filter(Boolean);
  paths.forEach((name, index) => add(scanLine(name, terms), 'file-path', index + 1));
  const safeName = name => (scanLine(name, terms).length ? WITHHELD : name);

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
    add(scanLine(blob.stdout, terms), shown, 0);
  }

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
      add(scanLine(entry.text, terms), entry.file, entry.line, sha.slice(0, 7));
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
  const result = {
    ok: findings.length === 0 && unscanned.length === 0 && (!empty || args.allowEmpty), base: args.base, commits: commits.length, files: new Set(lines.map(l => l.file)).size, addedLines: lines.length,
    patchLines, paths: paths.length, binaryFiles: binaryNames.length, binaryScanned, unscanned, empty, emptyNote: args.allowEmpty ? null : emptyNote,
    termsChecked: args.termsFile === null ? null : terms.length, prBody, counts, findings: findings.slice(0, MAX_FINDINGS), truncated: findings.length > MAX_FINDINGS, total: findings.length,
  };
  return { exitCode: result.ok ? 0 : 1, result };
}


/** The short text a person reads: the totals, the terms line, any warnings, then the first findings. */
export function formatResult(result) {
  const lines = [];
  const unscannedText = result.unscanned.length ? `${plural(result.unscanned.length, 'unscanned binary file')}: ${result.unscanned.slice(0, 5).map(u => `${u.file} (${u.reason})`).join(', ')}` : null;
  if (result.ok && result.empty) lines.push(`public-scan: nothing to scan (${plural(result.commits, 'commit')}, ${plural(result.addedLines, 'added line')}; accepted by --allow-empty)`);
  else if (result.ok) lines.push(`public-scan: clean (${plural(result.commits, 'commit')}, ${plural(result.addedLines, 'added line')} in ${plural(result.files, 'file')}${result.patchLines > result.addedLines ? `; ${plural(result.patchLines, 'patch line')} across all commits` : ''})`);
  else if (result.total === 0) lines.push(`public-scan: NOT CLEAN. ${[result.emptyNote, unscannedText].filter(Boolean).join(' ')}`);
  else {
    const kinds = Object.entries(result.counts).map(([kind, n]) => `${kind} ${n}`).join(', ');
    lines.push(`public-scan: ${result.total} findings (${kinds})`);
    for (const f of result.findings.slice(0, MAX_SHOWN)) lines.push(`  ${f.kind} ${f.file}:${f.line} ${f.excerpt}${f.commit ? ` (in commit ${f.commit})` : ''}${f.termLine ? ` (terms file line ${f.termLine})` : ''}`);
    if (result.total > MAX_SHOWN) lines.push(`  ... and ${result.total - MAX_SHOWN} more; use --json for the list`);
    if (result.emptyNote) lines.push(`public-scan: ${result.emptyNote}`);
    if (unscannedText) lines.push(`public-scan: NOT CLEAN. ${unscannedText}`);
  }
  lines.push(result.termsChecked === null ? 'terms: NOT checked' : `terms: ${result.termsChecked} checked`);
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
