// The host: what the Electron main process does with the Node core in its child process. It starts the child, sends calls, waits for answers, and keeps four rules:
//  - a call that is in the child when the child dies fails with FAILED, and is never sent again;
//  - a call made while the child is down waits for the next child and is sent once;
//  - every call returns or fails within `callTimeoutMs` (proposal: 30 seconds); a call that times out fails with FAILED and its child is replaced;
//  - events from the child reach `onEvent` in the order the child sent them, once each.
// State that lives in the child (the plan shown last) is gone when the child is replaced, because the new child starts empty.
// It takes `fork` (Electron's `utilityProcess.fork`) and `signal` (`process.kill`) as parts, so a plain Node test can run it with a fake child.

/** The error a failed call gets. `code` is the short refusal code of the call set. */
function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createCoreHost({ fork, signal = (pid, name) => process.kill(pid, name), childPath, env, callTimeoutMs = 30000, onEvent = () => {}, onLog = () => {} }) {
  let proc = null;
  let ready = false;
  let stopped = false;
  let nextId = 1;
  let generation = 0;
  let began = 0;
  let waitingForReady = [];
  const inFlight = new Map();
  /** Calls that were made while no child was ready. They have not been sent. */
  const queued = [];
  const host = { generation: 0, lastRecoveryMs: 0, restarts: 0, sentCalls: 0 };

  const settle = (id, run) => {
    const entry = inFlight.get(id) ?? queued.find(q => q.id === id);
    if (entry === undefined) return;
    inFlight.delete(id);
    const at = queued.indexOf(entry);
    if (at >= 0) queued.splice(at, 1);
    clearTimeout(entry.timer);
    run(entry);
  };

  const failAllInFlight = reason => {
    for (const id of [...inFlight.keys()]) settle(id, entry => entry.reject(refusal('FAILED', reason)));
  };

  const flush = () => {
    for (const entry of queued.splice(0)) send(entry);
  };

  function send(entry) {
    inFlight.set(entry.id, entry);
    entry.sent = true;
    host.sentCalls += 1;
    proc.postMessage({ type: 'call', id: entry.id, method: entry.method, args: entry.args });
  }

  function spawnChild() {
    began = Date.now();
    ready = false;
    const mine = fork(childPath, [], { serviceName: 'bowerloom-core', ...(env === undefined ? {} : { env }) });
    proc = mine;
    mine.on('message', message => {
      if (mine !== proc || message === null || typeof message !== 'object') return;
      if (message.type === 'ready') {
        ready = true;
        generation += 1;
        host.generation = generation;
        host.lastRecoveryMs = Date.now() - began;
        host.childPid = message.pid ?? mine.pid;
        const waiters = waitingForReady;
        waitingForReady = [];
        for (const wake of waiters) wake();
        flush();
      } else if (message.type === 'event') {
        onEvent(message);
      } else if (message.type === 'result') {
        settle(message.id, entry => (message.ok ? entry.resolve(message.value) : entry.reject(refusal(typeof message.code === 'string' ? message.code : 'FAILED', message.message ?? message.code ?? 'FAILED'))));
      }
    });
    mine.on('exit', (code, why) => {
      if (mine !== proc) return;
      ready = false;
      proc = null;
      onLog(`child ended (code ${code}, ${why ?? 'no signal'})`);
      failAllInFlight('The core process ended while the call was running.');
      if (stopped) {
        for (const wake of waitingForReady.splice(0)) wake();
        return;
      }
      host.restarts += 1;
      spawnChild();
    });
  }

  host.start = () => {
    stopped = false;
    spawnChild();
    return host.whenReady();
  };

  host.whenReady = () => (ready ? Promise.resolve() : new Promise(resolve => { waitingForReady.push(resolve); }));

  host.call = (method, ...args) => new Promise((resolve, reject) => {
    if (stopped) { reject(refusal('FAILED', 'The core process is stopped.')); return; }
    const id = nextId;
    nextId += 1;
    const entry = { id, method, args, resolve, reject, sent: false, timer: null };
    entry.timer = setTimeout(() => {
      const wasSent = entry.sent;
      settle(id, e => e.reject(refusal('FAILED', `The call took longer than ${callTimeoutMs} ms.`)));
      // A call that was sent and got no answer leaves the child in an unknown state: replace it.
      if (wasSent && proc !== null) host.killChild();
    }, callTimeoutMs);
    if (ready && proc !== null) send(entry); else queued.push(entry);
  });

  /** Ends the current child at once, with a signal that it cannot catch. The host starts a new one. */
  host.killChild = () => {
    const pid = proc?.pid;
    if (pid === undefined) return false;
    // The host knows this child is going: a call made from now on waits for the next one instead of being sent to a child that is ending.
    ready = false;
    signal(pid, 'SIGKILL');
    return true;
  };

  host.childPid = undefined;

  host.stop = () => new Promise(resolve => {
    stopped = true;
    for (const entry of queued.splice(0)) { clearTimeout(entry.timer); entry.reject(refusal('FAILED', 'The core process is stopped.')); }
    if (proc === null) { resolve(); return; }
    const mine = proc;
    mine.once('exit', () => resolve());
    mine.kill();
  });

  return host;
}
