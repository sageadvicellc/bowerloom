#!/usr/bin/env node
// Step 5, item 2 (blueprint section F): copy an allowlist of a real tree into a scratch root, for the read-only run.
// Tooling for the repository, never shipped (tools/cli-distribution/pack.mjs packs dist/ and release assets only).
//
//   node tools/step5/scratch-copy.mjs <source-tree> <scratch-root> [--min-free-bytes <n>]
//
// The scratch root is a new folder directly below the system temp folder, named bowerloom-step5-<anything>. It gets mode
// 0700 and holds home/, state/, tree/work tree/ (the copy, with a space in its name on purpose), and scratch.json.
// Rules this file keeps:
// - Only regular files of 1 MiB or less are copied, found with lstat and opened without following a link. A link is
//   listed and never followed, whatever it points at.
// - Only the allowlist is copied. The skip list wins over the allowlist.
// - .claude/settings.local.json is copied only when the secret scan of the contract finds no value in it. Otherwise the
//   report names the path and the rule, and never the value.
// - The hash of every source file read is taken before the copy and again after it. A difference is a finding.
// - At least 12 GiB of the disk stays free after the copy. The check runs before anything is created.
// - The report holds paths and counts, never file contents.
import { createHash } from 'node:crypto';
import { constants as K, chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanSecrets } from '../../dist/packages/harness-definition/src/index.js';

export const MAX_FILE_BYTES = 1024 * 1024;
export const DEFAULT_FLOOR_BYTES = 12 * 2 ** 30;
export const ROOT_PREFIX = 'bowerloom-step5-';
export const TREE_NAME = 'work tree';
export const MANIFEST_FORMAT = 'bowerloom/step5-scratch/v1';
const MAX_ENTRIES = 5_000_000, MAX_DEPTH = 24, LISTED_CAP = 200;

/** A refusal with a short code. The message never holds a path. */
export class ScratchError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'ScratchError'; }
}
const refuse = (code, message) => { throw new ScratchError(code, message); };

// ---- the lists ----------------------------------------------------------------------------------------------------------

const ROOT_FILES = [/^AGENTS\.md$/, /^AGENTS\.override\.md$/, /^AGENTS\.local\.md$/, /^CLAUDE\.md/, /^\.mcp\.json$/, /^opencode\.json/];
const ROOT_DIRS = new Set(['.bowerloom', '.claude', '.agents', '.codex', '.opencode', '.pi', '.dsh']);
const CODEX_CHILDREN = new Set(['config.toml', 'rules', 'hooks.json', 'agents', 'prompts']);
const NESTED_NAMES = new Set(['AGENTS.md', 'AGENTS.override.md', 'AGENTS.local.md', 'CLAUDE.md', 'CLAUDE.local.md']);
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', '.worktrees', 'archive', '.paperclip', '.hermes', '.qmd', 'test-results']);
const SETTINGS_LOCAL = '.claude/settings.local.json';

/** The name of the skip rule that matches a file or folder name, or null. The skip list wins over the allowlist. */
export function skipRule(name) {
  const n = name.toLowerCase();
  if (SKIPPED_FOLDERS.has(n)) return 'skipped-folder';
  if (n.startsWith('.env')) return 'env-file';
  if (/\.(pem|key|p12)$/.test(n)) return 'key-file';
  if (n.startsWith('id_')) return 'ssh-key';
  if (n.includes('keychain')) return 'keychain';
  if (n === '.netrc' || n === '.npmrc' || n === 'auth.json' || n.startsWith('credentials')) return 'credentials-file';
  if (n.includes('token') || n.includes('secret')) return 'secret-name';
  if (n.includes('.sqlite')) return 'database';
  return null;
}
const isRootFile = name => ROOT_FILES.some(r => r.test(name));

// ---- reading without following links -----------------------------------------------------------------------------------

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** The bytes and mode of a regular file of at most 1 MiB, opened without following a link. Null when it is none of that. */
export function readRegular(full) {
  let fd;
  try { fd = openSync(full, K.O_RDONLY | K.O_NOFOLLOW); } catch { return null; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const bytes = Buffer.alloc(st.size);
    let at = 0;
    while (at < st.size) { const n = readSync(fd, bytes, at, st.size - at, at); if (n === 0) break; at += n; }
    return at === st.size ? { bytes, mode: st.mode & 0o777 } : null;
  } finally { closeSync(fd); }
}
/** The hash of each file by relative path, or `missing`. Used before and after the copy. */
export function hashFiles(source, rels) {
  const out = {};
  for (const rel of rels) { const r = readRegular(join(source, ...rel.split('/'))); out[rel] = r === null ? 'missing' : sha256(r.bytes); }
  return out;
}

// ---- the plan: a read of the source, with no write ----------------------------------------------------------------------

/**
 * Walks the source and lists what would be copied. Nothing is written. `files` holds regular files within the size limit,
 * `links` every link met (never followed), `skipped` every entry a rule left out, and `withheld` a settings.local.json
 * that held a secret value (the rule names only).
 */
export function planCopy(source, { maxEntries = MAX_ENTRIES, maxDepth = MAX_DEPTH } = {}) {
  const files = [], links = [], skipped = [], withheld = [];
  let seen = 0, stopped = null;
  const skip = (rel, rule) => skipped.push({ rel, rule });
  const list = rel => { try { return readdirSync(rel === '' ? source : join(source, ...rel.split('/'))).sort(); } catch { return []; } };
  const stat = rel => { try { return lstatSync(join(source, ...rel.split('/'))); } catch { return null; } };
  const count = n => { seen += n; if (seen > maxEntries) { stopped ??= 'the walk reached its limit of folder entries'; return false; } return true; };
  const keep = (rel, st) => {
    if (!st.isFile()) { skip(rel, 'not-a-regular-file'); return; }
    if (st.size > MAX_FILE_BYTES) { skip(rel, 'too-large'); return; }
    if (rel === SETTINGS_LOCAL) {
      const r = readRegular(join(source, ...rel.split('/')));
      if (r === null) { skip(rel, 'unreadable'); return; }
      const rules = [...new Set(scanSecrets([{ path: basename(rel), bytes: r.bytes }]).map(f => f.rule))].sort();
      if (rules.length) { withheld.push({ rel, rules }); return; }
    }
    files.push({ rel, size: st.size });
  };

  // An allowlisted folder: everything in it, apart from the skip list and the folders the blueprint leaves out.
  const tree = (rel, depth) => {
    if (stopped) return;
    if (depth > maxDepth) { stopped = 'a folder was deeper than the walk goes'; return; }
    const names = list(rel);
    if (!count(names.length)) return;
    for (const name of names) {
      const child = `${rel}/${name}`, rule = skipRule(name);
      if (rule) { skip(child, rule); continue; }
      const st = stat(child);
      if (st === null) continue;
      if (st.isSymbolicLink()) { links.push(child); continue; }
      if (rel === '.claude' && name === 'worktrees') { skip(child, 'worktrees'); continue; }
      if (rel === '.codex' && !CODEX_CHILDREN.has(name)) { skip(child, 'not-allowlisted'); continue; }
      if (st.isDirectory()) tree(child, depth + 1); else keep(child, st);
    }
  };
  // Anywhere else: only the nested instruction files, found without entering a skipped folder or following a link.
  const nested = (rel, depth) => {
    if (stopped) return;
    if (depth > maxDepth) { stopped = 'a folder was deeper than the walk goes'; return; }
    const names = list(rel);
    if (!count(names.length)) return;
    for (const name of names) {
      const child = rel === '' ? name : `${rel}/${name}`, rule = skipRule(name);
      if (rule) { skip(child, rule); continue; }
      const st = stat(child);
      if (st === null) continue;
      if (st.isSymbolicLink()) { links.push(child); continue; }
      if (st.isDirectory()) nested(child, depth + 1);
      else if (NESTED_NAMES.has(name)) keep(child, st);
    }
  };

  const top = list('');
  count(top.length);
  for (const name of top) {
    const rule = skipRule(name);
    if (rule) { skip(name, rule); continue; }
    const st = stat(name);
    if (st === null) continue;
    if (st.isSymbolicLink()) { links.push(name); continue; }
    if (st.isDirectory()) { if (ROOT_DIRS.has(name)) tree(name, 1); else nested(name, 1); } else if (isRootFile(name)) keep(name, st);
  }
  const byRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  files.sort(byRel); skipped.sort(byRel); withheld.sort(byRel); links.sort();
  return { files, links, skipped, withheld, bytes: files.reduce((n, f) => n + f.size, 0), stopped };
}

// ---- the scratch root --------------------------------------------------------------------------------------------------

/** Free bytes for a normal user on the disk that holds a folder. */
export function freeBytes(dir) { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); }

const within = (path, folder) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
/** The real path of the system temp folder. */
export const tempReal = () => realpathSync(tmpdir());

/**
 * Checks that a scratch root is a new (or empty) folder directly below the system temp folder, named bowerloom-step5-*,
 * and apart from the source. Returns its real parent.
 */
export function checkRoot(root, source) {
  if (typeof root !== 'string' || !root.startsWith(sep)) refuse('ROOT_NOT_ABSOLUTE', 'The scratch root must be an absolute path.');
  if (!basename(root).startsWith(ROOT_PREFIX)) refuse('ROOT_NAME', `The scratch root must be named ${ROOT_PREFIX}<anything>.`);
  let parent;
  try { parent = realpathSync(dirname(root)); } catch { refuse('ROOT_PARENT', 'The folder that holds the scratch root does not exist.'); }
  if (parent !== tempReal()) refuse('ROOT_OUTSIDE_TEMP', 'The scratch root must be directly below the system temp folder.');
  const real = join(parent, basename(root));
  if (source !== undefined && (within(real, source) || within(source, real))) refuse('ROOT_OVERLAPS_SOURCE', 'The scratch root and the source tree must be apart.');
  let st = null;
  try { st = lstatSync(real); } catch { /* new */ }
  if (st !== null) {
    if (st.isSymbolicLink() || !st.isDirectory()) refuse('ROOT_NOT_EMPTY', 'The scratch root exists and is not an empty folder.');
    if (readdirSync(real).length) refuse('ROOT_NOT_EMPTY', 'The scratch root exists and is not empty.');
  }
  return real;
}
/** The real path of the source tree. */
export function checkSource(source) {
  if (typeof source !== 'string' || !source.startsWith(sep)) refuse('SOURCE_NOT_ABSOLUTE', 'The source tree must be an absolute path.');
  let real;
  try { real = realpathSync(source); if (!lstatSync(real).isDirectory()) throw new Error('x'); } catch { refuse('SOURCE_MISSING', 'The source tree is not a folder.'); }
  return real;
}
/** The guard of the read-only run: a folder to run in must be the copy, or inside the copy, of this scratch root. */
export function guardDir(dir, root) {
  const tree = join(realpathSync(root), 'tree');
  let real;
  try { real = realpathSync(dir); } catch { refuse('DIR_OUTSIDE_SCRATCH', 'The folder is not inside the scratch root.'); }
  if (!within(real, tree) || real === tree) refuse('DIR_OUTSIDE_SCRATCH', 'The folder is not inside the scratch root.');
  return real;
}

// ---- the copy ----------------------------------------------------------------------------------------------------------

/**
 * Copies the allowlist. `opts.freeBytes(dir)` and `opts.minFreeBytes` stand in for the disk check, so a test never reads the
 * real disk. Returns the report; throws a ScratchError for a refusal, with nothing created.
 */
export function scratchCopy(sourceArg, rootArg, opts = {}) {
  const source = checkSource(sourceArg);
  const root = checkRoot(rootArg, source);
  const plan = planCopy(source, opts.walk);
  const floor = opts.minFreeBytes ?? DEFAULT_FLOOR_BYTES, free = (opts.freeBytes ?? freeBytes)(dirname(root));
  if (!Number.isFinite(free) || free - plan.bytes < floor) refuse('FREE_SPACE_BELOW_FLOOR', 'The copy would leave less free disk space than the floor. Nothing was created.');

  const hashed = [...plan.files.map(f => f.rel), ...plan.withheld.map(w => w.rel)];
  // Before: read each file once, keep its bytes and hash.
  const read = new Map();
  for (const rel of hashed) { const r = readRegular(join(source, ...rel.split('/'))); read.set(rel, r); }
  const before = Object.fromEntries(hashed.map(rel => [rel, read.get(rel) === null ? 'missing' : sha256(read.get(rel).bytes)]));

  mkdirSync(root, { mode: 0o700, recursive: true }); chmodSync(root, 0o700);
  for (const d of ['home', 'state', 'tree']) { mkdirSync(join(root, d), { mode: 0o700 }); chmodSync(join(root, d), 0o700); }
  const treeDir = join(root, 'tree', TREE_NAME);
  mkdirSync(treeDir, { mode: 0o700 }); chmodSync(treeDir, 0o700);
  const copied = [], lost = [];
  for (const f of plan.files) {
    const r = read.get(f.rel);
    if (r === null) { lost.push(f.rel); continue; }
    const dest = join(treeDir, ...f.rel.split('/'));
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    writeFileSync(dest, r.bytes, { flag: 'wx', mode: r.mode }); chmodSync(dest, r.mode);
    copied.push(f.rel);
  }
  // The copy holds the bytes that were hashed.
  const copyHashes = hashFiles(treeDir, copied);
  const copyDiffers = copied.filter(rel => copyHashes[rel] !== before[rel]);
  // After: hash the source again. A difference is a finding.
  const after = hashFiles(source, hashed);
  const changed = hashed.filter(rel => after[rel] !== before[rel]);

  let git = 'failed';
  const g = spawnSync('git', ['init', '-q'], { cwd: treeDir, stdio: 'ignore', env: { PATH: process.env.PATH ?? '', HOME: join(root, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  if (g.status === 0) git = 'initialised';

  const byRule = {};
  for (const s of plan.skipped) byRule[s.rule] = (byRule[s.rule] ?? 0) + 1;
  const byFolder = {};
  for (const rel of copied) { const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(root)'; byFolder[top] = (byFolder[top] ?? 0) + 1; }
  const report = {
    ok: changed.length === 0 && copyDiffers.length === 0 && lost.length === 0,
    root, tree: `tree/${TREE_NAME}`,
    copied: { files: copied.length, bytes: plan.bytes, byFolder },
    links: plan.links,
    skipped: { total: plan.skipped.length, byRule, listed: plan.skipped.slice(0, LISTED_CAP) },
    withheld: plan.withheld,
    walkStopped: plan.stopped,
    git,
    sourceProof: { hashedFiles: hashed.length, unchanged: changed.length === 0, changed },
    copyProof: { differs: copyDiffers, lost },
  };
  const manifest = { format: MANIFEST_FORMAT, tree: report.tree, sourceHashes: before, links: plan.links, withheld: plan.withheld };
  writeFileSync(join(root, 'scratch.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return report;
}

// ---- command line -----------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  let min;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--min-free-bytes') {
      const v = argv[++i];
      if (!/^[0-9]+$/.test(v ?? '')) refuse('USAGE', '--min-free-bytes takes a whole number of bytes.');
      min = Number(v);
    } else if (argv[i].startsWith('--')) refuse('USAGE', `Unknown option ${argv[i]}.`);
    else positional.push(argv[i]);
  }
  if (positional.length !== 2) refuse('USAGE', 'Usage: scratch-copy.mjs <source-tree> <scratch-root> [--min-free-bytes <n>]');
  return { source: positional[0], root: positional[1], ...(min !== undefined ? { minFreeBytes: min } : {}) };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const report = scratchCopy(a.source, a.root, a.minFreeBytes !== undefined ? { minFreeBytes: a.minFreeBytes } : {});
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof ScratchError)) throw error;
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code, message: error.message })}\n`);
    process.exitCode = error.code === 'USAGE' ? 2 : 3;
  }
}
