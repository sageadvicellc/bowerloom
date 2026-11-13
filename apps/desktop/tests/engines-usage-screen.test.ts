// The Engines and usage module as a stock extension: the markup of each state, the manifest and the three places that register it (the mount table, the pages that run inside the Modules view, and the
// sample list), the address it opens at, and the rules that keep it to what exists: no new call, no new golden file, no bridge named, no clock and no estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarnessApp } from '../renderer/harness/HarnessApp.js';
import { Modules } from '../renderer/harness/modules/ModulesScreen.js';
import { ModulesProvider } from '../renderer/harness/modules/modules-context.js';
import { embeddedPageOf } from '../renderer/harness/modules/embeds.js';
import { EnginesUsage, EnginesUsageBody, EnginesUsageEmbedded } from '../renderer/harness/engines-usage/EnginesUsage.js';
import { RunsProvider } from '../renderer/harness/runs-real/runs-session.js';
import { Shell } from '../renderer/harness/Shell.js';
import { HarnessProvider } from '../renderer/harness/session.js';
import { UiProvider } from '../renderer/harness/ui.js';
import { BUNDLED_IDS, createScreenRegistry, registerBundled } from '../renderer/harness/extension-mounts.js';
import { ENGINES_USAGE_MANIFEST, LOCAL_MODELS_MANIFEST, MODULES_MANIFEST, createSampleLocal } from '../shared/local-models/sample.js';
import { ENGINES_WORDS, enginesView } from '../shared/engines-usage/model.js';
import type { UsageSource } from '../shared/engines-usage/model.js';
import { moduleRows } from '../shared/modules/view-model.js';
import { BASE_ROUTES } from '../shared/extensions/defaults.js';
import { formatRoute, parseRoute } from '../shared/harness/route.js';
import { createHarnessStore } from '../shared/harness/store.js';
import { createSampleWorld } from '../shared/harness/sample.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { ENGINE_API_CALLS, LOCAL_CALLS, MODULE_CALLS, READER_API_CALLS, RUN_CALLS } from '../../../packages/engine-api/src/index.js';
import { RUN_CALLS as RUN_BRIDGE_CALLS } from '../shared/api/runs.js';
import type { RunsBridge } from '../shared/api/runs.js';
import { DESKTOP } from './support.js';
import { NO_FIGURES, fakeFigures, fakeRun, setupState } from './engines-usage-fixture.js';

const REPO = join(DESKTOP, '..', '..');
const NOW = { daysAgo: 0, time: '10:00' };
type G = { location?: { hash: string } };
const render = (el: ReactElement): string => renderToStaticMarkup(el);
const none: UsageSource = { kind: 'ready', runs: [], reads: new Map(), total: 0 };
/** The attributes of the element that carries `needle`. */
const tagWith = (html: string, needle: string): string => { const m = new RegExp(`<[a-z0-9]+[^>]*${needle}[^>]*>`).exec(html); assert.ok(m, needle); return m[0]; };

function usageBridge(): RunsBridge {
  const no = async (): Promise<never> => { throw new Error('this screen reads only'); };
  return { listRuns: async () => [], readRunFigures: async () => fakeFigures(), recordRun: no, updateRun: no, startNewRunList: no };
}

function inShell(el: ReactElement, hash: string, state = setupState(), runs: RunsBridge | null = null): string {
  (globalThis as G).location = { hash };
  try {
    const store = createHarnessStore({ initial: state, now: () => NOW, finishRunning: false });
    return render(createElement(HarnessProvider, { store }, createElement(UiProvider, null, createElement(RunsProvider, { runs }, createElement(Shell, { route: { name: 'extension', route: 'engines-usage' } }, el)))));
  } finally { delete (globalThis as G).location; }
}

// ---- the stage

test('each engine is a row with its name as a heading, its state, its config and its usage, and a gap carries no "reported" mark', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'codex', '2026-11-11T09:00:00.000Z')];
  const source: UsageSource = { kind: 'ready', runs, reads: new Map([['run-1', { kind: 'figures', figures: fakeFigures({ inputTokens: 1234 }) }], ['run-2', { kind: 'figures', figures: NO_FIGURES('not-available') }]]), total: 2 };
  const html = render(createElement(EnginesUsageBody, { view: enginesView(setupState(), source) }));
  assert.equal((html.match(/data-engine="/g) ?? []).length, 3);
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) assert.match(html, new RegExp(`<h2[^>]*>${name}</h2>`));
  assert.match(tagWith(html, 'data-engine="opencode"'), /data-state="not-found"/);
  assert.match(html, /aria-label="Engines"/);
  const claude = html.slice(html.indexOf('data-engine="claude-code"'), html.indexOf('data-engine="codex"'));
  assert.match(claude, /data-fact="skills"[^>]*>(?:(?!<\/div>).)*<dd>3<\/dd>/);
  assert.match(claude, /<dd>1,234<\/dd>/);
  assert.match(tagWith(claude, 'data-fact="input"'), /data-reported=""/);
  const codex = html.slice(html.indexOf('data-engine="codex"'), html.indexOf('data-engine="opencode"'));
  assert.doesNotMatch(tagWith(codex, 'data-fact="input"'), /data-reported/);
  assert.match(codex, /<dd>Not read<\/dd>/);
  assert.ok(codex.includes('Figures are not available for this engine.'));
  assert.match(html, /data-connection="tracker"/);
  assert.equal((html.match(/data-secret="set"/g) ?? []).length, 1, 'the one connection of the fixture that holds a secret');
});

test('each way the figures cannot be read has its own line, and none of them draws a number', () => {
  const states: [UsageSource, string][] = [[{ kind: 'sample' }, ENGINES_WORDS.sample], [{ kind: 'no-bridge' }, ENGINES_WORDS.noBridge], [{ kind: 'loading' }, ENGINES_WORDS.loading], [{ kind: 'failed', code: 'STORE_DAMAGED' }, 'Your saved runs file is damaged.']];
  for (const [source, words] of states) {
    const html = render(createElement(EnginesUsageBody, { view: enginesView(setupState(), source) }));
    assert.ok(html.includes(words), source.kind);
    assert.doesNotMatch(html, /data-fact="(?:input|output|time|models|runs)"/, source.kind);
  }
});

test('the notes of the whole view come first, and the list says it can be low when the read stopped early', () => {
  const state = { ...setupState(), real: { couldNotRead: 0, stoppedEarly: true, notes: [], textsCut: 0 } };
  const html = render(createElement(EnginesUsageBody, { view: enginesView(state, none) }));
  assert.ok(html.includes(ENGINES_WORDS.countsLow)); assert.ok(html.indexOf(ENGINES_WORDS.countsLow) < html.indexOf('data-engine="claude-code"'));
});

test('a view with no engine says so, and draws no empty list', () => {
  const html = render(createElement(EnginesUsageBody, { view: enginesView({ ...setupState(), interfaces: [] }, none) }));
  assert.ok(html.includes(ENGINES_WORDS.none)); assert.doesNotMatch(html, /<ul[^>]*aria-label="Engines"/);
});

// ---- the screen, in the three modes

test('the screen of the sample launch says that the sample has no session logs, and shows the config of the sample engines', () => {
  const html = inShell(createElement(EnginesUsage), '#sample/extension/engines-usage', createSampleWorld(NOW), null);
  assert.match(html, /data-screen="engines-usage"/);
  assert.match(html, /<h1[^>]*>Engines and usage<\/h1>/);
  assert.ok(html.includes(ENGINES_WORDS.sample));
  assert.match(html, /data-engine="claude-code"/);
  assert.doesNotMatch(html, /data-fact="input"/);
});

test('the screen on the person\'s own folders with no runs bridge says so, and with a runs bridge says that it is reading', () => {
  const real = setupState();
  assert.ok(inShell(createElement(EnginesUsage), '#app/extension/engines-usage', real, null).includes(ENGINES_WORDS.noBridge));
  const html = inShell(createElement(EnginesUsage), '#app/extension/engines-usage', real, usageBridge());
  assert.ok(html.includes(ENGINES_WORDS.loading)); assert.ok(!html.includes(ENGINES_WORDS.noBridge)); assert.ok(!html.includes(ENGINES_WORDS.sample));
});

test('the screen has one level-one heading and a Read again button for the figures, and no write button', () => {
  const html = inShell(createElement(EnginesUsage), '#app/extension/engines-usage', setupState(), usageBridge());
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.ok(html.includes('Read again'));
  assert.doesNotMatch(html, /Approve a folder|Record a run/);
});

test('mounted from the registry at the generic extension address, the route opens the screen', () => {
  const registry = createScreenRegistry();
  registerBundled(registry, [ENGINES_USAGE_MANIFEST]);
  (globalThis as G).location = { hash: '#sample/extension/engines-usage' };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    const html = render(createElement(HarnessApp, { store, engine: createSampleEngine(), local: null, modules: null, realMode: false, registry } as never));
    assert.match(html, /data-screen="engines-usage"/);
    assert.match(html, /<h1[^>]*>Engines and usage<\/h1>/);
    assert.match(html, /data-engine="codex"/);
  } finally { delete (globalThis as G).location; }
});

test('inside the Modules view the module runs as a page of the view, with its own heading left out', () => {
  assert.equal(typeof embeddedPageOf('engines-usage'), 'function');
  (globalThis as G).location = { hash: '#app/modules/engines-usage' };
  try {
    const store = createHarnessStore({ initial: createSampleWorld(NOW), now: () => NOW, finishRunning: false });
    const listed = [LOCAL_MODELS_MANIFEST, MODULES_MANIFEST, ENGINES_USAGE_MANIFEST];
    const html = render(createElement(HarnessProvider, { store }, createElement(UiProvider, null, createElement(ModulesProvider, { bridge: null, sample: true, real: false, listed }, createElement(Shell, { route: { name: 'modules', id: 'engines-usage' } }, createElement(Modules, { id: 'engines-usage' }))))));
    assert.match(html, /data-module-screen="engines-usage"/);
    assert.match(html, /data-engine="claude-code"/);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, 'the view has the one heading');
  } finally { delete (globalThis as G).location; }
  const own = inShell(createElement(EnginesUsageEmbedded), '#app/modules/engines-usage', setupState(), usageBridge());
  assert.match(own, /data-module-screen="engines-usage"/); assert.doesNotMatch(own, /<h1[\s>]/);
});

// ---- the extension

test('the manifest is bundled, not protected, owns the route engines-usage, and equals the one the sample lists', () => {
  const manifest = JSON.parse(readFileSync(join(DESKTOP, 'extensions', 'engines-usage', 'manifest.json'), 'utf8')) as unknown;
  assert.deepEqual(manifest, { id: 'engines-usage', title: 'Engines and usage', kind: 'ui', routes: ['engines-usage'], protected: false });
  assert.deepEqual(manifest, JSON.parse(JSON.stringify(ENGINES_USAGE_MANIFEST)));
  assert.ok(BUNDLED_IDS.includes('engines-usage'), 'the mount table has a screen for it');
});

test('registerBundled registers the screen of the listed manifest once, and the route then resolves', () => {
  const registry = createScreenRegistry();
  assert.deepEqual(registerBundled(registry, [ENGINES_USAGE_MANIFEST]).map(m => m.id), ['engines-usage']);
  assert.equal(registry.resolve('engines-usage').found, true);
  assert.deepEqual(registerBundled(registry, [ENGINES_USAGE_MANIFEST]).map(m => m.id), ['engines-usage'], 'again changes nothing');
  assert.equal(registry.list().filter(m => m.id === 'engines-usage').length, 1);
});

test('the sample launch lists it, the Modules view lists it as a module, and its address is the generic extension address', async () => {
  const listed = (await createSampleLocal(() => '2026-11-11T10:00:00Z').listExtensions()).extensions;
  assert.ok(listed.some(m => m.id === 'engines-usage'), 'the sample list includes it');
  assert.ok(moduleRows([LOCAL_MODELS_MANIFEST, MODULES_MANIFEST, ENGINES_USAGE_MANIFEST], null).some(r => r.id === 'engines-usage'));
  assert.deepEqual(parseRoute('#app/extension/engines-usage'), { name: 'extension', route: 'engines-usage' });
  assert.equal(formatRoute({ name: 'extension', route: 'engines-usage' }, '#app'), '#app/extension/engines-usage');
  assert.equal((BASE_ROUTES as readonly string[]).includes('engines-usage'), false, 'it is no base route');
});

// ---- what it does not add

test('it adds no call: the lists of every bridge keep their lengths, and the module reads through the two runs calls that exist', () => {
  assert.equal(ENGINE_API_CALLS.length, 39); assert.equal(READER_API_CALLS.length, 3); assert.equal(LOCAL_CALLS.length, 1); assert.equal(RUN_CALLS.length, 5);
  assert.ok(MODULE_CALLS.length >= 4, 'lane 2 has 4 module calls, and a later lane may add some');
  assert.deepEqual([...RUN_BRIDGE_CALLS], ['listRuns', 'recordRun', 'updateRun', 'readRunFigures', 'startNewRunList']);
});

test('it adds no golden file and edits none: no golden file is named for it, and each frozen file is still listed', () => {
  const names = readdirSync(join(REPO, 'packages', 'engine-api', 'golden'));
  for (const frozen of ['base-d4c8a478.json', 'local-calls.json', 'run-calls.json', 'module-calls.json']) assert.ok(names.includes(frozen), frozen);
  assert.deepEqual(names.filter(n => /engine|usage/i.test(n)), [], 'a golden file for this lane would mean a new call');
});

const files = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length + 1), e.name));
const code = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('its files name no bridge, no channel, no Node module and no Electron, and make no request', () => {
  const own = [...files('renderer/harness/engines-usage'), ...files('shared/engines-usage')];
  assert.ok(own.length >= 3, own.join(', '));
  for (const f of own) assert.doesNotMatch(code(f), /bowerloom(?:Real|Engine|Local|Runs|Modules)|bowerloom-[a-z]+:|_CHANNELS|_ARITY|node:|electron|ipcRenderer|\bfetch\(|XMLHttpRequest|WebSocket/, f);
});

test('its files read no clock, draw no random number and make no estimate: a number on the screen is a number that was read', () => {
  for (const f of [...files('renderer/harness/engines-usage'), ...files('shared/engines-usage')]) {
    assert.doesNotMatch(code(f), /Date\.now|new Date\(|Math\.random|performance\.now|setInterval|Math\.round|Math\.floor|Math\.ceil|toFixed|\.\.\.average|estimate/i, f);
  }
});

test('its files call no call that writes: no record, no update and no reset of the run list', () => {
  for (const f of [...files('renderer/harness/engines-usage'), ...files('shared/engines-usage')]) assert.doesNotMatch(code(f), /recordRun|updateRun|startNewRunList|approveModulePlace|revokeModulePlace|\.save[A-Z]|runExport|runImport/, f);
});
