/**
 * The steps of the approved folders of one module, pure: no React, no Node, no clock. Each step calls the modules bridge and gives back the patch to lay over the state the screen holds, so the screen
 * (renderer/harness/modules/useModulePlaces.ts) only holds the state and the tests drive every step with a fake bridge. A refusal of any kind, or a call that throws at once, is a state with its short code
 * and never a blank page. Nothing is stored here: the record is main's.
 */
import { refusalCode } from '../api/calls.js';
import type { ModuleApproval, ModulePlace, ModulesBridge } from '../api/modules.js';
import { MODULE_WORDS, approvalNotice } from './view-model.js';

export interface PlacesView {
  /** `none`: there is no bridge. `loading`: the first read has not answered. `ready`: the list is in `places`. `failed`: a call was refused, with its code in `code`. */
  readonly status: 'none' | 'loading' | 'ready' | 'failed';
  readonly places: readonly ModulePlace[];
  readonly code: string | null;
  readonly busy: boolean;
  /** The line after the last approval or removal, or null. */
  readonly notice: string | null;
}
export type PlacesPatch = Partial<PlacesView>;

export const firstPlaces = (bridge: ModulesBridge | null): PlacesView => ({ status: bridge === null ? 'none' : 'loading', places: [], code: null, busy: false, notice: null });

/** Runs a call that may throw at once or reject, and gives the answer or the short code of the refusal. */
async function attempt<T>(run: () => Promise<T>): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string }> {
  try { return { ok: true, value: await run() }; } catch (error) { return { ok: false, code: refusalCode(error, 'modules') }; }
}

const failed = (code: string): PlacesPatch => ({ status: 'failed', places: [], code });

/** The first read, and every read after a change. */
export async function loadPlaces(bridge: ModulesBridge, moduleId: string): Promise<PlacesPatch> {
  const done = await attempt(() => bridge.listModulePlaces(moduleId));
  return done.ok ? { status: 'ready', places: done.value.places, code: null } : failed(done.code);
}

/**
 * The person asked to approve a folder. The bridge opens main's own chooser, so this step names no folder. A cancel changes nothing but the busy flag. A kept place is followed by a new read of the list,
 * so the page shows what main holds. A refused pick keeps the list as it was and says why.
 */
export async function approveFlow(bridge: ModulesBridge, moduleId: string): Promise<PlacesPatch> {
  const done = await attempt<ModuleApproval>(() => bridge.approveModulePlace(moduleId));
  if (!done.ok) return { ...failed(done.code), busy: false, notice: null };
  const notice = approvalNotice(done.value);
  if (done.value.status !== 'kept') return { busy: false, notice };
  return { ...(await loadPlaces(bridge, moduleId)), busy: false, notice };
}

/** The person asked to remove a folder. The answer is the places that are left. The folder and its files are untouched. */
export async function removeFlow(bridge: ModulesBridge, moduleId: string, placeId: string): Promise<PlacesPatch> {
  const done = await attempt(() => bridge.revokeModulePlace(moduleId, placeId));
  return done.ok ? { status: 'ready', places: done.value.places, code: null, busy: false, notice: MODULE_WORDS.removed } : { status: 'failed', code: done.code, busy: false, notice: null };
}
