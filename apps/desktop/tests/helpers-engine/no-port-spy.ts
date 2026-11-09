// A runtime spy for "no port": while it is installed, every call that opens a listening socket, an outgoing connection or a datagram socket throws and is recorded.
// The test that installs it checks `hits` is empty at the end, so code that catches the error and goes on is still caught.
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export interface PortSpy { readonly hits: string[]; restore(): void }

/**
 * Wraps net.Server.prototype.listen, http.createServer, https.createServer, dgram.createSocket, net.connect and net.createConnection. The wrappers throw
 * and never reach the real function, so a call opens nothing even in the test that proves the spy fires.
 */
export function installPortSpy(): PortSpy {
  const hits: string[] = [];
  const restores: (() => void)[] = [];
  const wrap = (target: object, key: string, label: string): void => {
    const holder = target as Record<string, unknown>;
    const original = holder[key];
    if (typeof original !== 'function') throw new Error(`the spy cannot find ${label}`);
    holder[key] = function spied(): never { hits.push(label); throw new Error(`NO_PORT: ${label} was called`); };
    restores.push(() => { holder[key] = original; });
  };
  wrap(net.Server.prototype, 'listen', 'net.Server.prototype.listen');
  wrap(http, 'createServer', 'http.createServer');
  wrap(https, 'createServer', 'https.createServer');
  wrap(dgram, 'createSocket', 'dgram.createSocket');
  wrap(net, 'connect', 'net.connect');
  wrap(net, 'createConnection', 'net.createConnection');
  let restored = false;
  return { hits, restore(): void { if (restored) return; restored = true; for (const undo of restores.reverse()) undo(); } };
}
