#!/usr/bin/env node
// One-time setup for the Codex live checks (g4, g7, g8, g9). Tooling for the repository, never shipped.
//
//   node tools/step5/live/codex-trust-setup.mjs <root>
//
// Codex saves trust for one project path and one hook hash. A random scratch folder per run cannot hold either. This script
// makes the fixed root that BOWERLOOM_LIVE_CODEX_ROOT names: the marker file, `<root>/project` with `git init` (Codex picks
// the project root by its .git folder), the log stub, and the one hook file that the checks use. Then it prints the three steps
// a person does by hand. It reads no environment value, prints none, and makes no engine call.
//
// Only check g7 defines a hook. Checks g4, g8, and g9 write project config and rules, which need folder trust and no hook
// review. Their files differ per check and each run writes them. The g7 hook file is identical on every run, because the
// stub path, the log path, and the label are fixed by the root.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODEX_ROOT_VARIABLE, makeScratch } from './lib.mjs';
import { g7Project } from './projects.mjs';

const USAGE = 'usage: node tools/step5/live/codex-trust-setup.mjs <root>\n  <root> is an absolute path to an empty or new folder, outside the system temp folder.\n';
const quote = text => `"${String(text).replace(/(["\\$`])/g, '\\$1')}"`;

/** Makes the root and returns its real path. `write` receives the text to show the person. */
export function setup(root, { write = text => process.stdout.write(text) } = {}) {
  const sc = makeScratch('bowerloom-live-codex-trust', { fixedBase: root });
  try {
    sc.write(g7Project(sc, 'codex').files).gitInit();
    if (!fs.existsSync(path.join(sc.project, '.git'))) throw new Error('git init did not make a .git folder in the project. Check that git is installed.');
  } finally { sc.release(); } // keep the files: the person trusts this project next
  const project = sc.project;
  write([
    'The Codex root is ready.',
    '',
    `Root: ${sc.base}`,
    `Project: ${project}`,
    `Hook file: ${path.join(project, '.codex/hooks.json')}`,
    '',
    'Do these three steps by hand, once:',
    `1. Start Codex in the project: cd ${quote(project)} && codex`,
    '2. Accept the trust prompt for the folder.',
    '3. Type /hooks, review the hook and trust it, then quit Codex.',
    '',
    'Then set these two variables for the live Codex checks:',
    `export ${CODEX_ROOT_VARIABLE}=${quote(sc.base)}`,
    'export BOWERLOOM_LIVE_CODEX_TRUSTED=1',
    '',
    'Only check g7 uses a hook. Its hook file is the same on every run, so the trust you gave holds.',
    'Checks g4, g8, and g9 write project config and rules, which need the folder trust only.',
    'Keep the root where it is. If you move it or choose another root, run this script and the three steps again.',
    '',
  ].join('\n'));
  return sc.base;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [root, ...extra] = process.argv.slice(2);
  if (!root || extra.length) { process.stderr.write(USAGE); process.exit(2); }
  try { setup(root); } catch (error) { process.stderr.write(`codex-trust-setup: ${error.message}\n`); process.exit(1); }
}
