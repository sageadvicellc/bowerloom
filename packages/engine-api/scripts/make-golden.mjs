#!/usr/bin/env node
// Makes the golden file of the engine API base: packages/engine-api/golden/base-<first 8 characters of the commit>.json.
//
// What it lists, read as text from the library source of apps/desktop (main/engine-*.ts, main/real-*.ts, shared/engine/*.ts, shared/real/*.ts):
//  - every engine call and every reader call, with its argument count (and the one optional extra argument of chooseFolder) and its channel.
//  - the refusal tables: the call refusals, the two named outcomes, the refusals of main that come with words, and the reader's gate codes and own codes.
//  - every code-like literal found in those files (see codeLiteralsOf in scan.mjs for the exact rule), and the files each one was found in.
//  - the SHA-256 of each file it read, so a reader can see which text the file came from.
// It never imports or runs the files it reads. Do not edit the golden file by hand: make it again.
//
// How to regenerate. Check out the commit the golden file should describe (the base release commit for the base file), then run from the repository root:
//
//   node packages/engine-api/scripts/make-golden.mjs --commit "$(git rev-parse HEAD)"
//
// The commit is a flag because this script starts no program, so it cannot ask git. Pass the full 40-character commit of the checked-out source. Use --check to compare
// the file on disk with what the source gives now and print the differences without writing. Exit code 0 means written (or equal with --check), 1 means a difference,
// 2 means a bad flag.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanBase } from './scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? ''; };
const check = args.includes('--check');
const commit = flag('--commit');
if (commit === null || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('usage: node packages/engine-api/scripts/make-golden.mjs --commit <40-character commit of the checked-out source> [--check]');
  process.exit(2);
}

const found = scanBase(root);
const golden = {
  format: 'bowerloom/engine-api-golden/v1',
  commit,
  generatedBy: 'packages/engine-api/scripts/make-golden.mjs',
  note: 'Made by the script above from the library source of apps/desktop at the commit. Do not edit by hand. codeLiterals lists what the scan found; some entries are not codes.',
  sourceFiles: found.sourceFiles,
  engineCalls: found.engineCalls,
  readerCalls: found.readerCalls,
  callRefusals: found.callRefusals,
  namedOutcomes: found.namedOutcomes,
  mainRefusals: found.mainRefusals,
  readerGateRefusals: found.readerGateRefusals,
  readerRefusals: found.readerRefusals,
  codeLiterals: found.codeLiterals,
  codeSources: found.codeSources,
};
const file = path.join(root, 'packages', 'engine-api', 'golden', `base-${commit.slice(0, 8)}.json`);
const text = `${JSON.stringify(golden, null, 2)}\n`;

if (check) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(same ? `${path.relative(root, file)} matches the source` : `${path.relative(root, file)} differs from the source (or is missing)`);
  process.exit(same ? 0 : 1);
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, text);
console.log(`wrote ${path.relative(root, file)}: ${golden.engineCalls.length} engine calls, ${golden.readerCalls.length} reader calls, ${golden.codeLiterals.length} code literals from ${golden.sourceFiles.length} files`);
