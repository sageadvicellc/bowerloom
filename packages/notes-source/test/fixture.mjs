// Shared helpers for the notes-source tests. Synthetic data only: no real wiki, no real people, no private paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findGit, NotesRefusal } from '../../../dist/packages/notes-source/src/index.js';

/** A fresh folder under the system temporary folder, by its real path, removed when the test ends. */
export function tempDir(t, prefix = 'bowerloom-notes-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => { makeWritable(dir); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
/** Gives the owner back read and write on every folder, so a test that removed a permission can still be cleaned up. */
function makeWritable(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      try { fs.chmodSync(p, entry.isDirectory() ? 0o700 : 0o600); } catch { /* gone */ }
      if (entry.isDirectory()) makeWritable(p);
    }
  } catch { /* gone */ }
}

/** The git that the package finds on this machine, or null. */
export const GIT = (() => { try { return findGit(); } catch { return null; } })();
/** The skip reason for a test that needs real git. */
export const needsGit = GIT ? false : 'git is not installed at a path Bowerloom trusts (Command Line Tools or Xcode on macOS, /usr/bin or /bin on Linux), so the real-git tests are skipped';

const enc = text => new TextEncoder().encode(text);
/** A synthetic starter template, the shape lane K's template arrives in: a list of { path, bytes }. */
export function template() {
  return [
    { path: 'AGENTS.md', bytes: enc('# How these notes work\n\nPages live in pages/. Sources live in sources/.\n') },
    { path: 'index.md', bytes: enc('# Index\n') },
    { path: 'log.md', bytes: enc('# Log\n') },
    { path: 'sources/README.md', bytes: enc('# Sources\n') },
    { path: 'pages/README.md', bytes: enc('# Pages\n') },
    { path: 'reports/README.md', bytes: enc('# Reports\n') },
  ];
}

/** Writes a file and its folders. */
export function put(dir, rel, text = `# ${rel}\n`) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** Runs the test's own git, outside the package, with no global or system config. Returns trimmed stdout. */
export function ownGit(dir, args) {
  return execFileSync(GIT.path, args, {
    cwd: dir, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir },
  }).trim();
}

/** Asserts a function or promise refuses with one NOTES_ code. */
export const refusal = code => e => e instanceof NotesRefusal && e.code === code && /^NOTES_[A-Z_]+$/.test(e.code);

/** The test's own count of pages: every non-hidden *.md plain file, under non-hidden folders, never through a link. */
export function walkPages(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) n += walkPages(path.join(dir, entry.name));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) n += 1;
  }
  return n;
}

/** Writes an executable script owned by this user, mode 0755. Used as a stand-in git. */
export function script(dir, name, body) {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  fs.chmodSync(abs, 0o755);
  return abs;
}
