// The small web server of the persona tool. It listens on 127.0.0.1 only, answers one request kind (POST /cmd), and refuses any request that has no
// token, comes from another address, or names another host. It runs a command only after protocol.mjs agrees, one at a time, and gives up on a
// command after the time limit. Every command and its result goes into the transcript. The runner (the real app window, or a stand-in in tests) is passed in.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { appendText } from './files.mjs';
import { PersonaError, commandLine, transcriptEntry, validateCommand } from './protocol.mjs';

export const TOKEN_HEADER = 'x-persona-token';
export const TIME_LIMIT_MS = 4500;
const MAX_BODY = 8192;
const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);

function sameToken(given, token) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Builds the server. `runner.run(cmd, args)` answers the text of the result or throws. `onStop` is called after the reply to `stop` was sent.
 * `redact` removes folder names of this machine from any text before it is sent or written.
 */
export function createCommandServer({ token, runner, transcript, onStop, timeoutMs = TIME_LIMIT_MS, redact = text => text, now = () => new Date().toISOString(), logError = () => {} }) {
  let chain = Promise.resolve();
  let port = 0;

  const record = (line, ok, text) => { try { appendText(transcript, transcriptEntry(now(), line, ok, text)); } catch (error) { logError(error); } };

  async function execute(cmd, args) {
    if (cmd === 'log') return 'Noted.';
    if (cmd === 'stop') return 'Stopping. The window will close.';
    return runner.run(cmd, args);
  }

  async function handle(body) {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { status: 400, ok: false, text: 'The request was not valid JSON.' }; }
    if (parsed === null || typeof parsed !== 'object') return { status: 400, ok: false, text: 'The request was not valid.' };
    let request;
    try { request = validateCommand(parsed.cmd, parsed.args ?? []); } catch (error) {
      const text = error instanceof PersonaError ? error.message : 'The request was not valid.';
      record(commandLine(String(parsed.cmd).slice(0, 40), Array.isArray(parsed.args) ? parsed.args.map(a => String(a).slice(0, 40)).slice(0, 6) : []), false, text);
      return { status: 400, ok: false, text };
    }
    const line = commandLine(request.cmd, request.args);
    let timer;
    const limit = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); });
    try {
      const outcome = await Promise.race([execute(request.cmd, request.args).then(text => ({ text })), limit]);
      if (outcome.timedOut) {
        const text = 'That took longer than 5 seconds, so it was given up. The app may be busy. Run look to see where things are.';
        record(line, false, text);
        return { status: 200, ok: false, text };
      }
      const text = redact(String(outcome.text));
      record(line, true, text);
      return { status: 200, ok: true, text, stop: request.cmd === 'stop' };
    } catch (error) {
      if (error instanceof PersonaError) { const text = redact(error.message); record(line, false, text); return { status: 200, ok: false, text }; }
      logError(error);
      const text = 'Something went wrong inside the app window. Run look to see where things are.';
      record(line, false, text);
      return { status: 200, ok: false, text };
    } finally { clearTimeout(timer); }
  }

  const server = createServer((req, res) => {
    const reply = (status, payload) => {
      const text = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
      res.end(text);
    };
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply(403, { ok: false, text: 'Not allowed.' });
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(403, { ok: false, text: 'Not allowed.' });
    if (!sameToken(req.headers[TOKEN_HEADER], token)) return reply(401, { ok: false, text: 'A token is needed.' });
    if (req.method !== 'POST' || req.url !== '/cmd') return reply(404, { ok: false, text: 'There is nothing here.' });
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reply(413, { ok: false, text: 'That request is too large.' }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      chain = chain.then(() => handle(Buffer.concat(chunks).toString('utf8'))).then(result => {
        reply(result.status, { ok: result.ok, text: result.text });
        if (result.stop === true) setImmediate(() => onStop());
      }, error => { logError(error); reply(500, { ok: false, text: 'Something went wrong.' }); });
    });
    req.on('error', () => {});
  });

  return {
    server,
    /** Starts listening on a random port of 127.0.0.1 only. Answers the port. */
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(port); });
      });
    },
    close() { return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); }); },
  };
}
