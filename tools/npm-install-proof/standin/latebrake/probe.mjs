#!/usr/bin/env node
// Test tooling, never shipped. The echo probe behind every command of the stand-in package.
// It writes one JSON line to stdout: the command, the package and version it belongs to, its arguments, and the text it read on
// standard input. It writes one fixed line to stderr. The argument --exit=N sets the exit code, and --quiet writes nothing to stdout.
// The command name comes from the name that started the process. A forwarding shim runs this file in its own process, so the
// name still reads as the old command, and the probe maps it to the new one: both print the same bytes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const record = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const started = path.basename(process.argv[1] ?? 'probe').replace(/\.[cm]?js$/, '');
const command = started.replace(/^bowerloom(?=$|-)/, 'latebrake');
const args = process.argv.slice(2);
const option = key => {
  const found = args.find(arg => arg.startsWith(`--${key}=`));
  return found === undefined ? undefined : found.slice(key.length + 3);
};

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString('utf8');

if (!args.includes('--quiet')) {
  process.stdout.write(`${JSON.stringify({ command, package: record.name, version: record.version, args, input })}\n`);
}
process.stderr.write('probe: fixed stderr line\n');
process.exitCode = Number(option('exit') ?? 0);
