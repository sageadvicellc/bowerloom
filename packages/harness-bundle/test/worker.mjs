// A worker thread that runs the package on plain input and answers with plain output: the way the app runs it. It is started by review.test.mjs.
import { parentPort } from 'node:worker_threads';
import {
  BundleRefusal, decodeBundle, importChoicesOf, inspectBundle, targetFromBundle,
} from '../../../dist/packages/harness-bundle/src/index.js';

parentPort.on('message', async ({ id, bytes }) => {
  const began = performance.now();
  try {
    const decoded = await decodeBundle(bytes);
    const summary = inspectBundle(decoded);
    const target = targetFromBundle(decoded, importChoicesOf(null, decoded.knowledge.map(k => k.name)));
    parentPort.postMessage({ id, ok: true, ms: performance.now() - began, sha256: decoded.sha256, summary, files: target.map(f => ({ path: f.path, size: f.bytes.length })) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, ms: performance.now() - began, refusal: error instanceof BundleRefusal ? error.toJSON() : { other: String(error?.constructor?.name) } });
  }
});
