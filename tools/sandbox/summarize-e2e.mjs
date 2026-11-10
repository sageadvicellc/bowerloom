#!/usr/bin/env node
// Test tooling, never shipped. Prints the counts of a `playwright test --reporter=json` file, and the title of each failed test.
//   node tools/sandbox/summarize-e2e.mjs <e2e.json>
// Exit 0 when no test failed and at least one passed. Exit 1 on a failure, on a run with no passing test, and on a missing or unreadable file.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readRun } from '../test-inventory.mjs';

export function summarizeE2e(report) {
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {};
  const failed = readRun(JSON.stringify(report), 'playwright').filter(t => t.status === 'fail');
  const lines = [`desktop-e2e        ${unexpected === 0 && expected > 0 ? 'passed' : 'FAILED'}  pass ${expected}, fail ${unexpected}, flaky ${flaky}, skipped ${skipped}`];
  for (const t of failed) lines.push(`  failed: ${t.file}: ${t.name}`);
  return { ok: unexpected === 0 && expected > 0, lines };
}

function main(argv) {
  let report;
  try { report = JSON.parse(fs.readFileSync(argv[0], 'utf8')); } catch (error) { process.stdout.write(`cannot read the e2e record: ${error.message}\n`); return 1; }
  const { ok, lines } = summarizeE2e(report);
  process.stdout.write(lines.join('\n') + '\n');
  return ok ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
