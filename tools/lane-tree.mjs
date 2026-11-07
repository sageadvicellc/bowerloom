#!/usr/bin/env node
// Lane tooling, never shipped. Safety class: local-write (list is read-only).
// Makes, lists, and safely removes the separate working copy that one lane of work uses:
//   node tools/lane-tree.mjs create --name SLUG --base REF --dest ABS_PATH [--branch NAME] [--modules-from ABS_CHECKOUT] [--min-free-gib N] [--json]
//   node tools/lane-tree.mjs remove --dest ABS_PATH [--apply] [--json]     (a dry run unless --apply)
//   node tools/lane-tree.mjs list [--root ABS_DIR] [--json]
// `create` clones the repository that holds this script (a local clone that shares objects), points the clone's origin at the source's origin,
// fetches the base branch from that origin, starts the lane branch at the fetched commit, and writes the marker file .git/lane-tree.json. The marker
// holds a random nonce, also stored in the clone's git config (laneTree.nonce), and the real path of the folder; remove checks both.
// `remove` deletes only a folder that carries a matching marker, has no uncommitted work, no ignored file outside a short allowlist, no stash, no
// unpushed branch or tag, and a branch HEAD. It measures the folder with du first, then reads the status, HEAD, and stash list; immediately before
// the delete it reads those three again and refuses if any changed. Every git command it runs against the lane carries
// -c core.fsmonitor=false -c core.hooksPath=/dev/null -c protocol.ext.allow=never. That turns off the filesystem monitor, hooks, and the ext:: transport only.
// A filter, uploadpack, sshCommand, or credential helper set in the lane's own .git/config could still run; the nonce check is the guard, and it
// refuses a folder that lane-tree did not make.
// It never deletes the folder that holds the source, the current folder, or the home folder. It never runs npm, and it never touches a git branch in
// any other repository. It cannot tell that a branch was squash-merged: a lane whose branch was squash-merged and deleted on origin has commits that
// origin lacks, so `remove` refuses it, and it is deleted by hand.
// `create` claims the destination with an atomic mkdir before it clones, and removes only a folder it made itself.
// Exit 0: done. Exit 1: refused or a step failed. Exit 2: wrong use, or an internal error (with --json, one object {ok:false, exit:2, error}).
// On SIGINT, SIGTERM, or SIGHUP it stops its child processes, removes a half-made folder, and exits 130.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIB, freeBytes, runChild } from './lib/run-child.mjs';
import { splitFlag, jsonWanted, seamRefusal, boolValueRefusal, flagLikeValueRefusal, reportUsage, guarded, entryState, mismatchMessage } from './lib/cli.mjs';
import { installInterruptHandlers, onInterrupt } from './lib/interrupt.mjs';
import { KEEPABLE_ENV, redact } from './lib/safe-env.mjs';

export const MARKER_SCHEMA = 'bowerloom/lane-tree/v2';
export const MARKER_FILE = 'lane-tree.json';
export const NONCE_KEY = 'laneTree.nonce';
export const DEFAULT_FLOOR_GIB = 12;
const MODULE_FOLDERS = Object.freeze(['node_modules', 'apps/desktop/node_modules']);
const GIT_TIMEOUT_MS = 10 * 60 * 1000;
// Passed to the one git call that talks to origin, so it can use the ssh agent. No other child gets these.
const SSH_AGENT_ENV = KEEPABLE_ENV;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const NONCE = /^[0-9a-f]{32}$/;

const USAGE = `Usage: node tools/lane-tree.mjs <create|remove|list> [options]
  create --name SLUG --base REF --dest ABS_PATH [--branch NAME] [--modules-from ABS_CHECKOUT] [--min-free-gib N]
      Clones this repository to DEST, fetches the base branch from origin, and starts branch task/SLUG (or NAME) there.
      REF is a branch name (origin/ and refs/heads/ prefixes are allowed) or a 40-character commit id; HEAD is not allowed.
      --modules-from copies node_modules and apps/desktop/node_modules from a checkout, copy-on-write, on macOS only.
        If nothing is copied the run still succeeds; the JSON says modulesCopied false and gives modulesNote.
      --min-free-gib can only raise the free-disk floor above ${DEFAULT_FLOOR_GIB} GiB.
  remove --dest ABS_PATH [--apply]
      Dry run unless --apply. Refuses unless DEST has a matching marker, a clean tree, no ignored file outside the allowlist
      (node_modules, .trellis at any depth, a root dist/, .DS_Store), no stash, a branch checked out, and no branch or tag that origin lacks.
      It reads the status, HEAD, and stash list again just before it deletes, and refuses if they changed.
      It refuses a lane whose branch was squash-merged and deleted on origin (its commits are not on origin): delete that one by hand.
  list [--root ABS_DIR]
      Lists the folders under ROOT (default: the folder that holds this repository) that carry a marker. Read-only.
  --json   print one JSON object on stdout (also for a usage error: {ok:false, exit:2, error})
  --source ABS_DIR   use another source repository (a test seam: needs BOWERLOOM_TOOLS_TEST_MODE=1)
A flag that takes no value (--apply, --json) rejects one: --apply=false is a usage error.
Exit 0: done. Exit 1: refused or failed. Exit 2: wrong use. Exit 130: interrupted.`;

/** True when `slug` is a lane name: lower-case letters, digits, and dashes, not starting with a dash. */
export function validateSlug(slug) {
  return typeof slug === 'string' && SLUG.test(slug);
}

/** The branch to fetch from origin for a base reference, or null when the base is a full commit id. */
export function baseBranchOf(base) {
  if (SHA.test(base)) return null;
  return base.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '').replace(/^origin\//, '');
}

/** True when `child` is `parent` or lies inside it. Both must be resolved absolute paths. */
export function isInside(child, parent) {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/** A reason a base reference is unusable, or null. A base that starts with - could be read by git as an option. */
export function baseProblem(base) {
  if (typeof base !== 'string' || base === '') return 'the base is empty';
  if (base.startsWith('-')) return 'the base must not start with -';
  if (/^(?:HEAD|@|FETCH_HEAD)$/i.test(base)) return 'the base HEAD is not allowed; name a branch or a 40-character commit id';
  return null;
}

const FLAGS = {
  create: { '--name': 'value', '--base': 'value', '--dest': 'value', '--branch': 'value', '--modules-from': 'value', '--min-free-gib': 'value', '--source': 'value', '--json': 'bool' },
  remove: { '--dest': 'value', '--apply': 'bool', '--json': 'bool' },
  list: { '--root': 'value', '--source': 'value', '--json': 'bool' },
};

/** Reads the command line. Returns { help: true }, or { usage: message }, or the parsed command. `env` decides whether the test seams are allowed. */
export function parseArgs(argv, env = process.env) {
  const out = { help: false, usage: null, command: null, name: null, base: null, dest: null, branch: null, modulesFrom: null, root: null, source: null, apply: false, json: false, floorGiB: DEFAULT_FLOOR_GIB };
  const bad = message => { out.usage = message; return out; };
  if (argv.includes('--help') || argv.includes('-h')) { out.help = true; return out; }
  const [command, ...rest] = argv;
  if (!command) return bad('a subcommand is required: create, remove, or list');
  if (!Object.hasOwn(FLAGS, command)) return bad(`unknown subcommand: ${command}`);
  out.command = command;
  for (let i = 0; i < rest.length; i++) {
    const { flag, value: inline } = splitFlag(rest[i]);
    let value = inline;
    const kind = Object.hasOwn(FLAGS[command], flag) ? FLAGS[command][flag] : null;
    if (!kind) return bad(`${command}: unknown argument ${rest[i]}`);
    if (kind === 'bool') {
      const refusal = boolValueRefusal(flag, inline);
      if (refusal) return bad(refusal);
      if (flag === '--json') out.json = true; else out.apply = true;
      continue;
    }
    const seam = flag === '--source' ? seamRefusal(flag, env) : null;
    if (seam) return bad(seam);
    const flagLike = flagLikeValueRefusal(flag, inline);
    if (flagLike) return bad(flagLike);
    if (value === null) { value = rest[i + 1]; if (value === undefined || value.startsWith('--')) return bad(`${flag} needs a value`); i++; }
    switch (flag) {
      case '--name': out.name = value; break;
      case '--base': out.base = value; break;
      case '--dest': out.dest = value; break;
      case '--branch': out.branch = value; break;
      case '--modules-from': out.modulesFrom = value; break;
      case '--root': out.root = value; break;
      case '--source': out.source = value; break;
      case '--min-free-gib': {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return bad('--min-free-gib needs a positive number');
        if (number < DEFAULT_FLOOR_GIB) return bad(`--min-free-gib can only raise the floor above ${DEFAULT_FLOOR_GIB} GiB`);
        out.floorGiB = number; break;
      }
    }
  }
  if (command === 'create') {
    for (const [flag, key] of [['--name', 'name'], ['--base', 'base'], ['--dest', 'dest']]) if (out[key] === null) return bad(`create needs ${flag}`);
    const problem = baseProblem(out.base);
    if (problem) return bad(problem);
  }
  if (command === 'remove' && out.dest === null) return bad('remove needs --dest');
  return out;
}

/**
 * Options for every git command that targets a candidate lane. They turn off the filesystem monitor, hooks, and the ext:: transport, and nothing else.
 * A filter, uploadpack, sshCommand, or credential helper set in the lane's own .git/config can still run. The nonce check is the guard: lane-tree
 * runs nothing against a folder whose marker and stored nonce do not match.
 */
export const SAFE_GIT_OPTIONS = Object.freeze(['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never']);

/** Runs git with a scrubbed environment (no tokens, no inherited GIT_* location variables, no prompts). `why` is the first line of stderr, redacted. */
async function git(args, cwd, timeoutMs = GIT_TIMEOUT_MS, keepEnv = []) {
  const result = await runChild('git', args, {
    cwd, timeoutMs, maxBytes: 4 * 1024 * 1024, keepEnv,
    env: { GIT_TERMINAL_PROMPT: '0', GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_COMMON_DIR: undefined },
  });
  return { ...result, ok: result.code === 0 && result.reason === null, out: result.stdout.trim(), why: redact(result.stderr.trim().split('\n').find(Boolean) ?? result.message ?? '').slice(0, 200) };
}

/** git against a candidate lane: the same, with SAFE_GIT_OPTIONS in front. */
const laneGit = (args, cwd, timeoutMs) => git([...SAFE_GIT_OPTIONS, ...args], cwd, timeoutMs);

/** Size of a folder in bytes, read with du (blocks of 1 KiB). Null when du fails. */
async function folderBytes(dir) {
  const result = await runChild('du', ['-sk', dir], { timeoutMs: 5 * 60 * 1000 });
  const kib = Number(result.stdout.trim().split(/\s+/)[0]);
  return result.code === 0 && result.reason === null && Number.isFinite(kib) ? kib * 1024 : null;
}

const lstatOrNull = target => { try { return fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; } };
const realpathOrNull = target => { try { return fs.realpathSync(target); } catch { return null; } };

/** The repository that holds this script, or the one named by --source. Null when none is found. */
async function sourceRepo(args) {
  const start = args.source ?? fileURLToPath(new URL('.', import.meta.url));
  const top = await git(['rev-parse', '--show-toplevel'], start);
  return top.ok ? fs.realpathSync(top.out) : null;
}

/** A URL or absolute path for origin. A relative path is read from the source, because the clone lives elsewhere. */
const absoluteRemote = (url, source) => (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^[^/\s]+@[^/\s]+:/.test(url) || path.isAbsolute(url) ? url : path.resolve(source, url));

function readMarker(dest) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dest, '.git', MARKER_FILE), 'utf8'));
    const valid = marker && marker.schema === MARKER_SCHEMA && typeof marker.name === 'string' && typeof marker.branch === 'string' && marker.branch !== '' && SHA.test(marker.baseCommit ?? '')
      && NONCE.test(marker.nonce ?? '') && typeof marker.dest === 'string' && path.isAbsolute(marker.dest) && typeof marker.source === 'string' && path.isAbsolute(marker.source);
    return valid ? marker : { invalid: true };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    return { invalid: true };
  }
}

/** Makes the lane tree. Returns the result object; `refused` holds the reason when nothing was made or the run failed. */
export async function createLane(args) {
  const result = {
    ok: false, command: 'create', name: args.name, dest: args.dest, base: args.base, baseCommit: null, branch: args.branch ?? `task/${args.name}`,
    modules: { requested: args.modulesFrom !== null, copied: [], skipped: null }, modulesCopied: false, modulesNote: null, freeGiB: null, floorGiB: args.floorGiB, refused: null, cleanedPartial: false,
  };
  const refuse = message => { result.refused = message; return result; };

  if (!validateSlug(args.name)) return refuse(`the slug ${JSON.stringify(args.name)} must match ${SLUG.source}`);
  if (!path.isAbsolute(args.dest)) return refuse('dest must be an absolute path');
  const problem = baseProblem(args.base);
  if (problem) return refuse(problem);
  const dest = path.resolve(args.dest);
  if (args.modulesFrom !== null) {
    if (!path.isAbsolute(args.modulesFrom)) return refuse('--modules-from must be an absolute path');
    const stat = lstatOrNull(args.modulesFrom);
    if (!stat || !stat.isDirectory()) return refuse('--modules-from must be an existing folder');
  }
  const source = await sourceRepo(args);
  if (!source) return refuse('could not find the source repository');
  if (result.branch.startsWith('-')) return refuse(`${JSON.stringify(result.branch)} is not a valid branch name`);
  const branchCheck = await git(['check-ref-format', '--branch', result.branch], source);
  if (!branchCheck.ok) return refuse(`${JSON.stringify(result.branch)} is not a valid branch name`);
  const baseBranch = baseBranchOf(args.base);
  if (baseBranch !== null) {
    if (baseBranch.startsWith('-') || !(await git(['check-ref-format', '--allow-onelevel', baseBranch], source)).ok) return refuse(`${JSON.stringify(args.base)} is not a valid branch name or commit id`);
  }
  const originUrl = await git(['remote', 'get-url', 'origin'], source);
  if (!originUrl.ok || originUrl.out === '') return refuse('the source repository has no origin remote');
  if (lstatOrNull(dest)) return refuse('dest already exists');
  const parent = path.dirname(dest);
  const parentStat = lstatOrNull(parent);
  if (!parentStat || !fs.statSync(parent).isDirectory()) return refuse('the parent folder of dest is missing');
  const realDest = path.join(fs.realpathSync(parent), path.basename(dest));
  if (isInside(realDest, source)) return refuse('dest is inside the source repository');

  // Disk: the floor, plus what the clone and the module copies need. A size that cannot be read stops the run: it never lowers the need.
  const gitDir = await git(['rev-parse', '--absolute-git-dir'], source);
  let needed = args.floorGiB * GIB;
  const gitBytes = gitDir.ok ? await folderBytes(gitDir.out) : null;
  if (gitBytes === null) return refuse('could not measure the size of the source git folder (du failed); nothing was made');
  needed += gitBytes;
  if (args.modulesFrom !== null) {
    for (const folder of MODULE_FOLDERS) {
      const from = path.join(args.modulesFrom, folder);
      if (!lstatOrNull(from)) continue;
      const bytes = await folderBytes(from);
      if (bytes === null) return refuse(`could not measure the size of ${from} (du failed); nothing was made`);
      needed += bytes;
    }
  }
  const free = freeBytes(parent);
  result.freeGiB = Math.round(free / GIB * 10) / 10;
  if (free < needed) return refuse(`free disk is ${result.freeGiB} GiB, under the ${Math.round(needed / GIB * 10) / 10} GiB needed (floor ${args.floorGiB} GiB plus the clone and any modules copy)`);

  // The folder becomes this run's own only when this run makes it: mkdir fails if anything is there, and `made` is set after it succeeds. A failure, an error,
  // or an interrupt after that removes the folder; a folder that this run did not make is never removed.
  let made = false, finished = false;
  const undo = () => { if (made && !finished) fs.rmSync(realDest, { recursive: true, force: true }); };
  const forget = onInterrupt(undo);
  const fail = message => { undo(); made = false; result.cleanedPartial = true; return refuse(message); };
  try {
    try { fs.mkdirSync(realDest); } catch (error) { return refuse(error.code === 'EEXIST' ? 'dest already exists' : `could not make dest: ${error.code ?? error.message}`); }
    made = true;
    const clone = await git(['clone', '--local', '--no-checkout', '--no-tags', source, realDest], parent);
    if (!clone.ok) return fail(`git clone failed: ${clone.why}`);
    const setUrl = await git(['remote', 'set-url', 'origin', absoluteRemote(originUrl.out, source)], realDest);
    if (!setUrl.ok) return fail(`could not set origin: ${setUrl.why}`);
    let baseCommit;
    if (baseBranch === null) {
      const known = await git(['rev-parse', '--verify', `${args.base}^{commit}`], realDest);
      if (!known.ok) return fail(`base commit ${args.base} is not in the source repository`);
      baseCommit = known.out;
    } else {
      // A fully qualified ref cannot be read as an option, whatever the branch name holds.
      const fetched = await git(['fetch', 'origin', `refs/heads/${baseBranch}`], realDest, GIT_TIMEOUT_MS, SSH_AGENT_ENV);
      if (!fetched.ok) return fail(`could not fetch ${baseBranch} from origin: ${fetched.why}`);
      const head = await git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], realDest);
      if (!head.ok) return fail('could not read the fetched commit');
      baseCommit = head.out;
    }
    const checkout = await git(['checkout', '-q', '-b', result.branch, baseCommit], realDest);
    if (!checkout.ok) return fail(`could not start branch ${result.branch}: ${checkout.why}`);
    result.baseCommit = baseCommit;
    const nonce = crypto.randomBytes(16).toString('hex');
    const stored = await git(['config', '--local', NONCE_KEY, nonce], realDest);
    if (!stored.ok) return fail(`could not store the lane nonce: ${stored.why}`);
    try {
      fs.writeFileSync(path.join(realDest, '.git', MARKER_FILE), JSON.stringify({ schema: MARKER_SCHEMA, name: args.name, source, base: args.base, branch: result.branch, baseCommit, dest: realDest, nonce, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    } catch (error) {
      return fail(`could not write the marker file: ${error.code ?? error.message}`);
    }

    if (args.modulesFrom !== null) await copyModules(args.modulesFrom, realDest, result.modules);
    result.modulesCopied = result.modules.copied.length > 0;
    result.modulesNote = result.modules.skipped;
    result.dest = realDest;
    result.ok = true;
    finished = true;
    return result;
  } catch (error) {
    undo(); made = false;
    throw error;
  } finally {
    forget();
  }
}

/** Copies the module folders copy-on-write (`cp -c -R`, macOS only). Never runs npm. Records what was copied and why anything was skipped. */
async function copyModules(from, dest, modules) {
  if (process.platform !== 'darwin') { modules.skipped = 'a copy-on-write copy needs macOS (darwin); modules were not copied'; return; }
  const notes = [];
  for (const folder of MODULE_FOLDERS) {
    const source = path.join(from, ...folder.split('/'));
    if (!lstatOrNull(source)) continue;
    const target = path.join(dest, ...folder.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const copy = await runChild('cp', ['-c', '-R', source, target], { timeoutMs: 30 * 60 * 1000 });
    if (copy.code === 0 && copy.reason === null) modules.copied.push(folder);
    else { fs.rmSync(target, { recursive: true, force: true }); notes.push(`${folder}: copy failed (${(copy.stderr.trim().split('\n')[0] ?? copy.message ?? '').slice(0, 120)})`); }
  }
  if (modules.copied.length === 0) modules.skipped = notes.length ? notes.join('; ') : 'no node_modules folder was found in --modules-from';
  else if (notes.length) modules.skipped = notes.join('; ');
}

/** True when an ignored path (as `git status --porcelain --ignored` lists it) is one that may be deleted with the lane. */
export function ignoredAllowed(entry) {
  const segments = entry.replace(/\/$/, '').split('/');
  return segments.includes('node_modules') || segments.includes('.trellis') || segments[0] === 'dist' || segments.at(-1) === '.DS_Store';
}

/** Parses `git status --porcelain -z --ignored` into { changed: [paths], ignored: [paths] }. */
export function parseStatus(text) {
  const changed = [], ignored = [];
  const parts = text.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2), file = parts[i].slice(3);
    if (code === '!!') ignored.push(file); else changed.push(file);
    if (code[0] === 'R' || code[0] === 'C') i++; // a rename carries its old path in the next field
  }
  return { changed, ignored };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Checks whether `dest` may be removed. Returns { refusals, marker, bytes, real, snapshot }. `snapshot` is what removeLane reads again just before it deletes. */
export async function inspectLane(destArg) {
  const out = { refusals: [], marker: null, bytes: null, real: null, snapshot: null };
  const stop = message => { out.refusals.push(message); return out; };
  if (!path.isAbsolute(destArg)) return stop('dest is not an absolute path');
  const dest = path.resolve(destArg);
  const stat = lstatOrNull(dest);
  if (!stat) return stop('dest does not exist');
  if (stat.isSymbolicLink()) return stop('dest is a symlink');
  if (!stat.isDirectory()) return stop('dest is not a folder');
  const real = fs.realpathSync(dest);
  const marker = readMarker(dest);
  if (marker === null) return stop(`the marker file .git/${MARKER_FILE} is missing; this folder was not made by lane-tree`);
  if (marker.invalid) return stop(`the marker file .git/${MARKER_FILE} is not valid`);
  out.marker = marker;
  const gitStat = lstatOrNull(path.join(dest, '.git'));
  if (!gitStat || !gitStat.isDirectory()) return stop('.git is not a real folder; this is not a lane clone');
  if (marker.dest !== real) return stop('the marker names a different folder than dest; it was copied or forged');
  const nonce = await laneGit(['config', '--local', '--get', NONCE_KEY], dest);
  if (!nonce.ok || nonce.out !== marker.nonce) return stop(`the marker nonce does not match the repository's ${NONCE_KEY}; this folder was not made by lane-tree`);
  const top = await laneGit(['rev-parse', '--show-toplevel'], dest);
  if (!top.ok || fs.realpathSync(top.out) !== real) return stop('dest is not the top folder of a git work tree');
  // The branch name goes into git commands below; a name git cannot accept as a branch (or one that starts with -) never reaches them.
  if (marker.branch.startsWith('-') || !(await laneGit(['check-ref-format', `refs/heads/${marker.branch}`], dest)).ok) return stop('the marker names a branch that is not a valid branch name');

  // Folders that must never be deleted: the one that holds the source, the current folder, and the home folder.
  const protectedPaths = [['the source repository', realpathOrNull(marker.source) ?? marker.source], ['the current folder', realpathOrNull(process.cwd()) ?? process.cwd()], ['the home folder', realpathOrNull(os.homedir()) ?? os.homedir()]];
  for (const [label, target] of protectedPaths) if (isInside(target, real)) return stop(`dest is or contains ${label}`);

  // du is slow on a big folder, so it runs first; the status, HEAD, and stash list that removeLane compares are read after it.
  out.bytes = await folderBytes(dest);
  out.real = real;
  const status = await laneGit(['status', '--porcelain', '-z', '--ignored=matching'], dest);
  if (!status.ok) out.refusals.push(`git status failed: ${status.why}`);
  else {
    const { changed, ignored } = parseStatus(status.stdout);
    if (changed.length) out.refusals.push('the work tree has uncommitted or untracked changes (git status --porcelain is not empty)');
    const unlisted = ignored.filter(entry => !ignoredAllowed(entry));
    if (unlisted.length) out.refusals.push(`${plural(unlisted.length, 'ignored path')} outside the allowlist (node_modules, .trellis at any depth, a root dist/, .DS_Store) would be deleted: ${unlisted.slice(0, 5).join(', ')}`);
  }
  const stash = await laneGit(['stash', 'list'], dest);
  const head = await laneGit(['rev-parse', 'HEAD'], dest);
  out.snapshot = status.ok && stash.ok && head.ok ? { status: status.stdout, head: head.out, stash: stash.out } : null;
  if (!stash.ok) out.refusals.push(`could not read the stash list (git stash list failed: ${stash.why}); treated as unsafe`);
  else if (stash.out !== '') out.refusals.push('the repository has a stash entry');
  const symbolic = await laneGit(['symbolic-ref', '-q', 'HEAD'], dest);
  if (!symbolic.ok) out.refusals.push('HEAD is detached; commits there are on no branch');

  const ref = `refs/heads/${marker.branch}`;
  const listed = await laneGit(['ls-remote', '--exit-code', '--heads', 'origin', ref], dest, 2 * 60 * 1000);
  if (listed.code === 0) {
    const fetched = await laneGit(['fetch', 'origin', ref], dest, 5 * 60 * 1000);
    if (!fetched.ok) out.refusals.push(`could not fetch ${marker.branch} from origin: ${fetched.why}`);
    else {
      const ahead = await laneGit(['rev-list', '--count', 'FETCH_HEAD..HEAD'], dest);
      if (!ahead.ok) out.refusals.push(`could not compare HEAD with origin/${marker.branch}: ${ahead.why}`);
      else if (Number(ahead.out) > 0) out.refusals.push(`${ahead.out} commit${ahead.out === '1' ? '' : 's'} on HEAD are not on origin/${marker.branch}`);
    }
  } else if (listed.code === 2 && listed.reason === null) {
    const head = await laneGit(['rev-parse', 'HEAD'], dest);
    if (!head.ok || head.out !== marker.baseCommit) out.refusals.push(`branch ${marker.branch} is not on origin and HEAD is not the base commit ${marker.baseCommit.slice(0, 12)}`);
  } else {
    out.refusals.push(`cannot reach origin to compare branch ${marker.branch} (ls-remote failed: ${listed.why})`);
    return out; // Nothing below can be checked without origin.
  }

  // Every local branch, not only the lane branch: a second branch with work would be lost with the folder.
  const refreshed = await laneGit(['fetch', '--prune', '--no-tags', 'origin'], dest, 5 * 60 * 1000);
  if (!refreshed.ok) out.refusals.push(`could not refresh the remote-tracking branches from origin: ${refreshed.why}`);
  else {
    const unpushed = await laneGit(['rev-list', '--branches', '--not', '--remotes=origin', '--count'], dest);
    if (!unpushed.ok) out.refusals.push(`could not count the commits that origin lacks: ${unpushed.why}`);
    else if (Number(unpushed.out) > 0) out.refusals.push(`${plural(Number(unpushed.out), 'commit')} on local branches are not on origin`);
  }
  const localTags = await laneGit(['for-each-ref', '--format=%(refname:strip=2) %(objectname)', 'refs/tags'], dest);
  if (!localTags.ok) out.refusals.push(`could not read the local tags: ${localTags.why}`);
  else if (localTags.out !== '') {
    const remoteTags = await laneGit(['ls-remote', '--tags', 'origin'], dest, 2 * 60 * 1000);
    if (!remoteTags.ok) out.refusals.push(`could not read the tags on origin: ${remoteTags.why}`);
    else {
      const onOrigin = new Map(remoteTags.out.split('\n').filter(Boolean).map(line => { const [id, name] = line.split(/\s+/); return [name.replace(/^refs\/tags\//, ''), id]; }));
      const unpushedTags = localTags.out.split('\n').map(line => line.split(' ')).filter(([name, id]) => onOrigin.get(name) !== id).map(([name]) => name);
      if (unpushedTags.length) out.refusals.push(`${plural(unpushedTags.length, 'tag')} not on origin: ${unpushedTags.slice(0, 5).join(', ')}`);
    }
  }
  return out;
}

/** Reads the status, HEAD, and stash list of a lane again. Returns the same shape as the inspection's snapshot, or null when any of them cannot be read. */
async function readSnapshot(dest) {
  const [status, stash, head] = [await laneGit(['status', '--porcelain', '-z', '--ignored=matching'], dest), await laneGit(['stash', 'list'], dest), await laneGit(['rev-parse', 'HEAD'], dest)];
  return status.ok && stash.ok && head.ok ? { status: status.stdout, head: head.out, stash: stash.out } : null;
}

/** Removes a lane tree, or reports what it would remove. */
export async function removeLane(args) {
  const inspected = await inspectLane(args.dest);
  const result = { ok: inspected.refusals.length === 0, command: 'remove', dest: args.dest, apply: args.apply, wouldRemove: inspected.refusals.length === 0, removed: false, bytes: inspected.bytes, branch: inspected.marker?.branch ?? null, refusals: inspected.refusals };
  if (result.ok && args.apply) {
    const target = path.resolve(args.dest);
    const refuseNow = message => { result.ok = false; result.wouldRemove = false; result.refusals.push(message); return result; };
    if (lstatOrNull(target)?.isSymbolicLink()) return refuseNow('dest is a symlink');
    // Immediately before the delete: read the status, HEAD, and stash list again. Anything that differs from the inspection means work may have arrived since.
    const again = await readSnapshot(target);
    if (inspected.snapshot === null || again === null || again.status !== inspected.snapshot.status || again.head !== inspected.snapshot.head || again.stash !== inspected.snapshot.stash) {
      return refuseNow('the work tree, HEAD, or stash changed since the inspection (or could not be read again); nothing was deleted. Run remove again.');
    }
    if (fs.realpathSync(target) !== inspected.real) return refuseNow('dest resolves to a different folder than it did at the inspection; nothing was deleted');
    fs.rmSync(inspected.real ?? target, { recursive: true, force: true });
    result.removed = true;
  }
  return result;
}

/** The lane trees directly under `root`. A symlink is skipped. */
export function listLanes(root) {
  const lanes = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const marker = readMarker(dir);
    if (marker === null || marker.invalid) continue;
    lanes.push({ path: dir, name: marker.name, branch: marker.branch, base: marker.base, baseCommit: marker.baseCommit, createdAt: marker.createdAt });
  }
  return lanes.sort((a, b) => a.path.localeCompare(b.path));
}

function format(result) {
  if (result.command === 'create') {
    if (!result.ok) return `lane-tree: REFUSED. ${result.refused}${result.cleanedPartial ? ' (the half-made folder was removed)' : ''}\n`;
    let modules = '';
    if (result.modules.requested) modules = result.modulesCopied ? `; modules copied: ${result.modules.copied.join(', ')}${result.modulesNote ? ` (${result.modulesNote})` : ''}` : `; WARNING: modules NOT copied (${result.modulesNote})`;
    return `lane-tree: made ${result.dest} on ${result.branch} at ${result.baseCommit.slice(0, 12)}${modules}\n`;
  }
  if (result.command === 'remove') {
    if (!result.ok) return `lane-tree: REFUSED to remove ${result.dest}:\n${result.refusals.map(r => `  ${r}`).join('\n')}\n`;
    if (result.removed) return `lane-tree: removed ${result.dest} (${result.bytes ?? 'unknown'} bytes)\n`;
    return `lane-tree: dry run. Would remove ${result.dest} (${result.bytes ?? 'unknown'} bytes). Add --apply to delete it.\n`;
  }
  return result.lanes.length ? result.lanes.map(l => `${l.path}\t${l.branch}\t${l.createdAt}`).join('\n') + '\n' : 'lane-tree: no lane trees found\n';
}

/** Entry point. Returns the exit code. */
export async function main(argv, out = process.stdout, err = process.stderr, env = process.env) {
  const json = jsonWanted(argv);
  return guarded('lane-tree', { json, out, err }, async () => {
    const args = parseArgs(argv, env);
    if (args.help) { out.write(USAGE + '\n'); return 0; }
    if (args.usage) return reportUsage('lane-tree', args.usage, USAGE, { json, out, err });
    let result;
    if (args.command === 'create') result = await createLane(args);
    else if (args.command === 'remove') result = await removeLane(args);
    else {
      result = { ok: true, command: 'list', root: args.root, lanes: [], refused: null };
      if (args.root !== null && !path.isAbsolute(args.root)) { result.ok = false; result.refused = 'root must be an absolute path'; }
      else {
        let root = args.root;
        if (root === null) {
          const source = await sourceRepo(args);
          if (source === null) return reportUsage('lane-tree', 'list needs --root: the source repository could not be found', USAGE, { json, out, err });
          root = path.dirname(source);
        }
        result.root = root;
        try { result.lanes = listLanes(root); } catch (error) { result.ok = false; result.refused = `cannot read ${root}: ${error.code ?? error.message}`; }
      }
    }
    out.write(args.json ? JSON.stringify(result) + '\n' : result.ok || args.command !== 'list' ? format(result) : `lane-tree: REFUSED. ${result.refused}\n`);
    return result.ok ? 0 : 1;
  });
}

const entry = entryState(process.argv[1], import.meta.url);
if (entry === 'main') {
  installInterruptHandlers();
  process.exitCode = await main(process.argv.slice(2));
} else if (entry === 'mismatch') {
  process.stderr.write(mismatchMessage('lane-tree', process.argv[1], import.meta.url));
  process.exitCode = 2;
}
