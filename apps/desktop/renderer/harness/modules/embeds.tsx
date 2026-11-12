/**
 * The pages of the stock modules that can run inside the Modules view, by extension id. A module that has a page of its own on a route and no entry here is listed in the view with a way to open its own page.
 * To align with lane 1 (the written extension API): this table is the smallest local seam. It is not part of the manifest, because a manifest carries no code.
 */
import type { ReactElement } from 'react';
import { LocalModelsEmbedded } from '../local-models/LocalModels.js';

const EMBEDS: Readonly<Record<string, () => ReactElement>> = Object.freeze({
  'local-models': () => <LocalModelsEmbedded />,
});

/** The page of a module inside the view, or undefined when the module has none. Own names only. */
export const embeddedPageOf = (id: string): (() => ReactElement) | undefined => (Object.hasOwn(EMBEDS, id) ? EMBEDS[id] : undefined);
