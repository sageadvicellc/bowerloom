#!/usr/bin/env node
// Test tooling, never shipped. Makes the frozen 0.8 install fixtures in tests/fixtures/install-0.8/ from the published
// bowerloom@0.8.0-beta.1, in a Docker container that runs as a non-root user. It needs Docker and one registry read (registry.npmjs.org).
// It is not part of `npm test`. The test tools/test/install-08-fixtures.test.mjs checks the files that it writes.
//
//   node tools/fixtures-0.8/make.mjs [--keep]
//
// Steps: build the image of tools/fixtures-0.8/Dockerfile, make a new volume, run phase A with the network on, run phase B with
// `--network none`, copy the result out into a new temporary folder outside the repository, swap each sandbox path for a placeholder,
// and write the six files. --keep leaves the image and the volume in Docker, so a person can look inside them.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(REPO, 'tests', 'fixtures', 'install-0.8');
const INPUT = path.join(REPO, 'tests', 'fixtures', 'harness-08', 'project.json');
const IMAGE = 'bowerloom-fixtures08:dev';
const VOLUME = `bowerloom-fixtures08-${Date.now()}`;
const WORK = '/home/node/work';

/** The caps of each file, in bytes. The folder as a whole stays under TOTAL_CAP. The test reads them from manifest.json. */
export const CAPS = {
  'project.json': 256 * 1024,
  'project-preview.json': 256 * 1024,
  'home-store.json': 64 * 1024,
  'state.json': 512 * 1024,
  'global-prefix.json': 16 * 1024,
  'manifest.json': 32 * 1024,
};
export const TOTAL_CAP = 1.5 * 1024 * 1024;
export const PLACEHOLDERS = ['{{HOME}}', '{{PROJECT}}', '{{STATE}}', '{{PROJECT_ID}}', '{{ROOT}}', '{{EMAIL}}'];
// An address with a name before the @. A pattern such as '%@company.com' in the skill's own text has none, and stays.
const EMAIL = /[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { maxBuffer: 1024 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function must(result, what) {
  if (result.status !== 0) {
    const text = (result.stderr || Buffer.alloc(0)).toString('utf8').slice(0, 4000) + (result.stdout || Buffer.alloc(0)).toString('utf8').slice(0, 2000);
    throw new Error(`${what} failed (exit ${result.status})\n${text}`);
  }
  return result;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const modeOf = stat => (stat.mode & 0o7777).toString(8).padStart(4, '0');

/** Every folder, file, and link under `root`, as relative paths. Files hold text, or base64 when the bytes are not UTF-8. */
function readTree(root) {
  const dirs = {};
  const files = {};
  const links = {};
  const walk = rel => {
    const abs = path.join(root, rel);
    for (const name of fs.readdirSync(abs).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      const stat = fs.lstatSync(path.join(root, childRel));
      if (stat.isSymbolicLink()) links[childRel] = fs.readlinkSync(path.join(root, childRel));
      else if (stat.isDirectory()) {
        dirs[childRel] = modeOf(stat);
        walk(childRel);
      } else if (stat.isFile()) {
        const bytes = fs.readFileSync(path.join(root, childRel));
        let text = null;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
        files[childRel] = text === null ? { mode: modeOf(stat), base64: bytes.toString('base64') } : { mode: modeOf(stat), text };
      }
    }
  };
  walk('');
  return { dirs, files, links };
}

/** Swaps the sandbox paths for the four placeholders, longest first. Throws when any other sandbox path is left. */
function placeholders(text, { home, project, state, projectId }) {
  let out = text.split(state).join('{{STATE}}').split(project).join('{{PROJECT}}').split(home).join('{{HOME}}');
  if (projectId) out = out.split(projectId).join('{{PROJECT_ID}}');
  // A receipt also lists the folders above HOME, as the CLI pins them. They are named from the volume folder, {{ROOT}}.
  // The package metadata that npm keeps (_npmUser, maintainers, author) holds real addresses of people. None goes into a fixture.
  out = out.replace(EMAIL, '{{EMAIL}}');
  out = out.split(`${WORK}`).join('{{ROOT}}').split('"/home/node"').join('"{{ROOT}}/.."').split('"/home"').join('"{{ROOT}}/../.."');
  if (out.includes('/home/node')) throw new Error('A sandbox path is left after the swap: ' + out.slice(Math.max(0, out.indexOf('/home/node') - 40), out.indexOf('/home/node') + 80));
  return out;
}

function swapTree(tree, ctx) {
  const swap = value => placeholders(value, ctx);
  const dirs = {};
  const files = {};
  const links = {};
  for (const [k, v] of Object.entries(tree.dirs)) dirs[swap(k)] = v;
  for (const [k, v] of Object.entries(tree.files)) files[swap(k)] = v.text === undefined ? v : { mode: v.mode, text: swap(v.text) };
  for (const [k, v] of Object.entries(tree.links)) links[swap(k)] = swap(v);
  const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { dirs: sorted(dirs), files: sorted(files), links: sorted(links) };
}

const json = value => JSON.stringify(value, null, 2) + '\n';

function main() {
  const keep = process.argv.includes('--keep');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-08-fixtures-'));
  try {
    must(docker(['build', '-q', '-t', IMAGE, HERE]), 'docker build');
    must(docker(['volume', 'create', VOLUME]), 'docker volume create');
    try {
      // Phase A: the network is on. The project arrives on standard input.
      must(docker(['run', '--rm', '-i', '-v', `${VOLUME}:${WORK}`, IMAGE, 'a'], { input: fs.readFileSync(INPUT) }), 'phase A');
      // Phase B: no network at all.
      must(docker(['run', '--rm', '--network', 'none', '-v', `${VOLUME}:${WORK}`, IMAGE, 'b']), 'phase B');
      // Copy out only what the fixtures need: not the 88 MB package.
      const tar = must(docker(['run', '--rm', '--network', 'none', '-v', `${VOLUME}:${WORK}:ro`, '--entrypoint', 'tar', IMAGE,
        '-C', WORK, '-cf', '-', 'h-main', 'h-preview', 'out', 'prefix/bin', 'prefix/lib/node_modules/bowerloom/package.json']), 'copy out');
      fs.writeFileSync(path.join(temp, 'result.tar'), tar.stdout);
      fs.mkdirSync(path.join(temp, 'result'));
      must(spawnSync('tar', ['-xpf', path.join(temp, 'result.tar'), '-C', path.join(temp, 'result')]), 'tar extract');
    } finally {
      if (!keep) docker(['volume', 'rm', VOLUME]);
    }
    const result = path.join(temp, 'result');

    const stateDirOf = home => path.join(home, '.local', 'state', 'bowerloom');
    const contextOf = home => {
      const state = stateDirOf(home);
      const ids = fs.readdirSync(path.join(result, state.replace(/^\/home\/node\/work\//, ''))).filter(n => n !== 'cache' && n !== 'events');
      if (ids.length !== 1) throw new Error(`Expected one project folder in ${state}, found ${ids.length}`);
      return { home, project: path.join(home, 'project'), state, projectId: ids[0] };
    };
    const homeMain = `${WORK}/h-main`;
    const homePreview = `${WORK}/h-preview`;
    const main = contextOf(homeMain);
    const preview = contextOf(homePreview);
    const rel = abs => path.join(result, abs.slice(WORK.length + 1));

    const project = swapTree(readTree(rel(main.project)), main);
    const projectPreview = swapTree(readTree(rel(preview.project)), preview);
    const store = swapTree(readTree(path.join(rel(main.home), '.bowerloom')), main);
    const state = swapTree(readTree(rel(main.state)), main);

    // The global prefix: each command link and its target, and three fields of the installed package.json. No package code.
    const prefixRoot = path.join(result, 'prefix');
    const binTree = readTree(path.join(prefixRoot, 'bin'));
    const installed = JSON.parse(fs.readFileSync(path.join(prefixRoot, 'lib', 'node_modules', 'bowerloom', 'package.json'), 'utf8'));
    const prefix = {
      about: 'The npm global prefix after `npm install -g bowerloom@0.8.0-beta.1` into an empty prefix. Each key of "links" is a path under the prefix. No package code.',
      links: Object.fromEntries(Object.entries(binTree.links).map(([k, v]) => [`bin/${k}`, v])),
      package: { path: 'lib/node_modules/bowerloom/package.json', fields: { name: installed.name, version: installed.version, bin: installed.bin } },
    };

    const about = (what, extra = '') =>
      `${what} Made by tools/fixtures-0.8/make.mjs from the published bowerloom@0.8.0-beta.1. Each key of "files" is a path with its mode and its text, or base64 when the bytes are not UTF-8. Paths hold the placeholders {{HOME}}, {{PROJECT}}, {{STATE}}, {{PROJECT_ID}}, and {{ROOT}} (the folder above HOME). An address of a person in package metadata is {{EMAIL}}.${extra}`;
    const outputs = {
      'project.json': { about: about('A project after a 0.8 adopt, install for Claude Code and Codex, one skill pin, sync, apply, and lock update.'), ...project },
      'project-preview.json': { about: about('The same synthetic project, adopted and installed with BOWERLOOM_PREVIEW_ENGINES=1 for OpenCode, Pi, and DeepSeek Harness.'), ...projectPreview },
      'home-store.json': { about: about('The store ~/.bowerloom: one skill, one prompt, and one team made with --global, and the pinned skill. No git remote.'), ...store },
      'state.json': { about: about('The private state folder ~/.local/state/bowerloom of the main project. Its project folder id is the placeholder {{PROJECT_ID}}; a state folder is keyed to the real path of a project, so it fits a copy test or a read test, and not a project at a new path.'), ...state },
      'global-prefix.json': prefix,
    };

    const buffers = {};
    for (const [name, value] of Object.entries(outputs)) buffers[name] = Buffer.from(json(value));

    const outFile = name => fs.readFileSync(path.join(result, 'out', name), 'utf8').trim();
    const commands = fs.readFileSync(path.join(result, 'out', 'commands.tsv'), 'utf8').trim().split('\n')
      .map(line => { const [phase, command, exit] = line.split('\t'); return { phase, command, exit: Number(exit) }; });
    const view = JSON.parse(outFile('skill-view.json'));
    const dockerfile = fs.readFileSync(path.join(HERE, 'Dockerfile'), 'utf8');
    const image = /^FROM (\S+)/m.exec(dockerfile)[1];
    const platform = must(docker(['image', 'inspect', IMAGE, '--format', '{{.Os}}/{{.Architecture}}']), 'image inspect').stdout.toString().trim();

    const manifest = {
      about: 'How the install-0.8 fixtures were made. Written by tools/fixtures-0.8/make.mjs. The file hashes below are of the other five files.',
      package: { name: 'bowerloom', version: '0.8.0-beta.1', registry: 'https://registry.npmjs.org', integrity: outFile('tarball-integrity.txt') },
      node: outFile('node-version.txt'),
      npm: outFile('npm-version.txt'),
      image,
      platform,
      runsAs: 'the image user node (non-root); HOME is a new folder; XDG_STATE_HOME, BOWERLOOM_GITHUB_TOKEN, and BOWERLOOM_EVENT_LOG are unset',
      skillPin: { spec: 'npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections', name: view.name, version: view.version, license: view.license, integrity: view['dist.integrity'] },
      movedToPhaseA: [{
        step: 'skills sync',
        alsoMoved: ['write project', 'harness adopt', 'harness install', 'skill create --global', 'prompt create --global', 'team create --global', 'use skill', 'lock update'],
        reason: 'SKILLS_OFFLINE: the pin that phase A cached read as partial and unreadable in a second container, and the cause is not known. skills sync fetches the pin, so it runs with the network on.',
      }],
      notes: [
        'Both adopt steps pass --every-engine guardrails, hooks, and mcp, so that the rule and the hook reach every engine of the harness. Without it the preview engines get no hook or MCP file. Each line that an engine carries more weakly is accepted with harness accept.',
        'The preview project is adopted with OpenCode 1.18.30, Pi 1.4.0, and DeepSeek Harness 0.2.2-alpha.2, the versions that 0.8 writes locked-in parts for, and installed with BOWERLOOM_PREVIEW_ENGINES=1.',
        'The lock holds only the pinned skill: a skill, prompt, or team written in the store is checked against its pushed copy on github.com, so the project uses only the pin.',
        'The teams made here have no agents folder, so apply writes no .claude/agents file.',
      ],
      commands,
      placeholders: PLACEHOLDERS,
      totalCapBytes: TOTAL_CAP,
      files: Object.fromEntries(Object.entries(buffers).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes), capBytes: CAPS[name] }])),
      manifestCapBytes: CAPS['manifest.json'],
    };
    const manifestBytes = Buffer.from(json(manifest));
    const total = Object.values(buffers).reduce((n, b) => n + b.length, manifestBytes.length);
    for (const [name, bytes] of Object.entries({ ...buffers, 'manifest.json': manifestBytes })) {
      if (bytes.length > CAPS[name]) throw new Error(`${name} is ${bytes.length} bytes, over its cap of ${CAPS[name]}`);
    }
    if (total > TOTAL_CAP) throw new Error(`The folder is ${total} bytes, over ${TOTAL_CAP}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, bytes] of Object.entries({ ...buffers, 'manifest.json': manifestBytes })) fs.writeFileSync(path.join(OUT_DIR, name), bytes);
    console.log(`Wrote ${Object.keys(buffers).length + 1} files, ${total} bytes, to ${OUT_DIR}`);
    if (keep) console.log(`Kept the image ${IMAGE} and the volume ${VOLUME}.`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
