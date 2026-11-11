#!/usr/bin/env node
// Test tooling, never shipped. Prints one line for each step of the JSON files that `node tools/gates.mjs --json` wrote.
//   node tools/sandbox/summarize-gates.mjs <gates.json> [<gates.json> ...]
//   [--ceilings <skip-ceilings.json>]
// Exit 0 when every run passed. Exit 1 when a step failed, when a step skipped more tests than its ceiling in skip-ceilings.json,
// or when a file is missing or cannot be read. A skip is not a pass, and the sandbox cannot see one that a test adds, so the ceiling does.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_CEILINGS = fileURLToPath(new URL('./skip-ceilings.json', import.meta.url));

/** The steps of a report whose skipped count is above their ceiling, as lines. A step with no ceiling is not limited. */
export function overCeiling(report, ceilings) {
  return (report.steps ?? []).filter(step => step.counts != null && Number.isInteger(ceilings[step.name]) && step.counts.skipped > ceilings[step.name])
    .map(step => `${step.name.padEnd(18)} FAILED  skipped ${step.counts.skipped}, above the ceiling of ${ceilings[step.name]} (tools/sandbox/skip-ceilings.json)`);
}

export function summarize(report) {
  const lines = report.steps.map(step => {
    const counts = step.counts == null ? '' : `  pass ${step.counts.pass}, fail ${step.counts.fail}, skipped ${step.counts.skipped}`;
    return `${step.name.padEnd(18)} ${step.passed ? 'passed' : 'FAILED'}${counts}${step.passed ? '' : `  (${step.firstFailure ?? `exit ${step.exitCode}`})`}`;
  });
  if (report.refused) lines.push(`refused: ${report.refused}`);
  if ((report.notRun ?? []).length > 0) lines.push(`not run: ${report.notRun.join(', ')}`);
  return lines;
}

/** The step a file name asks for: gates-<step>.json. Null for any other name. */
const requestedStep = file => (/(?:^|\/)gates-([a-z-]+)\.json$/.exec(file) ?? [])[1] ?? null;

function main(argv) {
  const args = [...argv];
  const at = args.indexOf('--ceilings');
  const ceilingsPath = at >= 0 ? args.splice(at, 2)[1] : DEFAULT_CEILINGS;
  let ceilings = {};
  let ok = true;
  try { ceilings = JSON.parse(fs.readFileSync(ceilingsPath, 'utf8')); } catch (error) { process.stdout.write(`cannot read the skip ceilings ${ceilingsPath}: ${error.message}\n`); ok = false; }
  const files = args;
  ok = ok && files.length > 0;
  for (const file of files) {
    let report;
    try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { process.stdout.write(`cannot read the gates record ${file}: ${error.message}\n`); ok = false; continue; }
    process.stdout.write(summarize(report).join('\n') + '\n');
    if (report.ok !== true) ok = false;
    const over = overCeiling(report, ceilings);
    if (over.length > 0) { process.stdout.write(over.join('\n') + '\n'); ok = false; }
    const wanted = requestedStep(file);
    if (wanted !== null && !(report.steps ?? []).some(step => step.name === wanted)) { process.stdout.write(`step ${wanted} is missing from ${file}\n`); ok = false; }
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
