import WebSocket from 'ws';
// Compile-only; this function is never executed or imported by the runtime tests.
export function typedSocket(address: string): WebSocket {
  const socket = new WebSocket(address);
  socket.send('typed');
  return socket;
}
