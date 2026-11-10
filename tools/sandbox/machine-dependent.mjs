#!/usr/bin/env node
// Test tooling, never shipped. Reports whether the machine-dependent tests of the frozen inventory passed in a recording.
//   node tools/sandbox/machine-dependent.mjs <reporter-output.jsonl> [<inventory.json>] [--node-exit N]
// It reads the names of the frozen skips of kind machine-dependent (root suite) and matches them by test name against the JSON lines of
// tools/inventory-reporter.mjs. It never writes the inventory. The node --test exit code, when given, is printed and does not change the exit status. Exit 0 when each name passed. Exit 1 when one skipped, failed or is missing.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readRun, MACHINE_DEPENDENT } from '../test-inventory.mjs';

const DEFAULT_INVENTORY = fileURLToPath(new URL('../../docs/v0.9/test-inventory.json', import.meta.url));

function main(args) {
  const argv = [...args];
  const at = argv.indexOf('--node-exit');
  const nodeExit = at < 0 ? null : Number(argv.splice(at, 2)[1]);
  let run;
  try { run = readRun(fs.readFileSync(argv[0], 'utf8'), 'jsonl'); } catch (error) { process.stdout.write(`cannot read the recording: ${error.message}\n`); return 1; }
  const frozen = JSON.parse(fs.readFileSync(argv[1] ?? DEFAULT_INVENTORY, 'utf8')).suites.root.skips.filter(s => s.kind === MACHINE_DEPENDENT);
  if (frozen.length === 0 || run.length === 0) { process.stdout.write(`nothing to check: ${frozen.length} frozen names, ${run.length} recorded tests\n`); return 1; }
  let ok = true;
  for (const s of frozen) {
    const found = run.filter(t => t.name === s.name);
    const status = found.length === 0 ? 'missing' : found.every(t => t.status === 'pass') ? 'pass' : found.map(t => t.status).find(x => x !== 'pass');
    if (status !== 'pass') ok = false;
    process.stdout.write(`${status.padEnd(7)} ${s.name}\n`);
  }
  if (nodeExit !== null) process.stdout.write(`node --test exit code: ${nodeExit} (logged only: other tests of the same files can fail for root; the verdict is the four names)\n`);
  process.stdout.write(`${frozen.length} machine-dependent tests: ${ok ? 'all passed' : 'not all passed'}\n`);
  return ok ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
