// A preload for tests/token-debug.test.ts. Not a test file, and not part of the product.
//
// It runs the real public transport of spec 07 once, with a canary token, inside a child whose NODE_DEBUG the test
// sets. Only two things are stubbed: dns.promises.lookup answers one public address, and tls.connect returns an
// in-memory socket that plays the server. Everything between them is Node's own https and http code, so its debug
// output is the real one. The socket records whether the request carried `Authorization: Bearer <token>`. The result
// file holds booleans and counts only, never the token. The process then exits before the CLI module would load.
import fs from 'node:fs';
import tls from 'node:tls';
import dnsPromises from 'node:dns/promises';
import { Duplex } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { createPublicTransport } from '../../packages/skill-manifest/src/public-get.js';
import { GithubToken } from '../../packages/skill-manifest/src/github-token.js';

interface Plan { out: string; token: string; url: string; repository: string }
const planPath = process.env.TEST_DEBUG_TRANSPORT_PLAN;
if (!planPath) throw new Error('debug-transport: TEST_DEBUG_TRANSPORT_PLAN is not set');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Plan;
const seen = { connects: 0, requests: 0, authorized: false, otherAuthorization: false };

(dnsPromises as { lookup: unknown }).lookup = async () => [{ address: '104.16.25.34', family: 4 }];
(tls as { connect: unknown }).connect = () => {
  seen.connects++;
  let request = '';
  const body = Buffer.from('{"ok":true}');
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) {
      request += chunk.toString('latin1');
      if (request.includes('\r\n\r\n')) {
        seen.requests++;
        const lines = request.split('\r\n').filter(l => /^authorization:/i.test(l));
        seen.authorized = lines.length === 1 && lines[0]!.slice(lines[0]!.indexOf(':') + 1).trim() === `Bearer ${plan.token}`;
        seen.otherAuthorization = lines.length > 1;
        this.push(Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`));
        this.push(body); this.push(null);
      }
      done();
    },
  });
  Object.assign(socket, { setNoDelay() {}, setKeepAlive() {}, setTimeout() { return socket; }, ref() {}, unref() {}, authorized: true, encrypted: true });
  queueMicrotask(() => { socket.emit('connect'); socket.emit('secureConnect'); });
  return socket;
};
syncBuiltinESMExports();

const token = GithubToken.fromEnv({ BOWERLOOM_GITHUB_TOKEN: plan.token });
const transport = createPublicTransport({ githubAuth: { token: token!, repositories: [plan.repository] } });
let ok = false, failure: string | null = null;
try { ok = (await transport.get(plan.url, 1024, new AbortController().signal)).toString() === '{"ok":true}'; }
catch (error) { failure = String((error as { code?: unknown }).code ?? 'unknown'); }
finally { transport.close(); }
fs.writeFileSync(plan.out, JSON.stringify({ ok, failure, ...seen }));
process.exit(0);
