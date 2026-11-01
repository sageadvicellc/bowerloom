/**
 * The one value the host (main/engine-bundle.ts, in main.mjs) and the worker (main/engine-bundle-work.ts, only in bundle-worker.mjs) share. It sits in its own file so main.mjs
 * does not pull the work module, with its held bundles and its writes, into the main thread's bundle (tests/bundle-worker-static.test.ts holds that).
 */
/** The code of the refusal of a job for a bundle the worker does not hold (it restarted, or the bundle was dropped). Main maps it to UNKNOWN_BUNDLE. */
export const UNKNOWN_BUNDLE_MARK = 'UNKNOWN_BUNDLE_HELD';
