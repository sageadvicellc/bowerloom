// The Node core in the Electron utility process (Electron `utilityProcess`). The channel is the utility process message port.
import { createCore } from './core.js';

interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (parentPort === undefined) throw new Error('This file runs only as an Electron utility process.');
const port: ParentPort = parentPort;

const core = createCore(message => port.postMessage(message));
port.on('message', ({ data }) => core.handle(data));
core.ready();
