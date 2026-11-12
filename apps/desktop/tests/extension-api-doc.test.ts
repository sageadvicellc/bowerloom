// The extension API page (docs/v0.9/extension-api.md) lists every error code, every manifest field, every kit command and every file it names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_CODES } from '../shared/extensions/types.js';
import { SKIP_CODES } from '../main/extension-loader.js';
import { READER_REFUSALS, ENGINE_REFUSALS } from '../shared/api/calls.js';
import { LOCAL_REFUSAL_CODES } from '../shared/api/local.js';
import { RUN_REFUSAL_CODES } from '../shared/api/runs.js';
import { DESKTOP } from './support.js';

const REPO = join(DESKTOP, '..', '..');
const DOC = join(REPO, 'docs', 'v0.9', 'extension-api.md');
const doc = readFileSync(DOC, 'utf8');

/** The text of one `## ` section, from its heading to the next one. */
function section(title: string): string {
  const start = doc.indexOf(`\n## ${title}\n`);
  assert.notEqual(start, -1, `the page has a section "${title}"`);
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, next === -1 ? doc.length : next);
}

test('the error code section lists every code of the extension mechanism, the loader, the route, the four client sides and the kit, each once', async () => {
  const kit = (await import(pathToFileURL(join(REPO, 'tools', 'lib', 'extension-kit.mjs')).href)) as { KIT_CODES: readonly string[]; KIT_WARNINGS: readonly string[] };
  const text = section('Error codes');
  const listed = [...text.matchAll(/^- `([A-Z][A-Z0-9_]+)`/gm)].map(m => m[1]!);
  const wanted = new Set<string>([...EXTENSION_CODES, ...SKIP_CODES, 'ROUTE_NOT_FOUND', ...READER_REFUSALS, 'NO_BRIDGE', ...ENGINE_REFUSALS, ...LOCAL_REFUSAL_CODES, ...RUN_REFUSAL_CODES, ...kit.KIT_CODES, ...kit.KIT_WARNINGS]);
  for (const code of wanted) assert.ok(text.includes(`\`${code}\``), `${code} is listed`);
  assert.deepEqual([...new Set(listed)].filter(code => !wanted.has(code)), [], 'the page lists no code that no source holds');
  // A code that two groups share (NOT_ALLOWED, BAD_ARGUMENT, FAILED, BAD_MANIFEST) is a line of its own for each group, so a reader finds it where they look.
  assert.ok(listed.length >= wanted.size, `${listed.length} lines for ${wanted.size} distinct codes`);
});

test('every code line says what the code means and where it comes from: a sentence of at least four words', () => {
  const lines = [...section('Error codes').matchAll(/^- `([A-Z][A-Z0-9_]+)`(.*)$/gm)];
  assert.ok(lines.length > 30);
  for (const [line, code, rest] of lines) assert.ok(rest!.trim().split(/\s+/).length >= 4, `${code}: ${line}`);
});

test('the manifest section names every field, the limits, and the five fields of the manifest and no other', () => {
  const text = section('The manifest');
  for (const field of ['id', 'title', 'kind', 'routes', 'protected']) assert.match(text, new RegExp(`\`${field}\``), field);
  for (const limit of ['64', '120', '64 KiB']) assert.ok(text.includes(limit), limit);
  assert.match(text, /dropped/i);
});

test('the page describes the kit commands and the files of the template, and each file it names exists', () => {
  const text = doc;
  for (const command of ['new', 'check', 'install-template', 'remove', 'list']) assert.match(text, new RegExp(`extension-kit\\.mjs ${command}\\b`), command);
  const files = [...text.matchAll(/`((?:apps|tools|docs|packages)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|md|json))`/g)].map(m => m[1]!);
  assert.ok(files.length >= 10, `${files.length} files named`);
  for (const file of new Set(files)) assert.ok(existsSync(join(REPO, file)), `${file} exists`);
  assert.ok(existsSync(join(DESKTOP, 'extension-template', 'manifest.json')));
});

test('the page covers the five topics of the lane: the manifest, what a screen reads, how a read is approved, install and remove, and the error codes', () => {
  for (const title of ['The manifest', 'What a screen reads', 'How reads and writes are approved', 'Install and remove', 'Error codes', 'Make an extension']) section(title);
});

test('the page says that only stock extensions load, and that no manifest field loads code', () => {
  assert.match(doc, /stock extensions? only|only stock extensions?/i);
  assert.match(doc, /no field .*code|carries no code/i);
});

test('the page follows the house style: no semicolon or em-dash in the prose, and none of the words should, may and might', () => {
  const prose = doc.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  assert.doesNotMatch(prose, /;/);
  assert.doesNotMatch(prose, /—/);
  assert.doesNotMatch(prose, /\b(?:should|may|might)\b/i);
});

test('the approval section says that the engine side includes write calls, that the sender check does not tell one extension from another, and that no extension is limited in this lane', () => {
  const text = section('How reads and writes are approved');
  assert.match(text, /write calls/i);
  assert.match(text, /adopt, install and save/);
  assert.match(text, /does not tell one extension from another/);
  assert.match(text, /no extension is limited/i);
});

test('the page says where the kit is stricter than the app, and does not claim that every kit code means what the app code means', () => {
  assert.match(doc, /stricter than the app/);
  assert.doesNotMatch(doc, /same meaning/);
});
