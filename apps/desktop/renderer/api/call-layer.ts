/**
 * The seam between the page and a shell. The page makes 42 calls (3 reader calls and 39 engine calls, listed in shared/api/calls.ts), with the local, runs and modules calls
 * beside them, and reaches them only through renderer/api/client.ts, whose `CallLayer` interface is the typed list of them. A shell supplies them through a `CallTransport`.
 * Electron is the one implementation today (`electronTransport`, in renderer/api/transport.ts). A second shell implements `CallTransport` and installs it, and no renderer file changes.
 * This file holds types only. It names no window global and imports no Electron or Node module.
 */

/** What a shell found for each side, as found and unchecked. renderer/api/client.ts checks it. A missing side is undefined. */
export interface RawBridges {
  readonly reader: unknown;
  readonly engine: unknown;
  readonly local?: unknown;
  readonly runs?: unknown;
  readonly modules?: unknown;
}

/** One shell's way of supplying the call layer. It hands calls over as they are: it adds no call, no permission and no wrapper that changes an argument or an answer. */
export interface CallTransport {
  /** A short name for the shell, for a message. */
  readonly id: string;
  /** The sides of this window, unchecked. Read when the page asks, not once at start. */
  bridges(): RawBridges;
  /** Whether the shell marked this page as the sample launch with the preview engines locked. */
  samplePreviewEngines(): boolean;
}
