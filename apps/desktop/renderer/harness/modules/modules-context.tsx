/**
 * What the Modules view is given, handed down the tree like the local calls (renderer/harness/local-models/local.tsx). The bridge is the read scope of a module (the approved folders): the preload's bridge on the
 * person's own folders, and none in the sample launch. The list is the bundled extensions main loaded, which the app asked for at launch (renderer/harness/bundled-extensions.ts). The page reaches the bridge only
 * through renderer/api/client.ts.
 */
import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { ModulesBridge } from '../../../shared/api/modules.js';
import type { ExtensionManifest } from '../../../shared/extensions/types.js';

/** `real`: this is the app on the person's own folders. There the bridge must be whole, so a missing or partial one is a failure and not a quiet "no approvals". */
export interface ModulesValue { readonly bridge: ModulesBridge | null; readonly sample: boolean; readonly real: boolean; readonly listed: readonly ExtensionManifest[] }
const Context = createContext<ModulesValue>({ bridge: null, sample: false, real: false, listed: [] });

export function ModulesProvider({ bridge, sample, real = false, listed, children }: { bridge: ModulesBridge | null; sample: boolean; real?: boolean; listed: readonly ExtensionManifest[]; children?: ReactNode }): ReactElement {
  return <Context value={{ bridge, sample, real, listed }}>{children}</Context>;
}

export const useModules = (): ModulesValue => useContext(Context);
