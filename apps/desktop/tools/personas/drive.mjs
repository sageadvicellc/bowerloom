#!/usr/bin/env node
// The persona driver. `serve` opens the preview app and listens on this computer only. Every other word is a command sent to that server.
//   node tools/personas/drive.mjs serve [--id <id>] [--out <folder>] [--size 1280x800]
//   node tools/personas/drive.mjs [--id <id>] look | click <n> | type <n> <text> | press <key> | hover <n> | drag <a> <b> | scroll <up|down> | resize <w> <h>
//                                              | theme <light|dark> | motion <reduce|normal> | goto <welcome|map|tour> | log <text> | stop
// It writes only into the temporary folder: a state file, the out folder (screenshots and the transcript), and the app's temporary data folder.
// It never writes inside the repository (files.mjs refuses), and it removes only the data folder it made itself.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { makePrototypeDataDir, removePrototypeDataDir } from '../../main/prototype-dir.mjs';
import { DESKTOP, REPO_ROOT, appendText, assertWritable, ensureDir, removeOwnFile, writeText } from './files.mjs';
import { PersonaError, USAGE, checkId, parseCli, redact, stateFileFor, stateRoot, validateCommand } from './protocol.mjs';
import { staleReason } from './buildcheck.mjs';
import { readState, sendCommand } from './client.mjs';
import { createCommandServer } from './server.mjs';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** Starts the preview and the server. Stays alive until `stop`, a stop signal, or the closing of the window. */
async function serve(flags, env) {
  const id = checkId(flags.id ?? 'main');
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(flags.size ?? '1280x800');
  if (match === null) throw new PersonaError('--size must look like 1280x800.');
  const size = { width: Number(match[1]), height: Number(match[2]) };
  const root = stateRoot(env);
  const statePath = stateFileFor(root, id);
  if (existsSync(statePath)) {
    try { const old = readState({ id, env }); if (alive(old.pid)) throw new PersonaError(`A session with the id "${id}" is already running (process ${old.pid}). Use another --id, or stop it first.`); } catch (error) { if (error instanceof PersonaError && /already running/.test(error.message)) throw error; }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = flags.out === undefined ? join(root, `out-${id}-${stamp}`) : resolve(flags.out);
  // Both folders are checked first, so a bad --out stops here, before any window opens.
  assertWritable(root);
  assertWritable(outDir);
  const stale = staleReason(DESKTOP);
  if (stale !== null) throw new PersonaError(stale);
  ensureDir(root);
  ensureDir(outDir);
  const transcript = join(outDir, 'transcript.txt');
  const userDataDir = makePrototypeDataDir();
  const hide = [REPO_ROOT, DESKTOP, userDataDir];
  const note = text => appendText(transcript, `[${new Date().toISOString()}] ${text}\n`);
  note(`Session "${id}" starts. Window ${size.width} by ${size.height}.`);

  let preview;
  try {
    const { openPreview } = await import('./app.mjs');
    preview = await openPreview({ desktop: DESKTOP, userDataDir, outDir, size, hide });
  } catch (error) {
    removePrototypeDataDir(userDataDir);
    throw error instanceof PersonaError ? error : new PersonaError(`The app window could not start. ${String(error.message).split('\n')[0]}`);
  }

  const token = randomBytes(24).toString('hex');
  let ending = false;
  const shutdown = async reason => {
    if (ending) return;
    ending = true;
    try { note(`Session "${id}" ends: ${reason}.`); } catch { /* the out folder is gone */ }
    await Promise.race([commands.close(), new Promise(r => setTimeout(r, 1000))]);
    await preview.close();
    const reasonCode = removePrototypeDataDir(userDataDir);
    removeOwnFile(statePath);
    console.log(`Session ended (${reason}). Data folder ${reasonCode === 'removed' ? 'removed' : `not removed (${reasonCode})`}. Out folder kept: ${outDir}`);
    process.exit(0);
  };
  const commands = createCommandServer({ token, runner: preview, transcript, onStop: () => shutdown('stop'), redact: text => redact(text, hide), logError: error => console.error(String(error?.stack ?? error)) });
  const port = await commands.listen();
  writeText(statePath, JSON.stringify({ id, port, token, pid: process.pid, out: outDir }));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { void shutdown(signal); });
  void preview.closed.then(() => shutdown('window closed'));

  console.log('READY');
  console.log(`state file: ${statePath}`);
  console.log(`out folder: ${outDir}`);
  console.log(`transcript: ${transcript}`);
  console.log(`data folder: ${userDataDir} (made by this run, and removed when it ends)`);
  console.log(`window: ${size.width} by ${size.height}, listening on 127.0.0.1 port ${port}`);
}

async function client(command, args, flags, env) {
  // A word that is not on the list is refused here first, before a session is even looked for.
  validateCommand(command, args);
  const state = readState({ id: flags.id ?? 'main', statePath: flags.state, env });
  const answer = await sendCommand(state, command, args);
  (answer.ok ? process.stdout : process.stderr).write(`${answer.text}\n`);
  if (command === 'stop' && answer.ok) {
    for (let i = 0; i < 40 && alive(state.pid); i += 1) await new Promise(r => setTimeout(r, 100));
  }
  return answer.ok ? 0 : 1;
}

async function main() {
  try {
    const { command, args, flags } = parseCli(process.argv.slice(2), process.env);
    if (command === undefined || command === 'help' || command === '--help') { console.log(USAGE); return process.exit(command === undefined ? 2 : 0); }
    if (command === 'serve') { await serve(flags, process.env); return undefined; }
    return process.exit(await client(command, args, flags, process.env));
  } catch (error) {
    process.stderr.write(`${error instanceof PersonaError ? error.message : `Something failed: ${String(error?.message ?? error).split('\n')[0]}`}\n`);
    return process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
