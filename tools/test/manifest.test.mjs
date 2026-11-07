import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/manifest.json'), 'utf8'));
const CLASSES = new Set(['read-only', 'local-write', 'remote-write', 'human-only']);
const TYPE = /^(?:boolean|number|string|array|object)(?:\|(?:boolean|number|string|array|object|null))*(?: \([a-z, -]+\))?$/;
const SUBCOMMANDS = new Set(['create', 'remove', 'list']);
// The release subcommands and their classes, as agreed for the release script. The manifest must list exactly these.
const RELEASE = {
  status: 'read-only', preflight: 'read-only', gates: 'local-write', 'dry-run': 'local-write', publish: 'human-only', hashes: 'local-write',
  verify: 'read-only', tag: 'local-write', 'push-tag': 'human-only', retire: 'human-only', claims: 'read-only',
};
const exists = rel => fs.existsSync(path.join(root, rel));
// A script under scripts/ may not be written yet. Once the file exists, every check below applies to it.
const pending = entry => entry.path.startsWith('scripts/') && !exists(entry.path);

test('the manifest has the schema and a non-empty tools list', () => {
  assert.equal(manifest.schema, 'bowerloom/tools-manifest/v1');
  assert.ok(Array.isArray(manifest.tools) && manifest.tools.length > 0);
  assert.deepEqual(Object.keys(manifest).sort(), ['safetyClassNote', 'schema', 'tools']);
  assert.equal(manifest.safetyClassNote, 'read-only means: changes no tracked file, remote, or registry. It may update remote-tracking git refs and write logs and receipts under .trellis.');
});

test('every entry has the required fields in the right shape', () => {
  for (const entry of manifest.tools) {
    const where = `entry ${entry.name}`;
    for (const key of ['name', 'path', 'description', 'example']) assert.ok(typeof entry[key] === 'string' && entry[key].trim() !== '', `${where}: ${key}`);
    const extra = Object.keys(entry).filter(key => !['name', 'path', 'description', 'args', 'output', 'safetyClass', 'example', 'help'].includes(key));
    assert.deepEqual(extra, [], `${where}: unknown keys`);
    assert.ok(CLASSES.has(entry.safetyClass), `${where}: safetyClass ${entry.safetyClass}`);
    assert.ok(!entry.description.includes('\n') && /[.]$/.test(entry.description), `${where}: description is one line ending in a full stop`);
    assert.ok(Array.isArray(entry.args), `${where}: args`);
    for (const arg of entry.args) {
      assert.ok(typeof arg.name === 'string' && arg.name !== '', `${where}: arg name`);
      assert.equal(typeof arg.required, 'boolean', `${where}: ${arg.name} required`);
      assert.ok(typeof arg.description === 'string' && arg.description !== '', `${where}: ${arg.name} description`);
      assert.deepEqual(Object.keys(arg).sort(), ['description', 'name', 'required'], `${where}: ${arg.name} keys`);
    }
    assert.ok(['json', 'text'].includes(entry.output?.format), `${where}: output.format`);
    assert.equal(typeof entry.output.keys, 'object', `${where}: output.keys`);
    assert.deepEqual(Object.keys(entry.output).filter(key => !['format', 'keys', 'note', 'optional'].includes(key)), [], `${where}: unknown output keys`);
    if ('optional' in entry.output) {
      assert.ok(Array.isArray(entry.output.optional) && entry.output.optional.length > 0, `${where}: output.optional is a non-empty list`);
      assert.equal(new Set(entry.output.optional).size, entry.output.optional.length, `${where}: optional has no duplicates`);
      for (const key of entry.output.optional) assert.ok(key in entry.output.keys, `${where}: optional key ${key} is listed in keys`);
    }
    for (const [key, type] of Object.entries(entry.output.keys)) assert.match(type, TYPE, `${where}: output key ${key}`);
    if (entry.output.format === 'text') assert.deepEqual(entry.output.keys, {}, `${where}: a text tool has no JSON keys`);
    else assert.ok(Object.keys(entry.output.keys).length > 0, `${where}: a JSON tool lists its keys`);
    if ('help' in entry) assert.equal(typeof entry.help, 'boolean', `${where}: help`);
    assert.ok(entry.example.startsWith('node ') && entry.example.includes(entry.path), `${where}: example runs the tool at its path`);
  }
});

test('names are unique and paths are plain repository-relative files', () => {
  const names = manifest.tools.map(entry => entry.name);
  assert.equal(new Set(names).size, names.length, 'duplicate names');
  for (const entry of manifest.tools) {
    assert.ok(!path.isAbsolute(entry.path) && !entry.path.split('/').includes('..'), `${entry.name}: path ${entry.path}`);
    assert.match(entry.path, /^(?:tools|scripts)\/[A-Za-z0-9_./-]+\.mjs$/, entry.name);
  }
});

test('every path exists, except a scripts/ file that is not written yet', () => {
  for (const entry of manifest.tools) {
    if (pending(entry)) continue;
    assert.ok(exists(entry.path), `${entry.name}: ${entry.path} is missing`);
    assert.ok(fs.statSync(path.join(root, entry.path)).isFile(), `${entry.name}: ${entry.path} is not a file`);
  }
});

test('the three new tools are listed with the agreed classes', () => {
  const byName = Object.fromEntries(manifest.tools.map(entry => [entry.name, entry]));
  assert.equal(byName.gates?.safetyClass, 'local-write');
  assert.equal(byName['lane-tree']?.safetyClass, 'local-write');
  assert.equal(byName['public-scan']?.safetyClass, 'read-only');
  for (const name of ['gates', 'lane-tree', 'public-scan']) assert.equal(byName[name].help, true, name);
});

test('the release entries are exactly the agreed subcommands, with the agreed classes', () => {
  const entries = manifest.tools.filter(entry => entry.name.startsWith('release:'));
  assert.deepEqual(Object.fromEntries(entries.map(entry => [entry.name.slice('release:'.length), entry.safetyClass])), RELEASE);
  for (const entry of entries) assert.equal(entry.path, 'scripts/release.mjs');
});

test('a tool that says it has --help exits 0 on --help', () => {
  const seen = new Set();
  for (const entry of manifest.tools) {
    if (entry.help !== true || pending(entry) || seen.has(entry.path)) continue;
    seen.add(entry.path);
    const run = spawnSync(process.execPath, [path.join(root, entry.path), '--help'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 0, `${entry.path} --help exited ${run.status}\n${run.stderr}`);
    assert.ok(run.stdout.trim() !== '', `${entry.path} --help printed nothing`);
  }
  assert.ok(seen.size >= 3, 'at least the three new tools were checked');
});

test('a tool that is not marked as having --help is never run by this test', () => {
  // The older check tools run their check when started, so they are not started here.
  for (const entry of manifest.tools) if (entry.help !== true) assert.ok(!entry.example.includes('--help'), entry.name);
});

/** The subcommands that scripts/release.mjs reports for --manifest, as { name: class }. Null when the script is absent or has no --manifest. */
function releaseManifest() {
  if (!exists('scripts/release.mjs')) return null;
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/release.mjs'), '--manifest'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (run.status !== 0) return null; // The script does not support --manifest yet.
  const parsed = JSON.parse(run.stdout);
  const list = Array.isArray(parsed) ? parsed : parsed.commands ?? parsed.subcommands;
  assert.ok(Array.isArray(list), 'release --manifest lists its subcommands');
  return Object.fromEntries(list.map(item => [item.name, item.class ?? item.safetyClass]));
}

test('once scripts/release.mjs supports --manifest, its subcommands and classes equal the release entries', t => {
  const reported = releaseManifest();
  if (reported === null) { t.skip('scripts/release.mjs is absent or has no --manifest yet'); return; }
  const listed = Object.fromEntries(manifest.tools.filter(entry => entry.name.startsWith('release:')).map(entry => [entry.name.slice('release:'.length), entry.safetyClass]));
  assert.deepEqual(reported, listed);
  assert.deepEqual(reported, RELEASE);
});

// ---- Flags and output keys must match what the tools really have ----

const byName = Object.fromEntries(manifest.tools.map(entry => [entry.name, entry]));
const flagOf = arg => (arg.name.startsWith('--') ? arg.name.split(/\s+/)[0] : null);
const flagsOf = entry => new Set(entry.args.map(flagOf).filter(Boolean));
// Flags that exist only as test seams (they need BOWERLOOM_TOOLS_TEST_MODE=1) and stay out of the manifest.
const SEAMS = { gates: new Set(['--timeout-seconds', '--root', '--lock-dir']), 'lane-tree': new Set(['--source']), 'public-scan': new Set() };

test('the flags of gates, lane-tree, and public-scan equal the flags in their --help text, apart from the test seams', () => {
  for (const name of ['gates', 'lane-tree', 'public-scan']) {
    const entry = byName[name];
    const help = spawnSync(process.execPath, [path.join(root, entry.path), '--help'], { cwd: root, encoding: 'utf8', timeout: 60000 }).stdout;
    const inHelp = new Set([...help.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*)/g)].map(match => match[1]));
    inHelp.delete('--help');
    for (const seam of SEAMS[name]) inHelp.delete(seam);
    // lane-tree describes its list --root with the others; gates documents --root as a seam only.
    assert.deepEqual([...flagsOf(entry)].sort(), [...inHelp].sort(), `${name}: manifest flags against --help`);
    for (const seam of SEAMS[name]) assert.ok(!flagsOf(entry).has(seam), `${name}: ${seam} is a test seam and stays out of the manifest`);
  }
});

test('--force is listed only on release gates, dry-run, and hashes', () => {
  for (const entry of manifest.tools.filter(item => item.name.startsWith('release:'))) {
    assert.equal(flagsOf(entry).has('--force'), ['release:gates', 'release:dry-run', 'release:hashes'].includes(entry.name), entry.name);
  }
});

test('the flags of each release entry equal the flags of the subcommand in scripts/release.mjs', async t => {
  if (!exists('scripts/release.mjs')) { t.skip('scripts/release.mjs is absent'); return; }
  const { COMMANDS } = await import(pathToFileURL(path.join(root, 'scripts/release.mjs')).href);
  if (!Array.isArray(COMMANDS)) { t.skip('scripts/release.mjs does not export COMMANDS'); return; }
  for (const command of COMMANDS) {
    const entry = byName[`release:${command.name}`];
    assert.ok(entry, `release:${command.name} is listed`);
    const expected = new Set(['--json', '--repo', ...command.flags, ...(['gates', 'dry-run', 'hashes'].includes(command.name) ? ['--force'] : [])]);
    assert.deepEqual([...flagsOf(entry)].sort(), [...expected].sort(), command.name);
  }
});

/** The text between the brace that opens at `open` and its matching brace, with strings and comments skipped. Null when it does not close. */
function braceBody(source, open) {
  let depth = 0, quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) return null; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  return null;
}
/** The names of the properties written directly in an object-literal body: `a: 1`, `'b': 2`, and the shorthand `c`. A spread is skipped. */
function literalKeys(body) {
  const parts = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map(part => /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(part)).filter(Boolean).map(match => match[1] ?? match[2] ?? match[3]);
}
/** The keys of each object literal passed as an argument to a call of any function in `names` (done(msg, {..}), new StepFailure(msg, {..})). */
function keysPassedTo(source, names) {
  const found = new Set();
  for (const call of source.matchAll(new RegExp(`\\b(?:${names.join('|')})\\(`, 'g'))) {
    const args = braceBody(source, call.index + call[0].length - 1);
    if (args === null) continue;
    for (const literal of args.matchAll(/(?<![\w$)\]])\s*\{/g)) {
      const body = braceBody(args, literal.index + literal[0].length - 1);
      if (body !== null) for (const key of literalKeys(body)) found.add(key);
    }
  }
  return found;
}
const COMMON = ['schema', 'command', 'ok', 'outcome', 'exit', 'message', 'version'];
const releaseEntries = () => manifest.tools.filter(item => item.name.startsWith('release:'));
const releaseKeyUnion = () => new Set(releaseEntries().flatMap(entry => Object.keys(entry.output.keys)));

test('each release entry lists the common result keys, and marks the keys that some results lack as optional', () => {
  for (const entry of releaseEntries()) {
    for (const key of COMMON) assert.ok(key in entry.output.keys, `${entry.name}: ${key}`);
    const optional = entry.output.optional ?? [];
    for (const key of ['schema', 'ok', 'outcome', 'exit', 'message']) assert.ok(!optional.includes(key), `${entry.name}: ${key} is in every result`);
    for (const key of ['command', 'version']) assert.ok(optional.includes(key), `${entry.name}: ${key} is absent or null in a usage error`);
    for (const [key, type] of Object.entries(entry.output.keys)) assert.doesNotMatch(type, /\(failure\)/, `${entry.name}: ${key}: failure-only keys are listed in optional, not in the type`);
  }
  const gates = byName['release:gates'].output;
  for (const key of ['ran', 'commit', 'command', 'freeGiB', 'floorGiB', 'gate', 'log', 'gates']) assert.ok(gates.optional.includes(key), `release:gates: ${key} is optional`);
});

test('every key written in an emit({...}) literal or in the data a release subcommand returns is listed by some release entry', t => {
  if (!exists('scripts/release.mjs')) { t.skip('scripts/release.mjs is absent'); return; }
  const source = fs.readFileSync(path.join(root, 'scripts/release.mjs'), 'utf8');
  const emitted = keysPassedTo(source, ['emit']);
  assert.ok(emitted.size >= 5, `found the emit literals (${[...emitted].join(', ')})`);
  const envelope = [...source.matchAll(/const out = \{\s*schema: RESULT_SCHEMA,/g)];
  assert.equal(envelope.length, 1, 'the envelope literal that adds schema is still where this test looks');
  const listed = releaseKeyUnion();
  for (const key of [...emitted, 'schema']) assert.ok(listed.has(key) || ['usage', 'commands'].includes(key), `emit key ${key} is not in any release entry`);
  // Data returned by a subcommand: done(msg, {..}), alreadyDone(msg, {..}), humanOnly(.., {..}), new StepFailure(msg, {..}).
  const data = keysPassedTo(source, ['done', 'alreadyDone', 'humanOnly', 'StepFailure']);
  assert.ok(data.size >= 8, `found the data literals (${[...data].join(', ')})`);
  for (const key of data) assert.ok(listed.has(key), `data key ${key} is not in any release entry`);
});

test('a key a release entry lists is written as an object key in scripts/release.mjs, not only mentioned there', t => {
  if (!exists('scripts/release.mjs')) { t.skip('scripts/release.mjs is absent'); return; }
  const source = fs.readFileSync(path.join(root, 'scripts/release.mjs'), 'utf8');
  const written = new Set([...source.matchAll(/(?:[{,]|^)\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*(?=[:,}])/gm)].map(match => match[1] ?? match[2]));
  for (const key of releaseKeyUnion()) assert.ok(written.has(key), `${key} is listed but never written as a key in release.mjs`);
});

test('a usage error from scripts/release.mjs carries only keys the release entries list', () => {
  if (!exists('scripts/release.mjs')) return;
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/release.mjs'), 'no-such-subcommand', '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const result = JSON.parse(run.stdout.trim().split('\n').at(-1));
  const status = byName['release:status'].output.keys;
  for (const key of Object.keys(result)) assert.ok(key in status, `release usage result key ${key} is in the manifest`);
  for (const key of ['schema', 'command', 'ok', 'outcome', 'exit', 'message']) assert.ok(key in result, `release usage result holds ${key}`);
  assert.equal(result.command, null, 'a usage error with no subcommand has command null, which the manifest type allows');
  assert.match(status.command, /null/);
  assert.ok(byName['release:status'].output.optional.includes('version'), 'version is absent from a usage error');
});

const typeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
/** The keys a manifest entry lists for `sub` (or for every subcommand when a key has no annotation), as { key: 'type|type' }. */
function keysFor(entry, sub) {
  const found = {};
  for (const [key, type] of Object.entries(entry.output.keys)) {
    const match = /^(\S+)(?: \(([a-z, -]+)\))?$/.exec(type);
    const where = match[2]?.split(',').map(word => word.trim());
    if (sub === undefined || !where || where.includes(sub)) found[key] = match[1];
  }
  return found;
}
/** The result must hold every listed key that is not optional, and no key that is not listed. */
function assertKeys(label, actual, listed, optional = []) {
  const required = Object.keys(listed).filter(key => !optional.includes(key));
  const missing = required.filter(key => !(key in actual)), extra = Object.keys(actual).filter(key => !(key in listed));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${label}: keys`);
  for (const [key, value] of Object.entries(actual)) assert.ok(listed[key].split('|').includes(typeOf(value)), `${label}: ${key} is ${typeOf(value)}, the manifest says ${listed[key]}`);
}
const testMode = { ...process.env, BOWERLOOM_TOOLS_TEST_MODE: '1' };
const parseJson = run => JSON.parse(run.stdout.trim().split('\n').at(-1));

test('the real JSON output of public-scan has exactly the keys and types the manifest lists', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-')));
  try {
    const git = (...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...testMode, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' } }); assert.equal(r.status, 0, r.stderr); };
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); git('add', '.'); git('commit', '-qm', 'base');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n'); git('add', '.'); git('commit', '-qm', 'next');
    const body = path.join(dir, '..', `body-${path.basename(dir)}.md`);
    fs.writeFileSync(body, '> [!NOTE]\n> ok\n');
    const run = spawnSync(process.execPath, [path.join(root, 'tools/public-scan.mjs'), '--base', 'HEAD~1', '--pr-body', body, '--json'], { cwd: dir, encoding: 'utf8', env: testMode });
    fs.rmSync(body, { force: true });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assertKeys('public-scan', parseJson(run), keysFor(byName['public-scan']), byName['public-scan'].output.optional);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real JSON output of gates has exactly the keys and types the manifest lists', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-')));
  try {
    // A floor no disk meets: the run is refused at once, and the summary still has every key.
    const run = spawnSync(process.execPath, [path.join(root, 'tools/gates.mjs'), '--root', dir, '--min-free-gib', '999999999', '--json'], { encoding: 'utf8', env: testMode });
    assert.equal(run.status, 1, run.stderr + run.stdout);
    assertKeys('gates', parseJson(run), keysFor(byName.gates), byName.gates.output.optional);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real JSON output of each lane-tree subcommand has exactly the keys and types the manifest lists for it', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-')));
  try {
    const laneRun = args => spawnSync(process.execPath, [path.join(root, 'tools/lane-tree.mjs'), ...args, '--json'], { cwd: dir, encoding: 'utf8', env: testMode });
    // Refusals return the same result object as a success, so no clone or disk is needed.
    const create = laneRun(['create', '--name', 'm', '--base', 'main', '--dest', 'relative/path']);
    assert.equal(create.status, 1, create.stderr + create.stdout);
    assertKeys('lane-tree create', parseJson(create), keysFor(byName['lane-tree'], 'create'));
    const remove = laneRun(['remove', '--dest', path.join(dir, 'absent')]);
    assert.equal(remove.status, 1);
    assertKeys('lane-tree remove', parseJson(remove), keysFor(byName['lane-tree'], 'remove'));
    const list = laneRun(['list', '--root', dir]);
    assert.equal(list.status, 0);
    assertKeys('lane-tree list', parseJson(list), keysFor(byName['lane-tree'], 'list'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a usage error from each of the three tools is one JSON object with ok, exit, and error', () => {
  for (const name of ['gates', 'lane-tree', 'public-scan']) {
    const run = spawnSync(process.execPath, [path.join(root, byName[name].path), '--no-such-flag', '--json'], { cwd: root, encoding: 'utf8', env: testMode });
    assert.equal(run.status, 2, name);
    assert.deepEqual(Object.keys(parseJson(run)).sort(), ['error', 'exit', 'ok'], name);
  }
  assert.ok(SUBCOMMANDS.has('create'));
});
