#!/usr/bin/env node
// Step 5, item 2 (blueprint section F): the read-only run of the harness commands on a scratch copy made by scratch-copy.mjs.
// Tooling for the repository, never shipped.
//
//   node tools/step5/readonly-run.mjs <source-tree> <scratch-root> [--dir <folder>] [--cli <main.js>] [--every-engine <part>]...
//
// What it does, in order: status; adopt (Claude Code 2.1.310, Codex 0.157.0, OpenCode 1.18.30) with the answers of decision
// I6 B, which are to pick the Claude Code variant of every conflict and to acknowledge every entry that asks; install for
// Codex and OpenCode with every refused line accepted; drift; remove; then a comparison of the folder with its state after
// adoption. At the end it hashes the allowlisted source files again and compares them with the hashes taken before the copy.
// Rules this file keeps:
// - A --dir outside the scratch root is refused before any command runs. Every command runs with HOME and XDG_STATE_HOME inside it.
// - The only program it starts is node, on the built Bowerloom command line. It starts no engine and calls no network service.
// - It never prints an environment. The report holds ids, counts, hashes, and relative paths, and no file contents.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MANIFEST_FORMAT, ScratchError, TREE_NAME, guardDir, hashFiles, tempReal } from './scratch-copy.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENGINES = ['claude-code@2.1.310', 'codex@0.157.0', 'opencode@1.18.30'];
const PLUGIN = '.opencode/plugins/bowerloom-hooks.js';
const refuse = (code, message) => { throw new ScratchError(code, message); };

// ---- the scratch root and its record -----------------------------------------------------------------------------------

export function readManifest(root) {
  let real;
  try { real = realpathSync(root); } catch { refuse('ROOT_MISSING', 'The scratch root does not exist.'); }
  if (dirname(real) !== tempReal()) refuse('ROOT_OUTSIDE_TEMP', 'The scratch root must be directly below the system temp folder.');
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(real, 'scratch.json'), 'utf8')); } catch { refuse('ROOT_NOT_SCRATCH', 'The folder holds no scratch.json from scratch-copy.mjs.'); }
  if (manifest?.format !== MANIFEST_FORMAT || typeof manifest.sourceHashes !== 'object' || manifest.sourceHashes === null) refuse('ROOT_NOT_SCRATCH', 'scratch.json is not from scratch-copy.mjs.');
  return { root: real, manifest };
}

/** The source proof: every file hashed before the copy is hashed again now. Any difference is a finding. */
export function sourceProof(source, manifest) {
  const rels = Object.keys(manifest.sourceHashes).sort();
  const now = hashFiles(source, rels);
  const changed = rels.filter(rel => now[rel] !== manifest.sourceHashes[rel]);
  return { hashedFiles: rels.length, unchanged: changed.length === 0, changed };
}

// ---- a snapshot of the folder ------------------------------------------------------------------------------------------

/** Mode and content hash of every file and folder, apart from the .git folder the copy was given. */
export function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const name of readdirSync(rel === '' ? dir : join(dir, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`;
      if (r === '.git') continue;
      const st = lstatSync(join(dir, r)), mode = (st.mode & 0o7777).toString(8);
      if (st.isSymbolicLink()) out[r] = `link ${mode}`;
      else if (st.isDirectory()) { out[`${r}/`] = mode; walk(r); } else out[r] = `${mode} ${createHash('sha256').update(readFileSync(join(dir, r))).digest('hex')}`;
    }
  };
  walk('');
  return out;
}
export function diff(a, b) {
  const out = [];
  for (const k of Object.keys(a)) if (!(k in b)) out.push({ path: k, kind: 'removed' }); else if (a[k] !== b[k]) out.push({ path: k, kind: 'changed' });
  for (const k of Object.keys(b)) if (!(k in a)) out.push({ path: k, kind: 'added' });
  return out.sort((x, y) => (x.path < y.path ? -1 : 1));
}

// ---- the commands ------------------------------------------------------------------------------------------------------

export function runner(root, dir, cli, { timeoutMs = 180_000 } = {}) {
  const env = { PATH: process.env.PATH ?? '', HOME: join(root, 'home'), XDG_STATE_HOME: join(root, 'state'), NO_COLOR: '1' };
  const steps = [];
  const run = (name, args) => {
    const r = spawnSync(process.execPath, [cli, 'harness', ...args], { cwd: dir, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 2 ** 20, stdio: ['ignore', 'pipe', 'pipe'] });
    let json = null, code = null;
    try { json = r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null; } catch { /* not JSON */ }
    try { const e = JSON.parse(r.stderr.trim().split('\n').pop() ?? ''); if (typeof e?.error?.code === 'string') code = e.error.code; else if (typeof e?.code === 'string') code = e.code; } catch { /* no code */ }
    // A spawn error, a signal, and a timeout are recorded: a step with no exit status says why.
    const error = typeof r.error?.code === 'string' ? r.error.code : r.error ? 'ERROR' : null;
    steps.push({ step: name, exit: r.status, ...(code !== null ? { code } : {}), ...(error !== null ? { error } : {}), ...(r.signal ? { signal: r.signal } : {}), ...(r.error?.code === 'ETIMEDOUT' ? { timedOut: true } : {}) });
    return { exit: r.status, json, code };
  };
  return { run, steps };
}

const count = (list, key) => { const out = {}; for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1; return out; };
const claudeVariant = c => (c.variants.find(v => v.places.some(p => p.engines.includes('claude-code'))) ?? c.variants[0]).key;

/** Runs the whole sequence in `dir`. Returns the report. Nothing in the report is a file's content. */
export function readonlyRun({ root, dir, cli, everyEngine = [], timeoutMs }) {
  const { run, steps } = runner(root, dir, cli, timeoutMs === undefined ? {} : { timeoutMs });
  const engines = ENGINES.flatMap(e => ['--engine', e]), every = everyEngine.flatMap(p => ['--every-engine', p]);
  const report = { steps, stoppedAt: null, status: null, adoption: null, install: null, drift: null, removal: null, refusalCodes: [], written: [], outsideDefinition: [], restored: null };
  // Every exit path goes through here or to the last line, so refusalCodes always lists the codes of the steps that ran.
  const stop = (at) => { report.stoppedAt = at; report.refusalCodes = codes(steps); return report; };

  const s0 = run('status', ['status', '--json']);
  report.status = { present: s0.json?.definition?.present ?? null, projected: s0.json?.projected ?? null };

  const before = snapshot(dir);
  // Adopt: plan with no answers (the report counts this plan), then answer, then apply.
  const first = run('adopt-plan', ['adopt', ...engines, ...every, '--json']);
  if (first.exit !== 3 || first.json === null) return stop('adopt-plan');
  const plan0 = first.json.plan;
  const picks = {}, acks = new Set();
  let plan = plan0, revision = first.json.revision;
  for (let round = 0; round < 4; round++) {
    for (const c of plan.conflicts) if (c.choice === null) picks[c.key] = claudeVariant(c);
    for (const u of plan.unmapped) if (u.gate === 'acknowledge') acks.add(u.id);
    const answers = [...Object.entries(picks).flatMap(([k, v]) => ['--pick', `${k}=${v}`]), ...[...acks].sort().flatMap(id => ['--acknowledge', id])];
    const asked = new Set(plan.approvalsRequired);
    const confirms = [...asked].flatMap(k => ['--confirm', k]);
    const planned = run('adopt-plan-answered', ['adopt', ...engines, ...every, ...answers, ...confirms, '--json']);
    if (planned.exit !== 3 || planned.json === null) return stop('adopt-plan-answered');
    plan = planned.json.plan; revision = planned.json.revision;
    const settled = plan.conflicts.every(c => c.choice !== null) && plan.unmapped.every(u => u.gate !== 'acknowledge' || u.acknowledged) && plan.approvalsRequired.every(k => asked.has(k));
    if (settled) {
      report.adoption = adoptionReport(plan0, plan, picks);
      if (!plan.ready) return stop('adopt-not-ready');
      const done = run('adopt-apply', ['adopt', ...engines, ...every, ...answers, ...plan.approvalsRequired.flatMap(k => ['--confirm', k]), '--approve', revision]);
      if (done.exit !== 0) return stop('adopt-apply');
      break;
    }
    if (round === 3) return stop('adopt-answers');
  }
  const afterAdoption = snapshot(dir);
  report.outsideDefinition = diff(before, afterAdoption).filter(d => d.path !== '.bowerloom/' && !d.path.startsWith('.bowerloom/')).map(d => `${d.kind} ${d.path}`);
  report.written = Object.keys(afterAdoption).filter(p => !(p in before) && !p.endsWith('/')).sort();

  // Install for Codex and OpenCode: every refused line is accepted, then the plan is applied.
  const target = ['--engine', 'codex', '--engine', 'opencode'];
  let attempt = run('install', ['install', ...target, '--json']);
  const refused = [];
  if (attempt.code === 'PORTABLE_FIDELITY') {
    for (const line of attempt.json?.refused ?? []) { refused.push(line); const a = run('accept', ['accept', line.key, '--json']); if (a.exit !== 0) return stop('accept'); }
    attempt = run('install-plan', ['install', ...target, '--json']);
  }
  if (attempt.exit === 3 && attempt.json !== null) {
    const p = attempt.json.plan;
    report.install = installReport(p, refused);
    const applied = run('install-apply', ['install', ...target, '--approve', attempt.json.revision, '--json']);
    if (applied.exit !== 0) return stop('install-apply');
    report.written = [...new Set([...report.written, ...p.changes.filter(c => c.action !== 'unchanged' && c.action !== 'take-over').map(c => c.path)])].sort();
    const plugin = join(dir, ...PLUGIN.split('/'));
    report.install.pluginHash = existsSync(plugin) ? createHash('sha256').update(readFileSync(plugin)).digest('hex') : null;
    const d = run('drift', ['drift', '--json']);
    report.drift = (d.json?.drift ?? []).map(x => `${x.reason} ${x.path}`);
    const rm = run('remove-plan', ['remove', '--json']);
    if (rm.exit !== 3 || rm.json === null) return stop('remove-plan');
    const removed = run('remove-apply', ['remove', '--approve', rm.json.revision, '--json']);
    if (removed.exit !== 0) return stop('remove-apply');
    report.removal = { changes: rm.json.plan.changes.length };
  } else { report.install = { refused: refusedCounts(refused), stopped: attempt.code ?? `exit ${attempt.exit}` }; report.stoppedAt = 'install'; }
  // A run that stopped has not been through remove, so there is nothing to compare: restored stays null.
  if (report.stoppedAt === null) {
    const differences = diff(afterAdoption, snapshot(dir));
    report.restored = { equalToPostAdoption: differences.length === 0, differences: differences.map(d => `${d.kind} ${d.path}`) };
  }
  report.refusalCodes = codes(steps);
  return report;
}

const codes = steps => [...new Set(steps.filter(s => s.code).map(s => s.code))].sort();
const refusedCounts = lines => count(lines, l => `${l.engine}/${l.result}`);

function adoptionReport(plan0, plan, picks) {
  return {
    ready: plan.ready,
    items: count(plan0.items, i => i.part),
    conflicts: plan0.conflicts.map(c => ({ key: c.key, variants: c.variants.map(v => v.key), picked: picks[c.key] ?? null })),
    unmapped: plan0.unmapped.map(u => ({ id: u.id, part: u.part, gate: u.gate, reason: u.reason })),
    secretReferences: plan0.secrets.map(s => s.reference).sort(),
    approvals: plan.approvalsRequired.length,
    everyEngine: plan.everyEngine.map(e => ({ part: e.part, chosen: e.chosen, widens: e.widens })),
    files: plan.files.map(f => f.path),
  };
}
function installReport(p, refused) {
  return {
    refused: refusedCounts(refused),
    loss: count(p.loss.filter(l => l.result !== 'exact'), l => `${l.engine}/${l.result}`),
    deferred: p.deferred.map(d => `${d.engine}/${d.part}/${d.id}`).sort(),
    pendingTrust: p.pendingTrust,
    takenOver: [...new Set(p.takenOver.map(t => t.path))].sort(),
    changes: count(p.changes, c => c.action),
  };
}

// ---- command line -----------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [], a = { everyEngine: [] };
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i];
    if (w === '--dir' || w === '--cli' || w === '--every-engine') {
      const v = argv[++i];
      if (!v) refuse('USAGE', `${w} takes a value.`);
      if (w === '--every-engine') a.everyEngine.push(v); else a[w.slice(2)] = v;
    } else if (w.startsWith('--')) refuse('USAGE', `Unknown option ${w}.`);
    else positional.push(w);
  }
  if (positional.length !== 2) refuse('USAGE', 'Usage: readonly-run.mjs <source-tree> <scratch-root> [--dir <folder>] [--cli <main.js>] [--every-engine <part>]...');
  return { source: positional[0], root: positional[1], ...a };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const { root, manifest } = readManifest(a.root);
    // The guard comes first: nothing runs in a folder outside the scratch root.
    const dir = guardDir(a.dir ?? join(root, 'tree', TREE_NAME), root);
    const cli = resolve(a.cli ?? join(REPO, 'dist', 'apps', 'cli', 'src', 'main.js'));
    if (!existsSync(cli)) refuse('CLI_MISSING', 'The built command line is missing. Run npm run build first.');
    let source;
    try { source = realpathSync(a.source); } catch { refuse('SOURCE_MISSING', 'The source tree is not a folder.'); }
    const report = readonlyRun({ root, dir, cli, everyEngine: a.everyEngine });
    report.sourceProof = sourceProof(source, manifest);
    writeFileSync(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.sourceProof.unchanged && report.stoppedAt === null ? 0 : 1;
    process.stderr.write(`Delete the scratch root after you read the report: node tools/step5/scratch-copy.mjs --cleanup ${JSON.stringify(root)}\n`);
  } catch (error) {
    if (!(error instanceof ScratchError)) throw error;
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code, message: error.message })}\n`);
    process.exitCode = error.code === 'USAGE' ? 2 : 3;
  }
}
