// Client purity (v0.9, lane L4d). A screen of the renderer reaches the engine only through the engine API client. This reads every source file of renderer/ and fails on a forbidden
// import or call. The allowances below are the whole list of exceptions, each with its reason, and a test fails when one stops being needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';
import { plainJs, importsOf, tokenize } from './fixtures-real/static-check.js';
import { PURE_SHARED, RESTRICTIONS, applyAllowances, problemsOfRenderer, resolveSpecifier, specifiersOf } from './helpers-engine/client-purity.js';
import type { Allowance, Problem } from './helpers-engine/client-purity.js';

/** Every exception, one per line of reason. None is for a bridge, a channel, a file or the network: those have no exception. */
const ALLOWANCES: readonly Allowance[] = Object.freeze([
  { file: 'renderer/api/transport.ts', rule: 'bridge-name', detail: /bowerloom(?:Real|Engine|Local)/, why: 'The transport is the one file that reads the three bridges from the window by name. The client checks what it finds.' },
  { file: 'renderer/harness/real/Nothing.tsx', rule: 'side-channel', detail: /window\.close/, why: 'The screen of a window with no bridge has no engine call to use. It asks the window to close, and the close guard of main still runs on the unload.' },
  { file: 'renderer/harness/close-guard.ts', rule: 'side-channel', detail: /page title/, why: 'Owner decision Q1A: main reads the count of unsaved changes from the page title. No engine call carries it, and a new call changes the frozen contract, which is a decision for the maintainer.' },
  { file: 'renderer/harness/close-guard.ts', rule: 'side-channel', detail: /beforeunload/, why: 'Owner decision Q1A: the page holds its own unload while a folder has unsaved changes, and main asks the question in its own box.' },
]);

const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.(?:ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [`${dir}/${e.name}`] : []));

function readRenderer(): { files: string[]; raw: Record<string, string>; js: Record<string, string>; problems: Problem[] } {
  const files = sourcesUnder('renderer').sort();
  const raw = Object.fromEntries(files.map(f => [f, readFileSync(join(DESKTOP, f), 'utf8')]));
  const out = plainJs(raw, DESKTOP);
  const js: Record<string, string> = {}, problems: Problem[] = [];
  for (const f of files) {
    const one = out[f];
    if (one === undefined || one.js === undefined) { problems.push({ file: f, rule: 'network-or-eval', text: `does not parse: ${one?.error ?? 'no result'}` }); continue; }
    js[f] = one.js;
    problems.push(...problemsOfRenderer(f, raw[f]!, one.js));
  }
  return { files, raw, js, problems };
}

const checked = readRenderer();

test('no file of the renderer imports an engine, Node, Electron or a bridge, or calls a file, a process or the network, beyond the listed allowances', () => {
  const { open } = applyAllowances(checked.problems, ALLOWANCES);
  assert.deepEqual(open.map(p => `${p.file}: [${p.rule}] ${p.text}`), []);
});

test('every allowance is still needed and has a reason: an allowance that covers nothing is removed', () => {
  const { used } = applyAllowances(checked.problems, ALLOWANCES);
  for (const [allowance, count] of used) {
    assert.ok(count > 0, `${allowance.file} [${allowance.rule}] ${allowance.detail} covers nothing now`);
    assert.ok(allowance.why.length >= 40, `${allowance.file} needs a reason`);
  }
  assert.equal(new Set(ALLOWANCES.map(a => `${a.file}|${a.rule}|${a.detail}`)).size, ALLOWANCES.length, 'no allowance twice');
  for (const allowance of ALLOWANCES) assert.ok(allowance.file in checked.raw, `${allowance.file} is a renderer file`);
});

test('the check reads the whole renderer: the screens, the sheets, the client and the page entry are all in it', () => {
  assert.ok(checked.files.length >= 120, `${checked.files.length} files`);
  for (const f of ['renderer/app.ts', 'renderer/harness/mount.tsx', 'renderer/harness/HarnessApp.tsx', 'renderer/harness/extension-mounts.tsx', 'renderer/harness/engine.tsx', 'renderer/harness/sheets/SaveSheet.tsx', 'renderer/harness/screens/Builder.tsx', 'renderer/harness/real/RealChoose.tsx', 'renderer/api/client.ts', 'renderer/api/transport.ts']) assert.ok(checked.files.includes(f), `${f} is read`);
  assert.equal(Object.keys(checked.js).length, checked.files.length, 'every file was read as JavaScript');
});

test('the import scan of raw text finds every import that esbuild finds, so a type import cannot hide a dependency', () => {
  for (const f of checked.files) {
    const mine = new Set(specifiersOf(checked.raw[f]!));
    // esbuild adds the JSX runtime import itself, so it has no line in the source.
    for (const imp of importsOf(tokenize(checked.js[f]!)).filter(i => i.from !== 'react/jsx-runtime')) assert.ok(mine.has(imp.from), `${f}: ${imp.from} is in the plain JavaScript and not in the raw scan`);
  }
});

test('the client is the one source of the engine: the transport is imported by the client alone, the sample engine by the client alone, and the client is made once by the page entry', () => {
  const importers = (module: string): string[] => checked.files.filter(f => specifiersOf(checked.raw[f]!).some(s => resolveSpecifier(f, s) === module));
  assert.deepEqual(importers('renderer/api/transport'), ['renderer/api/client.ts']);
  assert.deepEqual(importers('shared/engine/sample'), ['renderer/api/client.ts']);
  assert.deepEqual(importers('shared/engine/sample-switch'), ['renderer/api/transport.ts']);
  assert.deepEqual(RESTRICTIONS.map(r => r.module), ['renderer/api/transport', 'shared/engine/sample', 'shared/engine/sample-switch', 'shared/api/local', 'renderer/api/client']);
});

test('the bowerloomLocal bridge is reached through the client alone: the client alone imports its call list, and no renderer file imports its channel table', () => {
  const importers = checked.files.filter(f => specifiersOf(checked.raw[f]!).some(s => resolveSpecifier(f, s) === 'shared/api/local'));
  assert.deepEqual(importers, ['renderer/api/client.ts']);
  assert.doesNotMatch(checked.js['renderer/api/client.ts']!, /LOCAL_CHANNELS/, 'the client holds no channel name');
});

test('the renderer imports from shared/engine and shared/real only the modules on the pure list', () => {
  const seen = new Set<string>();
  for (const f of checked.files) for (const spec of specifiersOf(checked.raw[f]!)) {
    const target = resolveSpecifier(f, spec);
    if (target !== null && (target.startsWith('shared/engine/') || target.startsWith('shared/real/'))) seen.add(target);
  }
  const pure = new Set(Object.keys(PURE_SHARED));
  for (const target of seen) assert.ok(pure.has(target) || RESTRICTIONS.some(r => r.module === target), `${target} is not on the pure list`);
  for (const target of pure) assert.ok(seen.has(target), `${target} is on the pure list and no renderer file imports it`);
  assert.ok(Object.values(PURE_SHARED).every(why => why.length > 10));
});

// ---- the checker, shown to fail on bad files

const problemsOf = (file: string, raw: string): string[] => {
  const out = plainJs({ [file]: raw }, DESKTOP)[file]!;
  assert.equal(out.error, undefined, out.error);
  return applyAllowances(problemsOfRenderer(file, raw, out.js!), []).open.map(p => `[${p.rule}] ${p.text}`);
};

test('the checker passes a clean screen, and ignores a banned word in a comment or in ordinary text', () => {
  const clean = "import { useState } from 'react';\nimport type { EngineBridge } from '../../shared/engine/types.js';\nimport { engineCodeOf } from '../api/client.js';\n// fetch(x) window.bowerloomEngine ipcRenderer\nexport const f = (e: EngineBridge | null): string => (e === null ? 'No engine. Fetch it later.' : engineCodeOf(useState));\n";
  assert.deepEqual(problemsOf('renderer/harness/Clean.tsx', clean), []);
});

test('the checker rejects each way a screen could bypass the client', () => {
  const bad: Record<string, [string, string, RegExp]> = {
    nodeImport: ['renderer/harness/A.tsx', "import { readFileSync } from 'node:fs';\nexport const a = readFileSync;\n", /\[bare-import\] imports node:fs/],
    electronImport: ['renderer/harness/A.tsx', "import { ipcRenderer } from 'electron';\nexport const a = 1; export { ipcRenderer };\n", /\[bare-import\] imports electron/],
    mainImport: ['renderer/harness/A.tsx', "import { registerEngineIpc } from '../../main/engine-ipc.js';\nexport { registerEngineIpc };\n", /\[outside-import\] imports \.\.\/\.\.\/main\/engine-ipc\.js/],
    typeFromMain: ['renderer/harness/A.tsx', "import type { Engine } from '../../main/engine-service.js';\nexport type X = Engine;\n", /\[outside-import\] imports \.\.\/\.\.\/main\/engine-service\.js/],
    packageImport: ['renderer/harness/A.tsx', "export { save } from '../../../../packages/project-sync/src/index.js';\n", /\[outside-import\]/],
    sampleEngine: ['renderer/harness/A.tsx', "import { createSampleEngine } from '../../shared/engine/sample.js';\nexport const a = createSampleEngine;\n", /\[engine-implementation\]|\[client-only\] imports shared\/engine\/sample/],
    sharedEngineFile: ['renderer/harness/A.tsx', "import { runAdoptionNow } from '../../shared/engine/scrub.js';\nexport { runAdoptionNow };\n", /\[engine-implementation\] imports shared\/engine\/scrub/],
    transport: ['renderer/harness/A.tsx', "import { pageTransport } from '../api/transport.js';\nexport const a = pageTransport();\n", /\[client-only\] imports renderer\/api\/transport/],
    makeClient: ['renderer/harness/sheets/A.tsx', "import { getApiClient } from '../../api/client.js';\nexport const a = getApiClient();\n", /\[client-only\] imports getApiClient from renderer\/api\/client/],
    bridgeName: ['renderer/harness/A.tsx', "export const a = (window as unknown as { bowerloomEngine: unknown }).bowerloomEngine;\n", /\[bridge-name\] names bowerloomEngine/],
    bridgeProperty: ['renderer/harness/A.tsx', "export const a = window.bowerloomFuture;\n", /\[bridge-name\] reads window\.bowerloomFuture/],
    bridgeOptional: ['renderer/harness/A.tsx', "export const a = globalThis?.bowerloomX;\n", /\[bridge-name\] reads globalThis\.bowerloomX/],
    bridgeString: ['renderer/harness/A.tsx', "export const a = (window as never)['bowerloomReal'];\n", /\[bridge-name\] has the text "bowerloomReal"/],
    localBridgeName: ['renderer/harness/A.tsx', "export const a = (window as unknown as { bowerloomLocal: unknown }).bowerloomLocal;\n", /\[bridge-name\] names bowerloomLocal/],
    localBridgeProperty: ['renderer/harness/A.tsx', "export const a = globalThis.bowerloomLocal;\n", /\[bridge-name\] reads globalThis\.bowerloomLocal/],
    localBridgeString: ['renderer/harness/A.tsx', "export const a = (window as never)['bowerloomLocal'];\n", /\[bridge-name\] has the text "bowerloomLocal"/],
    localChannel: ['renderer/harness/A.tsx', "export const a = 'bowerloom-local:localModels';\n", /\[bridge-name\] has the text "bowerloom-local:localModels"/],
    localChannelTable: ['renderer/harness/A.tsx', "import { LOCAL_CHANNELS } from '../../shared/api/local.js';\nexport const a = LOCAL_CHANNELS;\n", /\[client-only\] imports LOCAL_CHANNELS from shared\/api\/local/],
    channel: ['renderer/harness/A.tsx', "export const a = 'bowerloom-engine:run-save';\n", /\[bridge-name\] has the text "bowerloom-engine:run-save"/],
    ipc: ['renderer/harness/A.tsx', "export const a = (x: { ipcRenderer: { invoke(c: string): void } }) => x.ipcRenderer.invoke('c');\nexport const b = ipcRenderer;\n", /\[ipc-name\] uses ipcRenderer/],
    windowElectron: ['renderer/harness/A.tsx', "export const a = window.electron;\n", /\[ipc-name\] reads window\.electron/],
    require: ['renderer/harness/A.tsx', "export const a = require('fs');\n", /\[ipc-name\] uses require/],
    fileCall: ['renderer/harness/A.tsx', "declare const fs: { readFileSync(p: string): string };\nexport const a = fs.readFileSync('/x');\n", /\[file-or-process-call\] calls readFileSync/],
    fetchCall: ['renderer/harness/A.tsx', "export const a = fetch('/x');\n", /\[network-or-eval\] uses fetch/],
    windowFetch: ['renderer/harness/A.tsx', "export const a = window.fetch('/x');\n", /\[network-or-eval\] uses fetch/],
    dynamicImport: ['renderer/harness/A.tsx', "export const a = import('node:fs');\n", /\[network-or-eval\] uses a dynamic import/],
    windowClose: ['renderer/harness/A.tsx', "export const a = (): void => window.close();\n", /\[side-channel\] calls window\.close/],
    title: ['renderer/harness/A.tsx', "export const a = (d: { title: string }): void => { d.title = 'x'; };\n", /\[side-channel\] sets the page title/],
    beforeunload: ['renderer/harness/A.tsx', "export const a = (): void => window.addEventListener('beforeunload', () => undefined);\n", /\[side-channel\] listens for beforeunload/],
  };
  for (const [name, [file, text, pattern]] of Object.entries(bad)) {
    const found = problemsOf(file, text);
    assert.ok(found.some(line => pattern.test(line)), `${name} is not rejected as expected: ${JSON.stringify(found)}`);
  }
});

test('the checker lets the client make the pieces it is meant to make', () => {
  assert.deepEqual(problemsOf('renderer/api/client.ts', "import { pageTransport } from './transport.js';\nimport { createSampleEngine } from '../../shared/engine/sample.js';\nexport const a = [pageTransport, createSampleEngine];\n"), []);
  assert.deepEqual(problemsOf('renderer/api/client.ts', "import { LOCAL_CALLS } from '../../shared/api/local.js';\nimport type { LocalBridge } from '../../shared/api/local.js';\nexport const a = (b: LocalBridge): readonly string[] => LOCAL_CALLS.map(c => typeof b[c]);\n"), []);
  assert.deepEqual(problemsOf('renderer/harness/mount.tsx', "import { getApiClient } from '../api/client.js';\nexport const a = getApiClient;\n"), []);
});

test('an allowance covers only its own file, rule and words', () => {
  const problem: Problem = { file: 'renderer/harness/A.tsx', rule: 'side-channel', text: 'calls window.close, which asks main to close the window' };
  const allowance: Allowance = { file: 'renderer/harness/B.tsx', rule: 'side-channel', detail: /window\.close/, why: 'x'.repeat(40) };
  assert.equal(applyAllowances([problem], [allowance]).open.length, 1, 'another file');
  assert.equal(applyAllowances([problem], [{ ...allowance, file: problem.file, rule: 'bridge-name' }]).open.length, 1, 'another rule');
  assert.equal(applyAllowances([problem], [{ ...allowance, file: problem.file, detail: /title/ }]).open.length, 1, 'other words');
  assert.equal(applyAllowances([problem], [{ ...allowance, file: problem.file }]).open.length, 0, 'its own');
});
