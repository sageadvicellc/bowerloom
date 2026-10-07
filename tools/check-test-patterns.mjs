#!/usr/bin/env node
// `node --test` exits 0 when a listed pattern matches nothing, so an empty or missing test folder passes silently.
// This check reads every `node --test` pattern in the test and test:* scripts and fails when one matches no file.
// A wildcard is supported in the file name only. Any other pattern shape is refused, not guessed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GLOB = /[*?[\]{}]/;

/** Lists the `node --test` file patterns of each test script, in script order. Flags are skipped. */
export function testPatterns(scripts) {
  const found = [];
  for (const [script, command] of Object.entries(scripts)) {
    if (script !== 'test' && !script.startsWith('test:')) continue;
    for (const segment of String(command).split('&&')) {
      const words = segment.trim().split(/\s+/);
      if (words[0] !== 'node' || words[1] !== '--test') continue;
      for (const word of words.slice(2)) if (!word.startsWith('-')) found.push({ script, pattern: word });
    }
  }
  return found;
}

function matches(root, pattern) {
  const directory = path.posix.dirname(pattern), name = path.posix.basename(pattern);
  if (GLOB.test(directory) || /[[\]{}]/.test(name)) throw new Error(`unsupported test pattern: ${pattern}`);
  const at = path.join(root, directory);
  const isFile = entry => { try { return fs.statSync(path.join(at, entry)).isFile(); } catch { return false; } };
  if (!GLOB.test(name)) return isFile(name);
  const expression = new RegExp('^' + name.split('').map(c => c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^$()|\\]/g, '\\$&')).join('') + '$');
  let entries; try { entries = fs.readdirSync(at); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
  return entries.some(entry => expression.test(entry) && isFile(entry));
}

/** Returns each test pattern that matches no file under root. */
export function emptyTestPatterns(scripts, root) {
  return testPatterns(scripts).filter(({ pattern }) => !matches(root, pattern));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const root = process.cwd();
  const { scripts = {} } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const empty = emptyTestPatterns(scripts, root);
  if (empty.length) {
    process.stderr.write('Test patterns that match no test file:\n' + empty.map(({ script, pattern }) => `  ${script}: ${pattern}\n`).join(''));
    process.exitCode = 1;
  }
}
