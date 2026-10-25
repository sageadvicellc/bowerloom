/**
 * The names of the store's own actions are code, not screen words, so they live here, away from the screens. The screens call these builders and never
 * write an action name themselves.
 */
import type { StoreAction } from '../../shared/proto/store.js';

/** Writes the draft down as a save point. */
export const saveAction = (label: string): StoreAction => ({ type: 'apply', label });
