#!/usr/bin/env node
// Test tooling, never shipped. The frozen test and skip inventory of the v0.9 parity item (docs/v0.9/test-inventory.json).
//   node tools/test-inventory.mjs record <suite> <reporter-output> <kinds.json> [--merge <inventory.json>]   builds a suite entry from real reporter output
//   node tools/test-inventory.mjs check  <suite> <reporter-output> [<inventory.json>]           compares a run with the frozen inventory
// A reporter output is the JSON lines of tools/inventory-reporter.mjs (the node suites), or the JSON of `playwright test --reporter=json` (the e2e suite).
// The check fails when a frozen test is missing from the run, when a frozen test that must pass did not pass, when a test skips that is not a frozen skip by name,
// and when a frozen "never runs in the gate" skip ran. A test that is not in the inventory is an addition and passes the check.
//
// Skip kinds (docs/v0.9/carry-over-scope.md, "What working means", item 6):
//   never-runs-in-gate  a skip that depends on an environment flag, and every fixme test. The names are frozen.
//   must-run-on-gate    every other skip. It is never frozen as allowed: the gate machine has what it needs, and a skip of this kind fails the gate.
//   needs-decision      a skip the rule does not sort: an unconditional skip, and a todo test. It is frozen by name, and the maintainer decides its kind.
// The kinds file maps "<file>" or "<file>::<test name>" to { kind, reason }. A skip with no entry is must-run-on-gate.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NEVER_RUNS = 'never-runs-in-gate';
export const MUST_RUN = 'must-run-on-gate';
export const NEEDS_DECISION = 'needs-decision';
const DEFAULT_INVENTORY = fileURLToPath(new URL('../docs/v0.9/test-inventory.json', import.meta.url));

/** Reads reporter output into [{file, name, status}]. status is pass, fail, skip, todo or fixme. `fixme` is a Playwright test annotated fixme. */
export function readRun(text, format) {
  if (format === 'playwright') return readPlaywright(JSON.parse(text));
  return text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line));
}

function readPlaywright(report) {
  const out = [];
  const walk = (suite, titles) => {
    for (const child of suite.suites ?? []) walk(child, child.title && child.title !== child.file ? [...titles, child.title] : titles);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const annotations = t.annotations ?? [];
        const fixme = annotations.some(a => a.type === 'fixme');
        const status = t.status === 'skipped' ? (fixme ? 'fixme' : 'skip') : t.status === 'expected' ? 'pass' : t.status === 'flaky' ? 'pass' : 'fail';
        out.push({ file: `apps/desktop/e2e/${spec.file}`, name: [...titles, spec.title].join(' > '), status, reasons: annotations.filter(a => a.type === 'skip' || a.type === 'fixme').map(a => a.description ?? a.type) });
      }
    }
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

/** The kind and reason of a skip, from the kinds file. A fixme is never-runs by the rule. Anything with no entry is must-run. */
export function skipKind(test, kinds) {
  const entry = kinds[`${test.file}::${test.name}`] ?? kinds[test.file];
  if (entry !== undefined) return entry;
  if (test.status === 'fixme') return { kind: NEVER_RUNS, reason: 'fixme' };
  return { kind: MUST_RUN, reason: 'no environment flag: the gate machine must run it' };
}

/** Builds the suite entry from a run. The kinds are judged by the person who records, from the skip condition in the source. */
export function buildSuite({ runner, command, cwd, run, kinds = {} }) {
  const files = {};
  const skips = [];
  const observedMustRun = [];
  const counts = { files: 0, tests: 0, pass: 0, fail: 0, skip: 0, todo: 0, fixme: 0 };
  for (const t of run) {
    (files[t.file] ??= []).push(t.name);
    counts.tests += 1; counts[t.status] += 1;
    if (t.status === 'skip' || t.status === 'todo' || t.status === 'fixme') { const k = skipKind(t, kinds); (k.kind === MUST_RUN ? observedMustRun : skips).push({ file: t.file, name: t.name, status: t.status, kind: k.kind, reason: k.reason }); }
  }
  for (const names of Object.values(files)) names.sort();
  counts.files = Object.keys(files).length;
  const sorted = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
  const byName = (a, b) => (a.file + a.name).localeCompare(b.file + b.name);
  return { runner, command, cwd, counts, skips: skips.sort(byName), observedMustRun: observedMustRun.sort(byName), files: sorted };
}

/**
 * Compares a run with a frozen suite. Returns { ok, problems }. A name seen twice in one file counts twice (the frozen list keeps duplicates).
 * `mapped` is a list of { file, name } that a named decision moved or replaced; a mapped frozen test may be absent from the run.
 */
export function checkRun({ frozen, run, mapped = [] }) {
  const problems = [];
  const seen = new Map();
  for (const t of run) { const key = `${t.file}\u0000${t.name}`; seen.set(key, [...(seen.get(key) ?? []), t.status]); }
  const mappedKeys = new Set(mapped.map(m => `${m.file}\u0000${m.name}`));
  const mustRunKeys = new Set((frozen.observedMustRun ?? []).map(s => `${s.file}\u0000${s.name}`));
  const isMustRun = (file, name) => mustRunKeys.has(`${file}\u0000${name}`);
  const frozenSkips = new Map(frozen.skips.map(s => [`${s.file}\u0000${s.name}`, s]));
  for (const [file, names] of Object.entries(frozen.files)) {
    const left = new Map();
    for (const name of names) left.set(name, (left.get(name) ?? 0) + 1);
    for (const [name, count] of left) {
      const key = `${file}\u0000${name}`;
      const statuses = seen.get(key) ?? [];
      if (statuses.length < count && !mappedKeys.has(key)) problems.push(`missing: ${file}: ${name}`);
      const skip = frozenSkips.get(key);
      for (const status of statuses) {
        if (status === 'fail') problems.push(`failed: ${file}: ${name}`);
        if (skip === undefined && !isMustRun(file, name) && (status === 'skip' || status === 'fixme' || status === 'todo')) problems.push(`skipped, not frozen: ${file}: ${name}`);
        if (skip !== undefined && skip.kind === NEVER_RUNS && status === 'pass') problems.push(`frozen never-runs skip ran: ${file}: ${name}`);
      }
    }
  }
  for (const t of run) {
    const inFrozen = (frozen.files[t.file] ?? []).includes(t.name);
    if (!inFrozen && !isMustRun(t.file, t.name) && (t.status === 'skip' || t.status === 'fixme' || t.status === 'todo')) problems.push(`skipped, not frozen: ${t.file}: ${t.name}`);
    if (!inFrozen && t.status === 'fail') problems.push(`failed (an addition): ${t.file}: ${t.name}`);
  }
  // A must-run test is not frozen as allowed to skip. The base skipped these on the machine that recorded the inventory; a skip of any of them fails the gate.
  for (const s of frozen.observedMustRun ?? []) if ((seen.get(`${s.file}\u0000${s.name}`) ?? []).some(status => status === 'skip')) problems.push(`must-run test skipped: ${s.file}: ${s.name}`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

function main(argv) {
  const [command, suiteName, runFile, extra, extra2, extra3] = argv;
  const usage = 'usage: test-inventory.mjs record <suite> <reporter-output> <kinds.json> [--merge <inventory.json>] | check <suite> <reporter-output> [<inventory.json>]';
  if (!['record', 'check'].includes(command) || suiteName === undefined || runFile === undefined) { process.stderr.write(usage + '\n'); return 2; }
  const format = suiteName === 'e2e' ? 'playwright' : 'jsonl';
  const run = readRun(fs.readFileSync(runFile, 'utf8'), format);
  if (command === 'record') {
    const kinds = extra === undefined ? {} : JSON.parse(fs.readFileSync(extra, 'utf8'));
    const suite = buildSuite({ runner: format === 'playwright' ? 'playwright' : 'node --test', command: '', cwd: '', run, kinds });
    const target = extra2 === '--merge' ? extra3 : null;
    if (target === null) { process.stdout.write(JSON.stringify(suite, null, 2) + '\n'); return 0; }
    const inventory = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : { suites: {} };
    inventory.suites[suiteName] = suite;
    fs.writeFileSync(target, JSON.stringify(inventory, null, 1) + '\n');
    return 0;
  }
  const inventoryPath = extra ?? DEFAULT_INVENTORY;
  const frozen = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')).suites[suiteName];
  if (frozen === undefined) { process.stderr.write(`no suite "${suiteName}" in ${inventoryPath}\n`); return 2; }
  const result = checkRun({ frozen, run });
  if (!result.ok) process.stderr.write(result.problems.map(p => `  ${p}\n`).join(''));
  process.stdout.write(`${suiteName}: ${result.ok ? 'matches the frozen inventory' : `${result.problems.length} problem(s)`} (${run.length} tests run, ${frozen.counts.tests} frozen)\n`);
  return result.ok ? 0 : 1;
}


if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
