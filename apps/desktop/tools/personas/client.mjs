// The client side: finds the server of an id from its state file and sends it one command. Reads files; writes none.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { PersonaError, checkId, stateFileFor, stateRoot, validateCommand } from './protocol.mjs';
import { TOKEN_HEADER } from './server.mjs';

export const CLIENT_LIMIT_MS = 5000;

/** Reads the state file of an id. Throws a plain error when there is none, or when it is damaged. */
export function readState({ id, statePath, env = process.env }) {
  const file = statePath ?? stateFileFor(stateRoot(env), checkId(id ?? 'main'));
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch {
    throw new PersonaError(`No session is running for the id "${id ?? 'main'}". Start one with: node tools/personas/drive.mjs serve${id && id !== 'main' ? ` --id ${id}` : ''}`);
  }
  if (!Number.isInteger(state.port) || typeof state.token !== 'string' || !Number.isInteger(state.pid)) throw new PersonaError('The state file is damaged. Stop the session and start it again.');
  return { ...state, file };
}

/** Sends one command. Answers { ok, text }. Gives up after the limit. */
export function sendCommand(state, cmd, args, limit = CLIENT_LIMIT_MS) {
  return new Promise((resolve, reject) => {
    validateCommand(cmd, args);
    const body = JSON.stringify({ cmd, args });
    const req = request({ host: '127.0.0.1', port: state.port, path: '/cmd', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), [TOKEN_HEADER]: state.token }, timeout: limit }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new PersonaError('The server gave an answer I could not read.')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new PersonaError('The server did not answer within 5 seconds. It may be busy or gone.')); });
    req.on('error', () => reject(new PersonaError('The server is not answering. It may have been stopped. Start it again with serve.')));
    req.end(body);
  });
}
