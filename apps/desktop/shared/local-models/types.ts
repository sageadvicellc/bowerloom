// The wire types of the local models report, for the app. They are written once, in packages/local-models/src/types.ts, and only re-exported here, so main, the
// window and the package cannot drift. A type-only export: nothing of the package runs in the page.
export type { LocalModel, LocalModelsNote, LocalModelsReport, ModelState, ProviderId } from '../../../../packages/local-models/src/types.js';
