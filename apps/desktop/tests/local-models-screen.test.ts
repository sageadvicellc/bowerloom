// The Local models screen and its extension: the markup of each state, the registration of the bundled mount from `listExtensions`, the retry of a list that is not ready at launch,
// the navigation entry, the route, the manifest and the way it ships, and the rules that keep the page pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HIcon } from '../renderer/harness/icons.js';
import { HarnessApp } from '../renderer/harness/HarnessApp.js';
import { LocalModelsBody, PendingBody, ReadAnnouncer } from '../renderer/harness/local-models/LocalModels.js';
import type { BodyProps, PendingProps } from '../renderer/harness/local-models/LocalModels.js';
import { BUNDLED_IDS, createScreenRegistry, registerBundled } from '../renderer/harness/extension-mounts.js';
import { followExtensions } from '../renderer/harness/bundled-extensions.js';
import type { Bundled, Scheduler } from '../renderer/harness/bundled-extensions.js';
import { LOCAL_MODELS_MANIFEST, createSampleLocal, sampleLocalReport } from '../shared/local-models/sample.js';
import { LOCAL_WORDS, REFRESH_MS } from '../shared/local-models/view-model.js';
import type { LocalBridge } from '../shared/api/local.js';
import type { LocalModelsReport } from '../shared/local-models/types.js';
import { BASE_ROUTES } from '../shared/extensions/defaults.js';
import { EXTENSION_ROUTES, formatRoute, navKeyOf, parseRoute } from '../shared/harness/route.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { DESKTOP } from './support.js';

const NOW = { daysAgo: 0, time: '10:00' };
type G = { location?: { hash: string } };
const SAMPLE = sampleLocalReport('2026-11-11T10:00:00Z');
const props = (over: Partial<BodyProps> = {}): BodyProps => ({ available: true, sample: false, report: SAMPLE, failed: false, stale: false, busy: false, code: null, ...over });
const body = (over: Partial<BodyProps> = {}): string => renderToStaticMarkup(createElement(LocalModelsBody, props(over)) as ReactElement);
const empty = (over: Partial<LocalModelsReport>): LocalModelsReport => ({ sampledAt: SAMPLE.sampledAt, models: [], endpointsConfigured: 0, notes: [], ...over });

function renderApp(hash: string, local: LocalBridge | null | undefined, realMode = false): string {
  (globalThis as G).location = { hash };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    return renderToStaticMarkup(createElement(HarnessApp, { store, engine: realMode ? null : createSampleEngine(), local, realMode } as never) as ReactElement);
  } finally { delete (globalThis as G).location; }
}

// ---- the stage, state by state

test('rows: each server has a name heading, a state in words, and the figures, with memory and uptime "not reported"', () => {
  const html = body();
  assert.equal((html.match(/data-model="/g) ?? []).length, 3);
  assert.match(html, /<h2[^>]*>Example-9B \u00b7 port 8091<\/h2>/);
  assert.match(html, /<h2[^>]*>Example-20B \u00b7 port 8092<\/h2>/);
  for (const word of ['Up', 'Down', 'Q8_0', '9.5 GB', '32,768', '38.4 tokens/s', '61.2 tokens/s', '1 active', '25% (8,192 of 32,768)', 'Example-9B-Q8_0.gguf']) assert.ok(html.includes(word), word);
  assert.doesNotMatch(html, /data-fact="port"|<dt>Port<\/dt>/);
  assert.equal((html.match(/data-fact="memory"[^>]*><dt>Memory<\/dt><dd>not reported<\/dd>/g) ?? []).length, 2, 'the two cards that are up');
  assert.equal((html.match(/data-fact="uptime"[^>]*><dt>Uptime<\/dt><dd>not reported<\/dd>/g) ?? []).length, 2);
  assert.match(html, /aria-label="Local model servers"/);
  assert.match(html, /<dl class="hxl-facts">/);
});

test('a down server is a row with a state and a sentence, and shows no figure as 0', () => {
  const down = body({ report: { ...SAMPLE, models: [SAMPLE.models[2]!] } });
  assert.match(down, /data-state="Down"/); assert.match(down, /Nothing is listening on this port\./);
  assert.doesNotMatch(down, /<dd>0<\/dd>|0\.0 tokens/);
  assert.match(down, /<h2[^>]*>llama-server \u00b7 port 8093<\/h2>/);
  assert.match(down, /data-compact=""/); assert.doesNotMatch(down, /<dl|data-fact|not reported|data-row-note/, 'the compact card has no field');
});

test('a starting server is a row in the state "Starting"', () => {
  const m = { ...SAMPLE.models[2]!, state: 'starting' as const, stateReason: 'LOADING' };
  const html = body({ report: { ...SAMPLE, models: [m] } });
  assert.match(html, /data-state="Starting"/); assert.match(html, /The server is loading a model\./);
  assert.doesNotMatch(html, /<dl|not reported/);
});

test('PARTIAL_READ shows as a plain sentence above the rows', () => {
  const html = body({ report: { ...SAMPLE, notes: [{ code: 'PARTIAL_READ', text: 'A server answered, but some of its figures could not be read.' }] } });
  assert.match(html, /<p class="hx-text" data-local-note="">A server answered, but some of its figures could not be read\.<\/p>/);
  assert.match(html, /data-model=/);
});

test('the own notes of a row show on that row when the report has them, and the screen works without them', () => {
  const m = { ...SAMPLE.models[0]!, notes: [{ code: 'METRICS_OFF', text: 'This server runs without metrics.' }] };
  const html = body({ report: { ...SAMPLE, models: [m as never] } });
  assert.match(html, /data-row-note="">This server runs without metrics\.</);
  assert.doesNotMatch(body(), /data-row-note/);
});

test('PROBE_FAILED: the note\'s sentence shows instead of "no servers" and instead of any zero count', () => {
  const sentence = 'The probe of the local model servers failed. It will be tried again.';
  const html = body({ report: empty({ notes: [{ code: 'PROBE_FAILED', text: sentence }] }) });
  assert.ok(html.includes(sentence));
  assert.doesNotMatch(html, /No local model servers are set up|data-local-state="empty"/);
  assert.doesNotMatch(html, /\b0 up\b|data-model=/);
  // The same empty report without that note is the empty state: the two are told apart.
  const none = body({ report: empty({ notes: [{ code: 'NO_ENDPOINTS', text: 'No local model server answered. Add a port to the local models file.' }] }) });
  assert.match(none, /data-local-state="empty"/); assert.ok(none.includes(LOCAL_WORDS.empty));
  assert.doesNotMatch(none, new RegExp(sentence));
});

test('PROBE_FAILED through the whole screen: the top row takes its count from the view, which has none for a failed probe', () => {
  const text = readFileSync(join(DESKTOP, 'renderer/harness/local-models/LocalModels.tsx'), 'utf8');
  assert.ok(text.includes('view.summary === null ? undefined : view.summary'));
}
);

test('loading, retrying, stale, no bridge and the sample label each have words', () => {
  assert.match(body({ report: null }), /role="status" data-local-state="loading">Reading the local model servers\./);
  assert.match(body({ report: null, failed: true }), /data-local-state="retrying">The local model servers could not be read\. Trying again\./);
  assert.doesNotMatch(body({ report: null, failed: true }), /role="alert"/, 'the first failed read is not an error page');
  const stale = body({ stale: true, failed: true });
  assert.match(stale, /data-local-state="stale"/); assert.match(stale, /data-model=/, 'the last good figures stay');
  assert.match(body({ available: false, report: null }), /data-local-state="no-bridge">This window cannot read local model servers\./);
  assert.match(body({ sample: true }), /data-local-sample="">Sample data\./);
  assert.doesNotMatch(body(), /data-local-sample/);
  assert.match(body({ busy: true }), /aria-busy="true"/);
});

test('no state is blank', () => {
  for (const over of [{ report: null }, { report: null, failed: true }, { available: false, report: null }, { report: empty({}) }, { report: empty({ notes: [{ code: 'PROBE_FAILED', text: 'The probe failed.' }] }) }]) {
    assert.ok(body(over as Partial<BodyProps>).replace(/<[^>]*>/g, '').trim().length > 10, JSON.stringify(over));
  }
});

test('CONFIG_UNREADABLE with no servers shows the note with its reason, and never "No local model servers are set up" and never a count', () => {
  const text = 'The local models file could not be read, so no server was probed.';
  const html = body({ report: empty({ notes: [{ code: 'CONFIG_UNREADABLE', text, reason: 'PARSE' }] }) });
  assert.ok(html.includes(`${text} Reason: PARSE.`));
  assert.doesNotMatch(html, /No local model servers are set up|data-local-state="empty"|\b0 up\b|data-model=/);
});

test('a note with no text still shows a sentence that names its code and reason', () => {
  const html = body({ report: empty({ notes: [{ code: 'NEW_THING', text: '', reason: 'PARSE' }] }) });
  assert.match(html, /data-local-note="">[^<]*NEW_THING[^<]*PARSE/);
});

test('a failed read shows its code, on the first read and on a later one', () => {
  assert.match(body({ report: null, failed: true, code: 'HOST_NOT_STARTED' }), /could not be read\. Trying again\.[^<]*HOST_NOT_STARTED/);
  assert.match(body({ stale: true, failed: true, code: 'FAILED' }), /data-local-state="stale"[^>]*>[^<]*FAILED/);
  assert.doesNotMatch(body({ report: null, failed: true, code: null }), /Code:/);
});

test('two notes with the same sentence, and a row with two equal notes, render with no duplicate-key warning', () => {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => { errors.push(args); };
  try {
    const same = { code: 'PARTIAL_READ', text: 'Same sentence.' };
    const m = { ...SAMPLE.models[0]!, notes: [{ code: 'METRICS_OFF' }, { code: 'METRICS_OFF' }] };
    const html = body({ report: { ...SAMPLE, models: [m as never], notes: [same, same] } });
    assert.equal((html.match(/data-local-note=""/g) ?? []).length, 2);
  } finally { console.error = original; }
  assert.deepEqual(errors, []);
});

test('the read announcer is a status line that is always there, and says "Reading the servers." or "Updated." only when told', () => {
  const html = (announce: 'reading' | 'updated' | null): string => renderToStaticMarkup(createElement(ReadAnnouncer, { announce }) as ReactElement);
  assert.match(html('reading'), /role="status"[^>]*>Reading the servers\.</);
  assert.match(html('updated'), /role="status"[^>]*>Updated\.</);
  const quiet = html(null);
  assert.match(quiet, /role="status"/); assert.equal(quiet.replace(/<[^>]*>/g, ''), '');
  assert.match(quiet, /hxl-sr-only/);
  const css = readFileSync(join(DESKTOP, 'renderer/harness/local-models/local-models.css'), 'utf8');
  assert.match(css, /\.hxl-sr-only\s*\{[^}]*clip|\.hxl-sr-only\s*\{[^}]*position:\s*absolute/);
  assert.equal(LOCAL_WORDS.refreshing, 'Reading the servers.');
});

test('the Refresh button stays enabled during a read, so keyboard focus is not lost, and the staleness comes from the hook', () => {
  const text = readFileSync(join(DESKTOP, 'renderer/harness/local-models/LocalModels.tsx'), 'utf8');
  assert.doesNotMatch(text, /disabled=\{[^}]*busy/);
  assert.doesNotMatch(text, /realNowMs|isStale\(/, 'the render reads no clock');
  assert.match(text, /memo\(/);
});

test('the waiting line of the extension list names a failure and the skipped extensions', () => {
  const html = (over: PendingProps): string => renderToStaticMarkup(createElement(PendingBody, over) as ReactElement);
  assert.match(html({}), /Reading the local model servers\./);
  const failed = html({ problem: 'HOST_NOT_STARTED' });
  assert.match(failed, /extension host has not started/i); assert.match(failed, /HOST_NOT_STARTED/);
  assert.match(html({ loading: false, skipped: [{ name: 'alpha', code: 'X' }] }), /did not load/);
  const skipped = html({ skipped: [{ name: 'alpha', code: 'BAD_MANIFEST' }, { name: 'beta', code: 'TOO_BIG' }] });
  for (const word of ['alpha', 'BAD_MANIFEST', 'beta', 'TOO_BIG']) assert.ok(skipped.includes(word), word);
});

// ---- the extension: registration, the list that is not ready, the navigation and the route

test('the manifest is bundled, not protected, owns the route local-models, and the sample manifest equals it', () => {
  const manifest = JSON.parse(readFileSync(join(DESKTOP, 'extensions/local-models/manifest.json'), 'utf8')) as unknown;
  assert.deepEqual(manifest, { id: 'local-models', title: 'Local models', kind: 'ui', routes: ['local-models'], protected: false });
  assert.deepEqual(manifest, JSON.parse(JSON.stringify(LOCAL_MODELS_MANIFEST)));
  assert.deepEqual([...BUNDLED_IDS], ['local-models']);
});

test('registerBundled registers the screen of a listed extension once, leaves out one with no screen, and the route then resolves', () => {
  const registry = createScreenRegistry();
  assert.equal(registry.resolve('local-models').found, false);
  const other = { id: 'unknown-ext', title: 'Other', kind: 'ui' as const, routes: ['unknown-ext'], protected: false };
  assert.deepEqual(registerBundled(registry, [LOCAL_MODELS_MANIFEST, other]).map(m => m.id), ['local-models']);
  assert.equal(registry.resolve('local-models').found, true); assert.equal(registry.resolve('unknown-ext').found, false);
  assert.deepEqual(registerBundled(registry, [LOCAL_MODELS_MANIFEST]).map(m => m.id), ['local-models'], 'again changes nothing');
  assert.equal(registry.list().filter(m => m.id === 'local-models').length, 1);
});

test('a listed extension that claims to be protected, or takes a default route, is not registered', () => {
  const registry = createScreenRegistry();
  assert.deepEqual(registerBundled(registry, [{ ...LOCAL_MODELS_MANIFEST, protected: true }]), []);
  assert.deepEqual(registerBundled(registry, [{ ...LOCAL_MODELS_MANIFEST, routes: ['overview'] }]), []);
});

function fakeClock(): Scheduler & { queue: { run: () => void; ms: number }[]; cancelled: number } {
  const clock = { queue: [] as { run: () => void; ms: number }[], cancelled: 0, after(run: () => void, ms: number) { const h = { run, ms }; clock.queue.push(h); return h; }, cancel() { clock.cancelled += 1; } };
  return clock;
}
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('listExtensions that fails at launch (FAILED, then HOST_NOT_STARTED) is "not ready yet": no answer is given, it is tried again on the refresh interval, and then it registers', async () => {
  const registry = createScreenRegistry();
  const clock = fakeClock();
  const answers: Bundled[] = [];
  let calls = 0;
  const bridge: LocalBridge = {
    localModels: async () => SAMPLE,
    listExtensions: async () => { calls += 1; if (calls === 1) throw new Error('FAILED'); if (calls === 2) throw new Error('HOST_NOT_STARTED'); return { extensions: [LOCAL_MODELS_MANIFEST], skipped: [] }; },
  };
  followExtensions(registry, bridge, state => answers.push(state), clock);
  await settle();
  assert.equal(calls, 1); assert.equal(answers.length, 0, 'a first failure is not an answer and not an error'); assert.equal(registry.resolve('local-models').found, false);
  assert.equal(clock.queue.length, 1); assert.equal(clock.queue[0]!.ms, REFRESH_MS);
  clock.queue[0]!.run(); await settle();
  assert.equal(calls, 2); assert.equal(answers.length, 0); assert.equal(clock.queue.length, 2); assert.equal(clock.queue[1]!.ms, REFRESH_MS);
  clock.queue[1]!.run(); await settle();
  assert.equal(calls, 3); assert.equal(answers.length, 1); assert.equal(answers[0]!.ready, true); assert.deepEqual(answers[0]!.extensions.map(m => m.id), ['local-models']);
  assert.equal(registry.resolve('local-models').found, true); assert.equal(clock.queue.length, 2, 'it stops asking once answered');
});

test('stopping while a retry is waiting cancels it, and a late answer after stop is ignored', async () => {
  const registry = createScreenRegistry(), clock = fakeClock(), answers: Bundled[] = [];
  let release: (() => void) | null = null;
  const pending: LocalBridge = { localModels: async () => SAMPLE, listExtensions: () => new Promise((_, reject) => { release = () => reject(new Error('FAILED')); }) };
  const stop = followExtensions(registry, pending, s => answers.push(s), clock);
  stop(); release!(); await settle();
  assert.equal(clock.queue.length, 0); assert.equal(answers.length, 0);
  const failing: LocalBridge = { localModels: async () => SAMPLE, listExtensions: async () => { throw new Error('FAILED'); } };
  const stop2 = followExtensions(registry, failing, s => answers.push(s), clock);
  await settle(); stop2();
  assert.equal(clock.cancelled, 1);
});

test('the route local-models is an extension route: it parses, formats and belongs to the navigation item of its own name, and is not one of the 15 base routes', () => {
  assert.deepEqual([...EXTENSION_ROUTES], ['local-models']);
  assert.equal(BASE_ROUTES.length, 15); assert.equal((BASE_ROUTES as readonly string[]).includes('local-models'), false);
  assert.deepEqual(parseRoute('#sample/local-models'), { name: 'local-models' }); assert.deepEqual(parseRoute('#app/local-models'), { name: 'local-models' });
  assert.equal(formatRoute({ name: 'local-models' }), '#sample/local-models'); assert.equal(formatRoute({ name: 'local-models' }, '#app'), '#app/local-models');
  assert.equal(navKeyOf({ name: 'local-models' }), 'local-models');
});

test('the sample launch shows the screen route as a waiting line at the first frame (never the not-found state), and a launch with no bridge says so plainly', () => {
  const sample = renderApp('#sample/local-models', createSampleLocal(() => SAMPLE.sampledAt));
  assert.match(sample, /data-screen="local-models"/); assert.match(sample, /data-local-pending=""/); assert.doesNotMatch(sample, /ROUTE_NOT_FOUND/);
  const none = renderApp('#app/local-models', null, true);
  assert.doesNotMatch(none, /data-local-pending/);
  assert.match(none, /data-error="ROUTE_NOT_FOUND"/, 'with no bridge the extension never loaded, so its route is not available');
});

test('the navigation has no Local models item before the list answers, so a removed extension has no entry', () => {
  assert.doesNotMatch(renderApp('#sample/harnesses', createSampleLocal(() => SAMPLE.sampledAt)), /data-nav-key="local-models"/);
  assert.doesNotMatch(renderApp('#app/harnesses', null, true), /data-nav-key="local-models"/);
});

test('Local models has its own navigation icon, not the one of Engines', () => {
  const nav = readFileSync(join(DESKTOP, 'renderer/harness/Navigation.tsx'), 'utf8');
  assert.match(nav, /navKey=\{x\.id\} icon=\{x\.icon\}/, 'an extension item draws the icon it is given');
  assert.doesNotMatch(nav, /navKey=\{x\.id\} icon="monitor"/);
  assert.match(nav, /navKey="interfaces" icon="monitor"/, 'Engines keeps its monitor');
  const shell = readFileSync(join(DESKTOP, 'renderer/harness/Shell.tsx'), 'utf8');
  assert.match(shell, /id: x\.id, title: x\.title, icon: 'chip'/);
  const svg = (name: 'chip' | 'monitor'): string => renderToStaticMarkup(createElement(HIcon, { name }) as ReactElement);
  assert.notEqual(svg('chip'), svg('monitor')); assert.match(svg('chip'), /<svg[^>]*stroke="currentColor"/);
});

test('Navigation draws an item for each extension it is given, after Runs, and the item is one of the rove keys', () => {
  const nav = readFileSync(join(DESKTOP, 'renderer/harness/Navigation.tsx'), 'utf8');
  assert.match(nav, /\(p\.extensions \?\? \[\]\)\.map\(x => x\.id\)/);
  assert.ok(nav.indexOf('navKey="runs"') < nav.indexOf('navKey={x.id}'));
});

// ---- the page stays pure

test('the screen files import no engine, Node, Electron or bridge, and use no fetch or timer of their own beyond the interval', () => {
  const dir = join(DESKTOP, 'renderer/harness/local-models');
  const files = [...readdirSync(dir).filter(f => /\.tsx?$/.test(f)).map(f => join(dir, f)), join(DESKTOP, 'renderer/harness/bundled-extensions.ts')];
  assert.ok(files.length >= 4);
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(text, /from 'node:|from 'electron'|bowerloom(Real|Engine|Local)|\bfetch\(|XMLHttpRequest|WebSocket|ipcRenderer|window\.|localStorage|sessionStorage/, file);
  }
  const reader = readFileSync(join(dir, 'useLocalReport.ts'), 'utf8');
  assert.match(reader, /visibilityState === 'visible'/); assert.match(reader, /visibilitychange/); assert.match(reader, /clearInterval/);
});

test('the screen stores nothing: no history, no file, no storage', () => {
  const text = readFileSync(join(DESKTOP, 'renderer/harness/local-models/useLocalReport.ts'), 'utf8');
  assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|writeFile/);
});

test('the bundled extension ships: the folder holds one manifest and extraResources lists it', () => {
  assert.equal(existsSync(join(DESKTOP, 'extensions/local-models/manifest.json')), true);
  const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as { build: { extraResources: { from: string; to: string }[] } };
  assert.ok(pkg.build.extraResources.some(e => e.from === 'extensions' && e.to === 'extensions'));
});

test('listExtensions that keeps failing shows a sentence after three tries, with its code, and keeps trying quietly', async () => {
  const registry = createScreenRegistry(), clock = fakeClock(), answers: Bundled[] = [];
  let calls = 0, ok = false;
  const bridge: LocalBridge = {
    localModels: async () => SAMPLE,
    listExtensions: async () => { calls += 1; if (ok) return { extensions: [LOCAL_MODELS_MANIFEST], skipped: [{ name: 'alpha', code: 'BAD_MANIFEST' }] }; throw new Error('HOST_NOT_STARTED'); },
  };
  followExtensions(registry, bridge, s => answers.push(s), clock);
  for (let i = 0; i < 2; i += 1) { await settle(); clock.queue[i]!.run(); }
  await settle();
  assert.equal(calls, 3); assert.equal(answers.length, 1, 'the third failure gives one notice');
  assert.equal(answers[0]!.ready, false); assert.equal(answers[0]!.problem, 'HOST_NOT_STARTED'); assert.deepEqual(answers[0]!.extensions, []);
  assert.equal(clock.queue.length, 3, 'it still tries again'); assert.equal(clock.queue[2]!.ms, REFRESH_MS);
  clock.queue[2]!.run(); await settle();
  assert.equal(calls, 4); assert.equal(answers.length, 1, 'the same failure is not told twice');
  ok = true; clock.queue[3]!.run(); await settle();
  assert.equal(answers.length, 2); assert.equal(answers[1]!.ready, true); assert.equal(answers[1]!.problem, null);
  assert.deepEqual(answers[1]!.skipped, [{ name: 'alpha', code: 'BAD_MANIFEST' }]);
});

test('a listExtensions that throws at once, not as a rejected promise, is a failed try and not a crash', async () => {
  const registry = createScreenRegistry(), clock = fakeClock(), answers: Bundled[] = [];
  const bridge: LocalBridge = { localModels: async () => SAMPLE, listExtensions: () => { throw new Error('FAILED'); } };
  assert.doesNotThrow(() => followExtensions(registry, bridge, s => answers.push(s), clock));
  await settle();
  assert.equal(clock.queue.length, 1); assert.equal(answers.length, 0);
});
