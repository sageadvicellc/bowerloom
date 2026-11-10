/**
 * Starts the extension mechanism in main (v0.9). One registry holds the six protected default extensions and the extensions that ship inside the app bundle.
 *  - The loader (main/extension-loader.ts) reads `<bundle root>/extensions/<name>/manifest.json` and nothing from outside the bundle root. No path from the command line, the
 *    environment or the window reaches it. In 0.9 only bundled extensions load.
 *  - A loaded extension is refused RESERVED when it takes a default's id or route, or says it is protected. Protected extensions stay as the defaults are.
 *  - A bad extension is skipped or refused and told; it never stops the app, and it never leaves the registry without its six defaults.
 *  - uninstallExtension is the one check for an uninstall. It fails closed: a protected extension is never removed, and a check that cannot decide refuses with PROTECTED.
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
const isAnswer = (value: unknown): value is Answer<ExtensionManifest> => {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as { ok?: unknown; refusal?: unknown; value?: unknown };
  return a.ok === true ? typeof a.value === 'object' && a.value !== null : a.ok === false && typeof a.refusal === 'object' && a.refusal !== null;
};

/**
 * The check before an uninstall. It fails closed:
 *  - A default id is PROTECTED whatever the registry holds, even when the registry lost it or holds it as unprotected. The registry is not asked.
 *  - Any other id goes to the registry, which refuses PROTECTED for a protected extension and UNKNOWN_EXTENSION for an id it does not hold.
 *  - A registry that throws, or answers with something that is not an answer, gives PROTECTED. The check cannot say the extension is free to go, so it stays.
 */
export function uninstallExtension(registry: Registry, id: unknown): Answer<ExtensionManifest> {
  if (isDefaultId(id)) return refuse('PROTECTED', `The extension "${String(id)}" is part of the app and cannot be uninstalled.`);
  let answer: unknown;
  try { answer = registry.uninstall(id as string); } catch {
    return refuse('PROTECTED', 'The extension could not be checked, so it stays installed.');
  }
  return isAnswer(answer) ? answer : refuse('PROTECTED', 'The extension could not be checked, so it stays installed.');
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The id a manifest-like value claims, for a report. Only a plain name is shown. */
const claimed = (value: unknown): string => {
  const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined;
  return typeof id === 'string' && SAFE_ID.test(id) ? id : '?';
};

/**
 * Registers the six defaults, then loads the bundled extensions from `bundleRoot`. `tell` gets one line for each skip and each refusal (main writes them to stderr).
 * It never throws for a bad extension. The defaults are registered first, so they cannot be displaced.
 */
export function startExtensions(bundleRoot: string, tell: (line: string) => void = () => undefined): ExtensionHost {
  const registry = createRegistry();
  registerDefaults(registry);
  const loaded = loadBundledManifests(bundleRoot);
  for (const s of loaded.skipped) tell(`Bowerloom skipped the extension "${s.name}" (${s.code}): ${s.message}`);
  const answers = registerLoaded(registry, loaded.manifests);
  const refused: Refused[] = [];
  answers.forEach((answer, i) => {
    if (answer.ok) return;
    const id = claimed(loaded.manifests[i]);
    refused.push({ id, code: answer.refusal.code, message: answer.refusal.message });
    tell(`Bowerloom did not load the extension "${id}" (${answer.refusal.code}): ${answer.refusal.message}`);
  });
  return Object.freeze({ registry, skipped: loaded.skipped, refused, uninstall: (id: unknown) => uninstallExtension(registry, id) });
}
