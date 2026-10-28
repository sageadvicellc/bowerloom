// Preloaded into the rulesync oracle process. Any network call fails loudly, and the test reads the marker on stderr.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';

const refuse = what => () => {
  process.stderr.write(`BOWERLOOM-ORACLE-NETWORK ${what}\n`);
  throw new Error(`The rulesync oracle test refuses network access (${what}).`);
};
net.Socket.prototype.connect = refuse('socket');
net.connect = refuse('net.connect');
net.createConnection = refuse('net.createConnection');
tls.connect = refuse('tls.connect');
dns.lookup = refuse('dns.lookup');
dns.resolve = refuse('dns.resolve');
dns.promises.lookup = refuse('dns.promises.lookup');
http.request = refuse('http.request');
http.get = refuse('http.get');
https.request = refuse('https.request');
https.get = refuse('https.get');
globalThis.fetch = async () => refuse('fetch')();
syncBuiltinESMExports();
