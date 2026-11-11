// A static read of the package source: the one place that opens a connection, the one host, and the things the package must never do.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } })(src);
const rel = f => path.relative(src, f).split(path.sep).join('/');
/** The code of a file without block comments and whole-line comments. */
const code = f => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = name => code(path.join(src, name));
const imports = text => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

test('the scan reads the real source: at least 10 files, with the files the plan names', () => {
  assert.ok(files.length >= 10, String(files.length));
  for (const name of ['guard.ts', 'http.ts', 'prometheus.ts', 'provider.ts', 'providers.ts', 'providers/llama-server.ts', 'config.ts', 'cache.ts', 'report.ts', 'index.ts', 'types.ts', 'text.ts']) assert.ok(files.map(rel).includes(name), name);
});

test('only http.ts loads the http module, and no file loads another way to reach a network or start a program', () => {
  const banned = /^(?:node:)?(?:https|http2|net|tls|dgram|dns|dns\/promises|child_process|worker_threads|cluster|vm|inspector|repl|module|process)$/;
  for (const f of files) {
    for (const spec of imports(code(f))) {
      assert.ok(!banned.test(spec), `${rel(f)} loads ${spec}`);
      if (/^(?:node:)?http$/.test(spec)) assert.equal(rel(f), 'http.ts', `${rel(f)} loads http`);
    }
  }
});

test('http.ts makes exactly one connection call, and its host is the constant of the guard', () => {
  const text = read('http.ts');
  assert.equal((text.match(/\brequest\s*\(/g) ?? []).length, 1);
  assert.match(text, /host:\s*LOOPBACK_HOST\b/);
  assert.equal((text.match(/\bhost\s*:/g) ?? []).length, 1, 'one host key');
  assert.ok(!/\bget\s*\(\s*(?:\w+\s*,\s*)?host/i.test(text));
  assert.match(text, /export function createGet\(port: number, options: GetOptions = \{\}\): BoundGet/, 'the helper takes a port and options, no host');
  assert.match(fs.readFileSync(path.join(src, 'provider.ts'), 'utf8'), /export type BoundGet = \(path: string\) => Promise<GetResult>;/, 'a provider gets a path only');
});

test('no file reads fetch, a socket, a web socket, eval, a dynamic import, require, or the process', () => {
  for (const f of files) {
    const text = code(f);
    for (const [name, pattern] of [['fetch', /\bfetch\s*\(/], ['XMLHttpRequest', /\bXMLHttpRequest\b/], ['WebSocket', /\bWebSocket\b/], ['eval', /\beval\s*\(/], ['new Function', /\bnew\s+Function\b/], ['dynamic import', /\bimport\s*\(/], ['require', /\brequire\s*\(/], ['process', /\bprocess\s*\./], ['globalThis', /\bglobalThis\b/], ['createConnection', /\.connect\s*\(|createConnection/]]) {
      assert.ok(!pattern.test(text), `${rel(f)} uses ${name}`);
    }
  }
});

test('a number of the form a.b.c.d appears only in the guard, and the only address in it is 127.0.0.1', () => {
  for (const f of files) {
    const found = code(f).match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];
    if (rel(f) === 'guard.ts') assert.deepEqual([...new Set(found)], ['127.0.0.1']);
    else assert.deepEqual(found, [], rel(f));
  }
});

test('the package imports no Electron, no page code, no other package, and nothing outside its own src', () => {
  for (const f of files) {
    for (const spec of imports(code(f))) {
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel(f)} loads ${spec}`);
      const target = path.resolve(path.dirname(f), spec);
      assert.ok(target.startsWith(src + path.sep), `${rel(f)} reaches outside src: ${spec}`);
    }
  }
});

test('the parsers and providers load no Node module at all, and only config.ts reads files', () => {
  for (const f of files) {
    const name = rel(f);
    const node = imports(code(f)).filter(spec => spec.startsWith('node:'));
    if (name === 'http.ts') assert.deepEqual(node, ['node:http']);
    else if (name === 'config.ts') assert.deepEqual([...node].sort(), ['node:fs', 'node:path']);
    else assert.deepEqual(node, [], name);
  }
});

test('nothing is written: no call that writes, appends, makes a folder, a stream or a link', () => {
  for (const f of files) assert.ok(!/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|createWriteStream|symlink|rename|unlink|rmSync|copyFile)\b/.test(code(f)), rel(f));
});
