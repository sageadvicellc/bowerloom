// The real thing, end to end, with no Playwright in the test itself: start `serve` as a process, drive it with the client command, and stop it.
// It opens the preview app in a window for a few seconds. It is skipped (with the reason) when the app is not built or the app window is not installed,
// because a skip is honest and a rebuild here would race with the tests that read dist/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { DESKTOP, tempDir } from './support.js';

const TOOL = join(DESKTOP, 'tools', 'personas');
interface Build { staleReason(desktop: string): string | null }
interface Run { electronBinary(desktop: string): string | null }

async function reasonToSkip(): Promise<string | null> {
  const { staleReason } = await import(join(TOOL, 'buildcheck.mjs')) as Build;
  const stale = staleReason(DESKTOP);
  if (stale !== null) return stale;
  const { electronBinary } = await import(join(DESKTOP, 'tools', 'run.mjs')) as Run;
  return electronBinary(DESKTOP) === null ? 'the app window is not installed' : null;
}

function waitFor(child: ChildProcess, pattern: RegExp, ms: number): Promise<string> {
  return new Promise((resolveText, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error(`serve did not print ${pattern} in time. It printed:\n${text}`)), ms);
    child.stdout?.on('data', (c: Buffer) => { text += c.toString(); if (pattern.test(text)) { clearTimeout(timer); resolveText(text); } });
    child.stderr?.on('data', (c: Buffer) => { text += c.toString(); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`serve ended early (${code}). It printed:\n${text}`)); });
  });
}

function post(port: number, token: string | null, body: string): Promise<number> {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path: '/cmd', method: 'POST', headers: token === null ? {} : { 'x-persona-token': token } }, r => { r.resume(); r.on('end', () => res(r.statusCode ?? 0)); });
    req.on('error', rej);
    req.end(body);
  });
}

const gitStatus = (path: string): string => spawnSync('git', ['-C', DESKTOP, 'status', '--porcelain', '--', path], { encoding: 'utf8' }).stdout;

test('serve, look, goto map, click the first agent, look again, stop: the snapshot changes and everything is cleaned up', { timeout: 110000 }, async t => {
  const skip = await reasonToSkip();
  if (skip !== null) { t.skip(skip); return; }
  const state = tempDir(t, 'bowerloom-personas-smoke-');
  const out = join(state, 'out');
  const env = { ...process.env, BOWERLOOM_PERSONAS_DIR: state };
  const shotsBefore = gitStatus('screenshots');
  const drive = (...args: string[]): { status: number | null; stdout: string; stderr: string; ms: number } => {
    const began = Date.now();
    const r = spawnSync(process.execPath, [join(TOOL, 'drive.mjs'), '--id', 'smoke', ...args], { encoding: 'utf8', env, timeout: 8000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - began };
  };

  const server = spawn(process.execPath, [join(TOOL, 'drive.mjs'), 'serve', '--id', 'smoke', '--out', out], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (server.exitCode === null) server.kill('SIGKILL'); });
  const printed = await waitFor(server, /window: .*port \d+/, 60000);

  // What serve says.
  const stateFile = /state file: (.+)/.exec(printed)![1]!;
  const dataDir = /data folder: (\S+) /.exec(printed)![1]!;
  assert.equal(stateFile, join(state, 'state-smoke.json'));
  assert.match(printed, /window: 1280 by 800, listening on 127\.0\.0\.1 port \d+/);
  const info = JSON.parse(readFileSync(stateFile, 'utf8')) as { port: number; token: string; pid: number; out: string };
  assert.ok(info.port > 0 && info.token.length >= 32 && info.pid === server.pid);
  assert.equal(info.out, out);
  assert.ok(existsSync(dataDir) && dataDir.includes('bowerloom-prototype-'));

  // The server is a loopback server that wants its token.
  assert.equal(await post(info.port, null, JSON.stringify({ cmd: 'look', args: [] })), 401);
  assert.equal(await post(info.port, 'not-the-token', JSON.stringify({ cmd: 'look', args: [] })), 401);
  const outside = Object.values(networkInterfaces()).flat().find(a => a !== undefined && a.family === 'IPv4' && !a.internal);
  if (outside !== undefined) {
    const refused = await new Promise<string>(res => { const s = createConnection({ host: outside.address, port: info.port }); s.on('connect', () => { s.destroy(); res('connected'); }); s.on('error', e => res((e as NodeJS.ErrnoException).code ?? 'error')); });
    assert.equal(refused, 'ECONNREFUSED', 'the server is not reachable on the network address of this computer');
  }

  // First look: the first minute.
  const first = drive('look');
  assert.equal(first.status, 0, first.stderr);
  assert.ok(first.ms < 5000, `look took ${first.ms} ms`);
  assert.match(first.stdout, /^WINDOW: 1280 by 800, (?:light|dark) colours, (?:normal|reduced) motion$/m);
  const oldFind = /\[(\d+)\] button "Find my agents"/.exec(first.stdout);
  assert.ok(oldFind !== null, `the first screen has a way to find agents:\n${first.stdout}`);

  // A look holds text, roles, states and the screenshot, and nothing a person cannot see.
  const shot = /^SCREENSHOT: (.+)$/m.exec(first.stdout)![1]!;
  assert.ok(shot.startsWith(out + '/'), 'the screenshot is in the out folder');
  assert.ok(existsSync(shot) && statSync(shot).size > 2000);
  assert.deepEqual([...readFileSync(shot).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a PNG');
  assert.doesNotMatch(first.stdout, /<\/?[a-z][^>]*>/i, 'no markup');
  assert.doesNotMatch(first.stdout, /\b(?:class|style|data-[a-z-]+)=|function\s*\(|=>|innerHTML|querySelector|sourceMappingURL/i);
  assert.ok(!first.stdout.includes(resolve(DESKTOP, '..', '..')), 'no path of the repository');
  assert.ok(!first.stdout.includes('bowerloom-prototype-'), 'no data folder name');

  // goto map, then the first agent.
  const toMap = drive('goto', 'map');
  assert.equal(toMap.status, 0, toMap.stderr);
  assert.match(toMap.stdout, /Old control numbers no longer work/);
  const stale = drive('click', oldFind![1]!);
  assert.equal(stale.status, 1, 'a number from before the goto is refused');
  assert.match(stale.stderr, /out of date.*Run look to get new numbers\./);
  assert.doesNotMatch(stale.stderr, /\n\s+at |Error:/);

  const map = drive('look');
  assert.equal(map.status, 0, map.stderr);
  const lines = map.stdout.split('\n');
  // The agent cards follow the details toggle, the last button of the top row: the first button after it is the first agent.
  const findMore = lines.findIndex(l => /^\s*\[\d+\] button "Hide details"/.test(l));
  assert.ok(findMore > 0, `the map shows agent cards:\n${map.stdout}`);
  const firstAgentLine = lines.slice(findMore + 1).find(l => /^\s*\[\d+\] button "/.test(l));
  assert.ok(firstAgentLine !== undefined, `an agent card follows "Hide details":\n${map.stdout}`);
  const firstAgent = /^\s*\[(\d+)\] button "([^"]+)"/.exec(firstAgentLine!);
  assert.ok(firstAgent !== null, firstAgentLine);
  const before = map.stdout.replace(/^SCREENSHOT: .*$/m, '');
  assert.match(before, /heading 1: Agents/);

  const click = drive('click', firstAgent![1]!);
  assert.equal(click.status, 0, click.stderr);
  assert.match(click.stdout, new RegExp(`Pressed \\[${firstAgent![1]}\\] button "${firstAgent![2]}"`));
  const after = drive('look');
  assert.equal(after.status, 0, after.stderr);
  const afterText = after.stdout.replace(/^SCREENSHOT: .*$/m, '');
  assert.notEqual(afterText, before, 'the look changed after the click');
  assert.notEqual(/^SCREENSHOT: (.+)$/m.exec(after.stdout)![1], /^SCREENSHOT: (.+)$/m.exec(map.stdout)![1], 'each look has its own screenshot');

  // A made-up command, a number that does not exist, and a note.
  const bad = drive('evaluate', 'document.body.innerHTML');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /I do not know "evaluate"/);
  // A hand-made request with the right token meets the same list at the server.
  assert.equal(await post(info.port, info.token, JSON.stringify({ cmd: 'evaluate', args: ['document.body.innerHTML'] })), 400);
  const nothing = drive('click', '9999');
  assert.equal(nothing.status, 1);
  assert.match(nothing.stderr, /There is no control \[9999\]/);
  assert.equal(drive('log', 'the smoke test was here').status, 0);

  // The transcript has every command and result.
  const transcript = readFileSync(join(out, 'transcript.txt'), 'utf8');
  for (const needle of ['> look', '> goto map', `> click ${oldFind![1]}`, `> click ${firstAgent![1]}`, '> evaluate document.body.innerHTML', '> log the smoke test was here', 'heading 1: Agents']) assert.ok(transcript.includes(needle), needle);
  assert.ok(transcript.indexOf('> goto map') < transcript.indexOf(`> click ${firstAgent![1]}`));
  assert.doesNotMatch(transcript, /<\/?[a-z][^>]*>/i);

  // Stop. The process ends, the state file and the data folder are gone, the out folder stays, and no tracked picture changed.
  const ended = new Promise<number | null>(res => server.on('exit', code => res(code)));
  const stop = drive('stop');
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(await ended, 0);
  assert.equal(existsSync(stateFile), false, 'the state file is removed');
  assert.equal(existsSync(dataDir), false, 'the data folder that serve made is removed');
  assert.ok(existsSync(join(out, 'transcript.txt')) && existsSync(shot), 'the out folder is kept');
  assert.equal(relative(resolve(DESKTOP, '..', '..'), dirname(shot)).startsWith('..'), true, 'nothing was written in the repository');
  assert.equal(gitStatus('screenshots'), shotsBefore, 'no tracked screenshot changed');
  assert.match(drive('look').stderr, /No session is running for the id "smoke"/);
});
