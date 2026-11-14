// Tests for the final `bowerloom` package in tools/final-bowerloom/package: a package that has the old commands and forwards each
// one to `latebrake` in the same process. No test uses the network or installs a package. Each test copies the package into a
// temporary folder next to a stand-in `latebrake`: a small package with the three commands of the real one, whose code only
// echoes its arguments and its standard input. The folder is removed in the `after` hook.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageDir = path.join(repo, 'tools/final-bowerloom/package');
const { shouldNotice, NOTICE } = await import(pathToFileURL(path.join(packageDir, 'lib/notice.js')).href);
const { findLatebrake, entryFor } = await import(pathToFileURL(path.join(packageDir, 'lib/forward.js')).href);

const NOTICE_TEXT = 'Bowerloom is now Latebrake. This command still works. Install the new name: npm install -g latebrake';
const DENY_LINE = `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Bowerloom guard: the guard could not run because the latebrake package is missing or cannot load, so the call is blocked.' } })}\n`;
const CLI_FAIL = 'bowerloom: could not start latebrake. Install it with: npm install -g latebrake\n';
const MCP_FAIL = 'bowerloom-mcp: could not start latebrake-mcp because the latebrake package is missing or cannot load.\n';

// Each old command, and the command of latebrake it runs.
const PAIRS = [['bowerloom', 'latebrake'], ['bowerloom-mcp', 'latebrake-mcp'], ['bowerloom-guard', 'latebrake-guard']];

// The stand-in. `--exit=N` sets the exit code, `--big` adds 1 MiB of output, `--quiet` writes nothing to stdout, `--pid` adds the
// process id, `--delay=N` waits N milliseconds first. It reads all of standard input and writes it back.
const PROBE = `export async function run(name) {
  const args = process.argv.slice(2);
  const option = key => { const found = args.find(a => a.startsWith('--' + key + '=')); return found === undefined ? undefined : found.slice(key.length + 3); };
  const delay = Number(option('delay') ?? 0);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks).toString('utf8');
  if (!args.includes('--quiet')) process.stdout.write(JSON.stringify({ name, args, input, pid: args.includes('--pid') ? process.pid : undefined }) + '\\n');
  if (args.includes('--big')) process.stdout.write('x'.repeat(1024 * 1024) + '\\n');
  process.stderr.write(name + ' probe stderr\\n');
  process.exitCode = Number(option('exit') ?? 0);
}
`;
const BINS = { latebrake: 'latebrake', 'latebrake-mcp': 'latebrake-mcp', 'latebrake-guard': 'latebrake-guard' };

let base;
let counter = 0;
before(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-final-')); });
after(() => { fs.rmSync(base, { recursive: true, force: true }); });

/**
 * Makes a folder that holds `node_modules/bowerloom` (a copy of the package) and, unless `standin` is false, `node_modules/latebrake`.
 * `standin` may be 'entry-missing', 'entry-throws', 'bad-record', 'wrong-version', 'path-escape' or 'link-escape' to make one broken stand-in.
 */
function install(standin = true) {
  const root = path.join(base, String(counter++));
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  fs.cpSync(packageDir, path.join(modules, 'bowerloom'), { recursive: true });
  if (standin === false) return root;
  const dir = path.join(modules, 'latebrake');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'probe.mjs'), PROBE);
  const bin = { ...BINS };
  for (const name of Object.keys(BINS)) fs.writeFileSync(path.join(dir, 'bin', `${name}.mjs`), `import { run } from '../probe.mjs';\nawait run('${name}');\n`);
  for (const key of Object.keys(bin)) bin[key] = `bin/${key}.mjs`;
  const record = { name: 'latebrake', version: '0.9.0-beta.1', type: 'module', bin };
  if (standin === 'entry-missing') for (const name of Object.keys(BINS)) fs.rmSync(path.join(dir, 'bin', `${name}.mjs`));
  if (standin === 'entry-throws') for (const name of Object.keys(BINS)) fs.writeFileSync(path.join(dir, 'bin', `${name}.mjs`), "throw new Error('broken entry');\n");
  if (standin === 'bad-record') record.name = 'other';
  if (standin === 'wrong-version') record.version = '0.9.0';
  if (standin === 'path-escape' || standin === 'link-escape') {
    fs.writeFileSync(path.join(modules, 'evil.mjs'), "process.stdout.write('EVIL\\n');\n");
    for (const key of Object.keys(bin)) {
      if (standin === 'path-escape') bin[key] = '../evil.mjs';
      else { fs.rmSync(path.join(dir, 'bin', `${key}.mjs`)); fs.symlinkSync('../../evil.mjs', path.join(dir, 'bin', `${key}.mjs`)); }
    }
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(record));
  return root;
}

/** A good latebrake sits at root/node_modules, and the package is copied one level deeper, so the search would pass a node_modules folder to reach it. */
function tooFar() {
  const root = install(true);
  const inner = path.join(root, 'inner');
  fs.mkdirSync(path.join(inner, 'node_modules'), { recursive: true });
  fs.renameSync(path.join(root, 'node_modules/bowerloom'), path.join(inner, 'node_modules/bowerloom'));
  return path.join(root, 'inner');
}

const shim = (root, name) => path.join(root, 'node_modules/bowerloom/bin', `${name}.js`);
const direct = (root, name) => path.join(root, 'node_modules/latebrake/bin', `${name}.mjs`);
const run = (file, args, input = '') => spawnSync(process.execPath, [file, ...args], { input, maxBuffer: 16 * 1024 * 1024 });
const text = buffer => buffer.toString('utf8');

test('the publish hold: the package is private, has no publish setting and no scripts, names the three old commands, and pins latebrake', () => {
  const record = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  assert.equal(record.name, 'bowerloom');
  assert.equal(record.version, '0.9.0-beta.1');
  assert.equal(record.private, true);
  assert.equal(Object.hasOwn(record, 'publishConfig'), false);
  assert.equal(Object.hasOwn(record, 'scripts'), false);
  assert.deepEqual(Object.keys(record.bin).sort(), ['bowerloom', 'bowerloom-guard', 'bowerloom-mcp']);
  assert.equal(record.engines.node, '>=24.11.0 <25');
  assert.equal(record.license, 'MIT');
  assert.deepEqual(record.dependencies, { latebrake: '0.9.0-beta.1' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).workspaces.some(w => w.includes('final-bowerloom')), false);
  assert.match(fs.readFileSync(path.join(repo, 'tools/final-bowerloom/deprecate-message.txt'), 'utf8'), /^bowerloom is now latebrake\. Install it with: npm install -g latebrake\. The old commands keep working until 1\.0\.\n$/);
});

test('the notice rule: one pure function, one fixed line', () => {
  assert.equal(NOTICE, NOTICE_TEXT);
  const open = { stdoutIsTTY: true, stderrOpen: true };
  const rows = [
    [{ args: ['harness', 'status'], ...open }, true],
    [{ args: [], ...open }, true],
    [{ args: ['--version'], ...open }, true],
    [{ args: ['harness', 'status', '--json'], ...open }, false],
    [{ args: ['--json'], ...open }, false],
    [{ args: ['status', '--json=true'], ...open }, false],
    [{ args: ['harness'], stdoutIsTTY: false, stderrOpen: true }, false],
    [{ args: ['harness'], stdoutIsTTY: undefined, stderrOpen: true }, false],
    [{ args: ['harness'], stdoutIsTTY: true, stderrOpen: false }, false],
    [{ args: ['context', 'guard'], ...open }, false],
    [{ args: ['context', 'guard', '--hook'], ...open }, false],
    [{ args: ['context', 'show'], ...open }, true],
    [{ args: ['context'], ...open }, true],
    [{ args: ['harness', 'context', 'guard'], ...open }, true],
    [{ args: 'not an array', ...open }, false],
  ];
  for (const [input, expected] of rows) assert.equal(shouldNotice(input), expected, JSON.stringify(input));
});

test('the notice shows end to end on stderr only at a terminal, and never for the other commands', () => {
  const root = install();
  // A runner makes stdout look like a terminal, then loads the shim as the command would.
  const runner = path.join(root, 'tty-runner.mjs');
  fs.writeFileSync(runner, "process.stdout.isTTY = true;\nconst [, , shimUrl] = process.argv;\nprocess.argv.splice(2, 1);\nawait import(shimUrl);\n");
  const viaTerminal = (name, args) => {
    const result = spawnSync(process.execPath, [runner, pathToFileURL(shim(root, name)).href, ...args], { input: '' });
    return { out: text(result.stdout), err: text(result.stderr), code: result.status };
  };
  const cli = viaTerminal('bowerloom', ['harness', 'status']);
  assert.equal(cli.err, `${NOTICE_TEXT}\nlatebrake probe stderr\n`);
  assert.equal(JSON.parse(cli.out).name, 'latebrake');
  assert.equal(cli.code, 0);
  for (const args of [['harness', '--json'], ['context', 'guard']]) assert.equal(viaTerminal('bowerloom', args).err, 'latebrake probe stderr\n', args.join(' '));
  assert.equal(viaTerminal('bowerloom-mcp', []).err, 'latebrake-mcp probe stderr\n');
  assert.equal(viaTerminal('bowerloom-guard', []).err, 'latebrake-guard probe stderr\n');
  // With stdout to a pipe, which is how the tests normally run, the CLI prints no notice either.
  assert.equal(text(run(shim(root, 'bowerloom'), ['harness']).stderr), 'latebrake probe stderr\n');
});

test('forwarding: stdout, standard input, stderr and the exit code match a direct run, and the shim runs in its own process', () => {
  const root = install();
  const cases = [
    ...PAIRS.flatMap(([old, current]) => [0, 1, 3, 130].map(code => [old, current, [`--exit=${code}`, 'alpha', '--flag', 'with space']])),
    ['bowerloom', 'latebrake', ['context', 'guard', '--exit=1']],
  ];
  for (const [old, current, args] of cases) {
    const input = `line one\nsnowman ☃ and a 4-byte glyph \u{1F600}\n`;
    const through = run(shim(root, old), args, input);
    const alone = run(direct(root, current), args, input);
    const label = `${old} ${args.join(' ')}`;
    assert.equal(through.status, alone.status, `${label}: exit code`);
    assert.deepEqual(through.stdout, alone.stdout, `${label}: stdout`);
    assert.deepEqual(through.stderr, alone.stderr, `${label}: stderr`);
    assert.equal(JSON.parse(text(through.stdout)).input, input, `${label}: standard input`);
  }
  for (const [old] of PAIRS) {
    const through = spawnSync(process.execPath, [shim(root, old), '--pid'], { input: '', encoding: 'utf8' });
    assert.equal(JSON.parse(through.stdout).pid, through.pid, `${old} runs in the process that the shim started`);
  }
});

test('forwarding: 1 MiB on stdout drains through each shim', () => {
  const root = install();
  for (const [old, current] of PAIRS) {
    const through = run(shim(root, old), ['--big', '--exit=3']);
    const alone = run(direct(root, current), ['--big', '--exit=3']);
    assert.equal(through.status, 3, old);
    assert.ok(through.stdout.length > 1024 * 1024, `${old} wrote ${through.stdout.length} bytes`);
    assert.deepEqual(through.stdout, alone.stdout, old);
  }
});

test('clean stdout: with a probe that writes nothing, each shim leaves stdout empty', () => {
  const root = install();
  for (const [old] of PAIRS) {
    for (const args of [['--quiet'], ['--quiet', '--exit=1']]) {
      const through = run(shim(root, old), args);
      assert.equal(through.stdout.length, 0, `${old} ${args.join(' ')}`);
    }
  }
  assert.equal(run(shim(root, 'bowerloom'), ['context', 'guard', '--quiet']).stdout.length, 0);
});

test('fail closed: with no usable latebrake, each shim ends as the hook and the protocol need, byte for byte', () => {
  // The last case puts a good latebrake above the first node_modules folder, where the search must not look.
  for (const standin of [false, 'entry-missing', 'entry-throws', 'bad-record', 'wrong-version', 'too-far']) {
    const root = standin === 'too-far' ? tooFar() : install(standin);
    const label = String(standin);
    const cli = run(shim(root, 'bowerloom'), ['harness', 'status']);
    assert.equal(text(cli.stdout), '', `${label}: bowerloom stdout`);
    assert.equal(text(cli.stderr), CLI_FAIL, `${label}: bowerloom stderr`);
    assert.equal(cli.status, 1, `${label}: bowerloom exit`);
    const hook = run(shim(root, 'bowerloom'), ['context', 'guard']);
    assert.equal(text(hook.stdout), '', `${label}: context guard stdout`);
    assert.equal(hook.status, 2, `${label}: context guard exit`);
    assert.ok(!text(hook.stderr).includes(NOTICE_TEXT), `${label}: context guard prints no notice`);
    const mcp = run(shim(root, 'bowerloom-mcp'), []);
    assert.equal(text(mcp.stdout), '', `${label}: mcp stdout`);
    assert.equal(text(mcp.stderr), MCP_FAIL, `${label}: mcp stderr`);
    assert.equal(mcp.status, 1, `${label}: mcp exit`);
    const guard = run(shim(root, 'bowerloom-guard'), []);
    assert.equal(text(guard.stdout), DENY_LINE, `${label}: guard stdout`);
    assert.equal(text(guard.stderr), '', `${label}: guard stderr`);
    assert.equal(guard.status, 0, `${label}: guard exit`);
  }
});

test('the search for latebrake: a copy nested under the package wins over the sibling, and a version other than the pinned one is refused', () => {
  const root = install();
  const nested = path.join(root, 'node_modules/bowerloom/node_modules');
  fs.mkdirSync(nested);
  fs.cpSync(path.join(root, 'node_modules/latebrake'), path.join(nested, 'latebrake'), { recursive: true });
  const start = path.join(root, 'node_modules/bowerloom/lib');
  assert.equal(findLatebrake(start), fs.realpathSync(path.join(nested, 'latebrake')));
  fs.rmSync(path.join(nested, 'latebrake'), { recursive: true });
  assert.equal(findLatebrake(start), fs.realpathSync(path.join(root, 'node_modules/latebrake')));
  assert.throws(() => entryFor(findLatebrake(path.join(install('wrong-version'), 'node_modules/bowerloom/lib')), 'latebrake'), /runs only 0\.9\.0-beta\.1/);
  assert.throws(() => findLatebrake(path.join(tooFar(), 'node_modules/bowerloom/lib')), /not installed/);
  assert.ok(!DENY_LINE.includes('npm install') && !MCP_FAIL.includes('npm install'), 'text that reaches the model or a protocol client gives no command to run');
});

test('closed stderr: the notice is not required, and the forward still works', () => {
  const root = install();
  const runner = path.join(root, 'tty-runner.mjs');
  fs.writeFileSync(runner, "process.stdout.isTTY = true;\nconst [, , shimUrl] = process.argv;\nprocess.argv.splice(2, 1);\nawait import(shimUrl);\n");
  // The shell closes file descriptor 2 before it starts node.
  const closed = args => spawnSync('/bin/sh', ['-c', 'exec "$0" "$@" 2>&-', process.execPath, runner, pathToFileURL(shim(root, 'bowerloom')).href, ...args], { input: 'ping\n' });
  const result = closed(['harness', 'status', '--exit=3']);
  assert.equal(result.status, 3);
  const body = JSON.parse(text(result.stdout));
  assert.equal(body.name, 'latebrake');
  assert.deepEqual(body.args, ['harness', 'status', '--exit=3']);
  assert.equal(body.input, 'ping\n');
  assert.ok(!text(result.stdout).includes(NOTICE_TEXT), 'no notice on stdout');
  // With no latebrake, the failure still ends with exit 1 and nothing on stdout.
  const bare = install(false);
  const failed = spawnSync('/bin/sh', ['-c', 'exec "$0" "$@" 2>&-', process.execPath, shim(bare, 'bowerloom'), 'harness']);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout.length, 0);
});

test('fail closed: the deny line has the shape of the guard entry in the CLI', () => {
  const parsed = JSON.parse(DENY_LINE);
  assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(parsed.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  const source = fs.readFileSync(path.join(repo, 'apps/cli/src/guard-main.ts'), 'utf8');
  assert.ok(source.includes("hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }"));
});

test('path escape: a latebrake whose bin leaves its folder is refused, by path and by link, with the same fail-closed results', () => {
  for (const standin of ['path-escape', 'link-escape']) {
    const root = install(standin);
    const label = standin;
    assert.throws(() => entryFor(findLatebrake(path.join(root, 'node_modules/bowerloom/lib')), 'latebrake'), /outside the latebrake folder/, label);
    for (const [old] of PAIRS) {
      const through = run(shim(root, old), []);
      assert.ok(!text(through.stdout).includes('EVIL'), `${label}: ${old} ran the outside file`);
    }
    assert.equal(run(shim(root, 'bowerloom'), []).status, 1, `${label}: bowerloom`);
    assert.equal(run(shim(root, 'bowerloom'), ['context', 'guard']).status, 2, `${label}: context guard`);
    assert.equal(run(shim(root, 'bowerloom-mcp'), []).status, 1, `${label}: mcp`);
    const guard = run(shim(root, 'bowerloom-guard'), []);
    assert.equal(text(guard.stdout), DENY_LINE, `${label}: guard stdout`);
    assert.equal(guard.status, 0, `${label}: guard exit`);
  }
});

test('broken pipe: when the reader closes stdout early, bowerloom-guard exits 2', async () => {
  const root = install();
  const closeEarly = file => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, '--delay=300', '--big'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.destroy();
    child.stdin.end();
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
  assert.equal(await closeEarly(shim(root, 'bowerloom-guard')), 2);
});

test('files: LICENSE equals the root LICENSE, and npm pack --dry-run lists exactly the files that ship', () => {
  assert.deepEqual(fs.readFileSync(path.join(packageDir, 'LICENSE')), fs.readFileSync(path.join(repo, 'LICENSE')));
  const cache = fs.mkdtempSync(path.join(base, 'npm-cache-'));
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--offline', '--ignore-scripts', '--cache', cache], { cwd: packageDir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const listed = JSON.parse(result.stdout)[0].files.map(file => file.path).sort();
  assert.deepEqual(listed, ['LICENSE', 'README.md', 'bin/bowerloom-guard.js', 'bin/bowerloom-mcp.js', 'bin/bowerloom.js', 'lib/forward.js', 'lib/notice.js', 'package.json']);
  assert.equal(fs.existsSync(path.join(repo, 'tools/final-bowerloom/deprecate-message.txt')), true);
  assert.equal(listed.includes('deprecate-message.txt'), false);
});
