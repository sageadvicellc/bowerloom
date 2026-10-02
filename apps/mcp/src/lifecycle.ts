import type { EventEmitter } from 'node:events';

interface OwnedServer {
  close(): Promise<void>;
  onclose?: () => void;
}

/** All shutdown paths share one cleanup promise and report no private error data. */
export function ownMcpLifecycle(server: OwnedServer, controller: { close(): Promise<void> },
  input: EventEmitter, signals: EventEmitter, onFailure: () => void): { close(): Promise<void> } {
  let closing: Promise<void> | undefined;
  const stop = () => { void close(); };
  const close = (): Promise<void> => {
    if (closing) return closing;
    input.removeListener('end', stop);
    input.removeListener('error', stop);
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
    closing = Promise.resolve().then(async () => {
      try { await server.close(); }
      finally { await controller.close(); }
    }).catch(() => { onFailure(); });
    return closing;
  };
  input.once('end', stop);
  input.once('error', stop);
  signals.once('SIGINT', stop);
  signals.once('SIGTERM', stop);
  server.onclose = stop;
  return { close };
}
