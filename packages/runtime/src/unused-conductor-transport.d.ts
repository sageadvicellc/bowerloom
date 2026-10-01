// DBOS 5.2.11 exposes an otherwise unused Conductor declaration containing a ws field.
// Its published package omits @types/ws. Keep that transport opaque; this runtime neither
// constructs nor consumes it. Replace with the upstream declaration if Conductor is ever admitted.
declare module 'ws' {
  export default class WebSocket { private readonly unusedConductorTransport: never; }
}
