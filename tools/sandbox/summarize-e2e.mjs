#!/usr/bin/env node
// Test tooling, never shipped. Prints the counts of a `playwright test --reporter=json` file, and the title of each failed test.
//   node tools/sandbox/summarize-e2e.mjs <e2e.json> [--exit-code N] [--inventory <test-inventory.json>]
// Exit 0 only when: Playwright exited 0 (when --exit-code is given), the report has no top-level error, no test was interrupted,
// no test failed, at least one passed, and the report holds at least as many tests as the frozen e2e suite (when the inventory has one).
// Exit 1 otherwise, and on a missing or unreadable file. A skipped count is printed as a warning.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readRun } from '../test-inventory.mjs';

const DEFAULT_INVENTORY = fileURLToPath(new URL('../../docs/v0.9/test-inventory.json', import.meta.url));

function interruptedCount(report) {
  let n = 0;
  const walk = suite => {
    for (const child of suite.suites ?? []) walk(child);
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) if ((t.results ?? []).some(r => r.status === 'interrupted')) n += 1;
  };
  for (const suite of report.suites ?? []) walk(suite);
  return n;
}

export function summarizeE2e(report, { exitCode = null, frozenTests = null } = {}) {
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {};
  const failed = readRun(JSON.stringify(report), 'playwright').filter(t => t.status === 'fail');
  const problems = [];
  if (exitCode !== null && exitCode !== 0) problems.push(`Playwright exit code ${exitCode}${exitCode === 124 ? ' (timed out)' : ''}`);
  for (const error of report.errors ?? []) problems.push(`report error: ${String(error.message ?? JSON.stringify(error)).split('\n')[0].slice(0, 200)}`);
  const interrupted = interruptedCount(report);
  if (interrupted > 0) problems.push(`${interrupted} test(s) interrupted`);
  const total = expected + unexpected + flaky + skipped;
  if (frozenTests !== null && total < frozenTests) problems.push(`the report has ${total} tests, fewer than the ${frozenTests} of the frozen e2e suite`);
  const ok = unexpected === 0 && expected > 0 && problems.length === 0;
  const lines = [`desktop-e2e        ${ok ? 'passed' : 'FAILED'}  pass ${expected}, fail ${unexpected}, flaky ${flaky}, skipped ${skipped}, total ${total}`];
  if (skipped > 0) lines.push(`  warning: ${skipped} skipped (macOS-only, env-flag and fixme tests); the skip kinds are in docs/v0.9/test-inventory.json`);
  for (const p of problems) lines.push(`  problem: ${p}`);
  for (const t of failed) lines.push(`  failed: ${t.file}: ${t.name}`);
  return { ok, lines };
}

function main(argv) {
  const args = [...argv];
  const take = flag => { const i = args.indexOf(flag); if (i < 0) return null; const [, value] = args.splice(i, 2); return value ?? null; };
  const codeText = take('--exit-code');
  const inventoryPath = take('--inventory') ?? DEFAULT_INVENTORY;
  let frozenTests = null;
  try { frozenTests = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')).suites?.e2e?.counts?.tests ?? null; } catch { frozenTests = null; }
  let report;
  try { report = JSON.parse(fs.readFileSync(args[0], 'utf8')); } catch (error) { process.stdout.write(`cannot read the e2e record: ${error.message}\n`); return 1; }
  const { ok, lines } = summarizeE2e(report, { exitCode: codeText === null ? null : Number(codeText), frozenTests });
  process.stdout.write(lines.join('\n') + '\n');
  return ok ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
