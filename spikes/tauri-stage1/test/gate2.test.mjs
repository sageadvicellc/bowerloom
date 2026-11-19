// Gate 2 on macOS (WKWebView): the web features the renderer uses, the page scheme, the content security policy and the permission checks.
// Also the engine amendment's proposal: a WebGL 2 context, one shader, one frame. The page runs in the hidden window of the Tauri spike app.
// Visual and frame checks are not part of the macOS phase of Gate 2 (the plan keeps them for Linux).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { TAURI, run } from './support.mjs';

const go = (t, scenario, options) => run(t, scenario, options, TAURI);
const LIMIT = { timeout: 60000 };

test('G2.0 the macOS version and the web view are recorded', LIMIT, async t => {
  const r = await go(t, 'webview-features');
  const macos = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  t.diagnostic(`macOS ${macos}; ${r.userAgent}`);
  assert.match(r.userAgent, /AppleWebKit\/\d+/);
  assert.match(macos, /^\d+\.\d+/);
});

test('G2.1 each web feature the renderer uses works in WKWebView (7 of 7)', LIMIT, async t => {
  const { features } = await go(t, 'webview-features');
  for (const name of ['containerQuery', 'has', 'colorMix', 'backdropFilter', 'textWrap', 'resizeObserver', 'webAnimations']) {
    assert.equal(features[name], true, `${name} works`);
  }
  assert.equal(Object.keys(features).length, 7);
});

test('G2.2 the page is served from the app scheme, not from a file or the network', LIMIT, async t => {
  const { scheme } = await go(t, 'webview-features');
  assert.equal(scheme.protocol, 'tauri:');
  assert.equal(scheme.secureContext, true);
  assert.equal(scheme.notFile, true);
});

test('G2.3 the content security policy blocks an inline script, a remote script, a remote fetch and a remote image (4 of 4)', LIMIT, async t => {
  const { csp } = await go(t, 'webview-csp');
  assert.equal(csp.inlineScriptBlocked, true);
  assert.equal(csp.remoteScriptBlocked, true);
  assert.equal(csp.remoteFetchBlocked, true);
  assert.equal(csp.remoteImageBlocked, true);
  assert.ok(csp.violations >= 4, `violation events: ${csp.violations}`);
});

test('G2.4 permission requests are refused: geolocation, notifications, clipboard read, and the page cannot open a window (4 of 4)', LIMIT, async t => {
  const { permissions } = await go(t, 'webview-permissions');
  assert.notEqual(permissions.geolocation, 'granted');
  assert.equal(permissions.geolocationRefused, true);
  assert.notEqual(permissions.notifications, 'granted');
  assert.equal(permissions.clipboardReadRefused, true);
  assert.equal(permissions.windowOpenRefused, true);
});

test('G2.5 WebGL 2: a context is made, a shader compiles and links, and one frame draws the expected pixel', LIMIT, async t => {
  const r = await go(t, 'webgl');
  assert.equal(r.context, true);
  assert.equal(r.shadersCompiled, true);
  assert.equal(r.linked, true);
  assert.deepEqual(r.pixel, [255, 0, 0, 255]);
  t.diagnostic(`webgl: ${r.version} | ${r.renderer}`);
});
