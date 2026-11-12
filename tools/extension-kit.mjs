#!/usr/bin/env node
// The Extensions harness of v0.9, never shipped. Safety class: local-write (check and list only read).
// Makes, checks, installs and removes a stock extension of the desktop app. The extension API page is docs/v0.9/extension-api.md.
//   node tools/extension-kit.mjs new <id> [--title TEXT] [--json]      makes apps/desktop/extensions/<id>/manifest.json and a screen file from the template, and prints the two lines to add to the mount table
//   node tools/extension-kit.mjs check [<folder>] [--json]             reads every folder of apps/desktop/extensions as the app loads it, and says what the app would refuse, with the app's codes
//   node tools/extension-kit.mjs install-template [--json]             copies the template manifest into apps/desktop/extensions, which installs the template extension
//   node tools/extension-kit.mjs remove <folder> [--json]              deletes one folder of apps/desktop/extensions, which removes the extension and its routes at the next start
//   node tools/extension-kit.mjs list [--json]                        lists the extensions the app would register, and each problem
// Only stock extensions exist in v0.9: the manifest folders ship inside the app, and every screen is compiled into it. The kit loads no code, runs no code, and edits no source file.
// `new` writes two files and never writes over a file. `remove` deletes only a real folder that holds plain files, and refuses a link.
// Exit 0: done. Exit 1: refused, or `check` found a problem. Exit 2: wrong use, or an internal error (with --json, one object {ok:false, exit:2, error}).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFlag, jsonWanted, seamRefusal, boolValueRefusal, flagLikeValueRefusal, reportUsage, guarded, entryState, mismatchMessage } from './lib/cli.mjs';
import { KitError, MOUNTS_FILE, checkTree, installTemplate, listTree, removeExtension, scaffold } from './lib/extension-kit.mjs';

const USAGE = `Usage: node tools/extension-kit.mjs <new|check|install-template|remove|list> [options]
  new <id> [--title TEXT]   Makes apps/desktop/extensions/<id>/manifest.json and a screen file from the template.
      The id is lowercase letters, digits and hyphens. It is also the route. It prints the two lines to add to ${MOUNTS_FILE}. It edits no source file.
  check [<folder>]          Reads each folder of apps/desktop/extensions as the app loads it. Exit 1 when the app would refuse one, with the code the app gives.
  install-template          Copies the template manifest into apps/desktop/extensions. The screen of the template is already in the app.
  remove <folder>           Deletes one folder of apps/desktop/extensions. The routes of that extension are gone at the next start. A link is refused.
  list                      Lists the extensions the app would register, and each problem.
  --json   print one JSON object on stdout (also for a usage error: {ok:false, exit:2, error})
  --root ABS_DIR   use another repository root (a test seam: needs BOWERLOOM_TOOLS_TEST_MODE=1)
A flag that takes no value (--json) rejects one: --json=x is a usage error.
Exit 0: done. Exit 1: refused or a problem found. Exit 2: wrong use.`;

const COMMANDS = Object.freeze({ new: 1, check: [0, 1], 'install-template': 0, remove: 1, list: 0 });
const FLAGS = Object.freeze({ new: ['--title', '--json', '--root'], check: ['--json', '--root'], 'install-template': ['--json', '--root'], remove: ['--json', '--root'], list: ['--json', '--root'] });

export function parseArgs(argv, env = process.env) {
  const out = { help: false, usage: null, command: null, positional: [], title: null, root: null, json: false };
  const bad = message => { out.usage = message; return out; };
  if (argv.includes('--help') || argv.includes('-h')) { out.help = true; return out; }
  const [command, ...rest] = argv;
  if (!command) return bad('a command is required: new, check, install-template, remove, or list');
  if (!Object.hasOwn(COMMANDS, command)) return bad(`unknown command: ${command}`);
  out.command = command;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) { out.positional.push(arg); continue; }
    const { flag, value: inline } = splitFlag(arg);
    if (!FLAGS[command].includes(flag)) return bad(`${command}: unknown argument ${arg}`);
    if (flag === '--json') {
      const refusal = boolValueRefusal(flag, inline);
      if (refusal) return bad(refusal);
      out.json = true;
      continue;
    }
    const seam = flag === '--root' ? seamRefusal(flag, env) : null;
    if (seam) return bad(seam);
    const flagLike = flagLikeValueRefusal(flag, inline);
    if (flagLike) return bad(flagLike);
    let value = inline;
    if (value === null) { value = rest[i + 1]; if (value === undefined || value.startsWith('--')) return bad(`${flag} needs a value`); i++; }
    if (flag === '--title') out.title = value; else out.root = value;
  }
  const want = COMMANDS[command];
  const [min, max] = Array.isArray(want) ? want : [want, want];
  if (out.positional.length < min) return bad(`${command} needs ${command === 'new' ? 'an id' : 'a folder name'}`);
  if (out.positional.length > max) return bad(`${command} takes ${max === 0 ? 'no name' : 'one name'}, and got ${out.positional.length}`);
  return out;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bullet = (list, indent = '  ') => list.map(line => `${indent}${line}`).join('\n');

/** The result of one command as a plain object. A refusal of the kit becomes { ok: false, code, message }. */
export function runCommand(args, root = REPO_ROOT) {
  try {
    switch (args.command) {
      case 'new': {
        const made = scaffold(root, { id: args.positional[0], title: args.title });
        return { ok: true, command: 'new', id: made.id, created: made.created, next: made.next };
      }
      case 'install-template': {
        const made = installTemplate(root);
        return { ok: true, command: 'install-template', id: made.id, created: made.created };
      }
      case 'remove': {
        const gone = removeExtension(root, args.positional[0]);
        return { ok: true, command: 'remove', name: gone.name, removed: gone.removed };
      }
      case 'check': {
        const found = checkTree(root, args.positional[0] ?? null);
        return { ok: found.problems.length === 0, command: 'check', extensions: found.extensions, problems: found.problems };
      }
      default: {
        const found = listTree(root);
        return { ok: true, command: 'list', extensions: found.extensions, problems: found.problems };
      }
    }
  } catch (error) {
    if (error instanceof KitError) return { ok: false, command: args.command, code: error.code, message: error.message };
    throw error;
  }
}

/** The text of a result, for a person. */
export function format(result) {
  if (result.code !== undefined) return `extension-kit: REFUSED (${result.code}). ${result.message}\n`;
  const lines = [];
  if (result.command === 'new') {
    lines.push(`extension-kit: made the extension "${result.id}".`, bullet(result.created.map(file => `wrote ${file}`)));
    lines.push(`Add these two lines to apps/desktop/renderer/harness/extension-mounts.tsx. The import goes with the other imports, and the table line goes inside BUNDLED_MOUNTS.`, bullet([result.next.importLine, result.next.tableLine]));
    lines.push(`Then run: node tools/extension-kit.mjs check ${result.id}`);
  } else if (result.command === 'install-template') lines.push(`extension-kit: installed the template extension "${result.id}".`, bullet(result.created.map(file => `wrote ${file}`)));
  else if (result.command === 'remove') lines.push(`extension-kit: removed "${result.name}".`, bullet(result.removed.map(file => `deleted ${file}`)));
  else {
    lines.push(`extension-kit: ${result.extensions.length} extension${result.extensions.length === 1 ? '' : 's'} the app would register.`);
    for (const e of result.extensions) lines.push(`  ${e.id} (routes: ${e.routes.join(', ')})`);
    for (const p of result.problems) lines.push(`  PROBLEM ${p.name}: ${p.code}. ${p.message}`);
    if (result.command === 'check') lines.push(result.ok ? 'extension-kit: nothing the app would refuse.' : `extension-kit: ${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}.`);
  }
  return lines.join('\n') + '\n';
}

export async function main(argv, { out = process.stdout, err = process.stderr, env = process.env } = {}) {
  const json = jsonWanted(argv);
  return guarded('extension-kit', { json, out, err }, async () => {
    const args = parseArgs(argv, env);
    if (args.help) { out.write(USAGE + '\n'); return 0; }
    if (args.usage !== null) return reportUsage('extension-kit', args.usage, USAGE, { json, out, err });
    if (args.root !== null && !path.isAbsolute(args.root)) return reportUsage('extension-kit', '--root must be an absolute path', USAGE, { json, out, err });
    const result = runCommand(args, args.root ?? REPO_ROOT);
    out.write(args.json ? JSON.stringify({ ...result, ...(result.ok ? {} : { exit: 1 }) }) + '\n' : format(result));
    return result.ok ? 0 : 1;
  });
}

const entry = entryState(process.argv[1], import.meta.url);
if (entry === 'main') process.exitCode = await main(process.argv.slice(2));
else if (entry === 'mismatch') {
  process.stderr.write(mismatchMessage('extension-kit', process.argv[1], import.meta.url));
  process.exitCode = 2;
}
