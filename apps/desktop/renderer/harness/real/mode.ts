/**
 * Which Choose screen a launch gets. The mode comes from the page address (`#prototype-v3-real` or `#prototype-v3`), never from whether a bridge is there: a real launch whose bridge is
 * missing or partial gets the no-bridge error, and never the sample.
 */
import type { RealBridge } from '../../../shared/real/types.js';

export type ChooseKind = { readonly kind: 'sample' } | { readonly kind: 'real'; readonly bridge: RealBridge } | { readonly kind: 'no-bridge' };

export const chooseKind = (realMode: boolean, bridge: RealBridge | null): ChooseKind => (!realMode ? { kind: 'sample' } : bridge === null ? { kind: 'no-bridge' } : { kind: 'real', bridge });
