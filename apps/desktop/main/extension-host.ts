/**
 * Starts the extension mechanism in main (v0.9). One registry holds the six protected default extensions and the extensions that ship inside the app bundle.
 *  - The loader (main/extension-loader.ts) reads `<bundle root>/extensions/<name>/manifest.json` and nothing from outside the bundle root. No path from the command line, the
 *    environment or the window reaches it. In 0.9 only bundled extensions load.
 *  - A loaded extension is refused RESERVED when it takes a default's id or route, or says it is protected. Protected extensions stay as the defaults are.
 *  - A bad extension is skipped or refused; it never stops the app, and it never leaves the registry without its six defaults. Each skip and refusal is handed to a writer
 *    (main writes it to stderr) and, when the launch has the local usage log, its code alone is recorded there as an error event. THE LIMIT: a launch with no usage log
 *    (the sample, or no engine calls) has stderr only, and a Finder-launched app does not show stderr. The person sees no word about a skipped extension in that case.
 *  - uninstallExtension is the one check for an uninstall. It fails closed: a protected extension is never removed, and a check that cannot decide refuses with PROTECTED.
 *    Anything that later lets a person uninstall (an IPC channel) must call uninstallExtension, and never registry.uninstall.
 * This file imports no electron, so the test and main run the same code. It writes no file and runs no extension code.
 */

import { join } from 'node:path';
import { DEFAULT_IDS } from '../shared/extensions/defaults.js';
import { registerDefaults, registerLoaded } from '../shared/extensions/register.js';
import { createRegistry } from '../shared/extensions/registry.js';
import type { Registry } from '../shared/extensions/registry.js';
import { refuse } from '../shared/extensions/manifest.js';
import type { Answer, ExtensionManifest } from '../shared/extensions/types.js';
import { loadBundledManifests } from './extension-loader.js';
import type { Skipped } from './extension-loader.js';

/** One loaded manifest that the registry refused, with the id it claimed (or "?" when it had none). */
export interface Refused { readonly id: string; readonly code: string; readonly message: string }

export interface ExtensionHost {
  /** Holds the six defaults and every bundled extension that was accepted. The mount of each is undefined: main draws nothing. */
  readonly registry: Registry;
  /** Folders the loader could not take, with their codes. */
  readonly skipped: readonly Skipped[];
  /** Manifests the loader read and the registry refused. */
  readonly refused: readonly Refused[];
  /** The answer to an uninstall. See uninstallExtension. */
  uninstall(id: unknown): Answer<ExtensionManifest>;
}

/**
 * Where the bundled extensions are: `<resources>/extensions` in a packaged build, and `apps/desktop/extensions` in development (`appRoot` is apps/desktop/dist).
 * The result is the bundle root, which the loader adds `extensions` to.
 */
export function extensionsBundleRoot(o: { readonly packaged: boolean; readonly resourcesPath: string; readonly appRoot: string }): string {
  return o.packaged ? o.resourcesPath : join(o.appRoot, '..');
}

const isDefaultId = (id: unknown): boolean => typeof id === 'string' && (DEFAULT_IDS as readonly string[]).includes(id);
/** An answer the check can trust for this id: a refusal, or a removal of the extension that was asked for and was not protected. */
const isAnswerFor = (value: unknown, id: unknown): value is Answer<ExtensionManifest> => {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as { ok?: unknown; refusal?: unknown; value?: unknown };
  if (a.ok === false) return typeof a.refusal === 'object' && a.refusal !== null;
  if (a.ok !== true || typeof a.value !== 'object' || a.value === null) return false;
  const m = a.value as { id?: unknown; protected?: unknown };
  return m.id === id && m.protected === false;
};

/** Runs a writer that may fail. A writer that throws (a closed stderr, a full disk) never stops the caller. */
function safely(write: (() => void) | undefined): void {
  if (write === undefined) return;
  try { write(); } catch { /* the report is lost; the start and the check go on */ }
}

/** The name of a thrown value, when it is a plain short name such as TypeError. Never its message, never any other text. */
function nameOf(error: unknown): string {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : 'unknown';
}

/**
 * The check before an uninstall. It fails closed:
 *  - A default id is PROTECTED whatever the registry holds, even when the registry lost it or holds it as unprotected. The registry is not asked.
 *  - Any other id goes to the registry, which refuses PROTECTED for a protected extension and UNKNOWN_EXTENSION for an id it does not hold.
 *  - A registry that throws gives PROTECTED, and `tell` gets the error name only. So does an answer that is not an answer, an ok that carries a protected manifest,
 *    and an ok for another id than the one asked. The check cannot say the extension is free to go, so it stays.
 */
export function uninstallExtension(registry: Registry, id: unknown, tell?: (line: string) => void): Answer<ExtensionManifest> {
  if (isDefaultId(id)) return refuse('PROTECTED', `The extension "${String(id)}" is part of the app and cannot be uninstalled.`);
  const stays = (): Answer<ExtensionManifest> => refuse('PROTECTED', 'The extension could not be checked, so it stays installed.');
  let answer: unknown;
  try { answer = registry.uninstall(id as string); } catch (error) {
    const name = nameOf(error);
    safely(() => tell?.(`Bowerloom could not check an extension uninstall (${name}), so the extension stays.`));
    return stays();
  }
  return isAnswerFor(answer, id) ? answer : stays();
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The id a manifest-like value claims, for a report. Only a plain name is shown. */
const claimed = (value: unknown): string => {
  const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined;
  return typeof id === 'string' && SAFE_ID.test(id) ? id : '?';
};

/** Writes one usage event and returns whether a line was written. The local usage log is one (main/engine-events.ts). */
export type UsageRecorder = (input: Readonly<Record<string, unknown>>) => boolean;

/**
 * Registers the six defaults, then loads the bundled extensions from `bundleRoot`. Each skip and each refusal goes to `tell` (main writes it to stderr) and, when `record`
 * is given, its code alone is recorded as an error event (step `extension-skipped` or `extension-refused`): no name, no path, no manifest text. Without `record`, stderr is all there is.
 * It never throws for a bad extension or for a writer that throws. The defaults are registered first, so they cannot be displaced.
 */
export function startExtensions(bundleRoot: string, tell: (line: string) => void = () => undefined, record?: UsageRecorder): ExtensionHost {
  const registry = createRegistry();
  registerDefaults(registry);
  const loaded = loadBundledManifests(bundleRoot);
  for (const s of loaded.skipped) {
    safely(() => tell(`Bowerloom skipped the extension "${s.name}" (${s.code}): ${s.message}`));
    safely(() => { record?.({ source: 'app', kind: 'error', step: 'extension-skipped', code: s.code }); });
  }
  const answers = registerLoaded(registry, loaded.manifests);
  const refused: Refused[] = [];
  answers.forEach((answer, i) => {
    if (answer.ok) return;
    const id = claimed(loaded.manifests[i]);
    refused.push({ id, code: answer.refusal.code, message: answer.refusal.message });
    safely(() => tell(`Bowerloom did not load the extension "${id}" (${answer.refusal.code}): ${answer.refusal.message}`));
    safely(() => { record?.({ source: 'app', kind: 'error', step: 'extension-refused', code: answer.refusal.code }); });
  });
  return Object.freeze({ registry, skipped: loaded.skipped, refused, uninstall: (id: unknown) => uninstallExtension(registry, id, tell) });
}
