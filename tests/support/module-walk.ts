// The static half of the no-spawn check (review M6 finding 2). Not a test file: tests/no-spawn.test.ts runs it in a child,
//   node --experimental-import-meta-resolve dist/tests/support/module-walk.js <entry>...
// and reads one JSON object from stdout. The flag gives import.meta.resolve its parent argument, so a bare import is
// resolved exactly as Node's ESM loader resolves it (the import condition), and a require() as Node's require does.
//
// Every reachable file is parsed into a syntax tree (rolldown's parser), so a comment is never taken for code and code
// inside a string is never taken for a comment. It reports:
// - builtins: each built-in module a file imports or requires, by name;
// - opaque: each load the walk cannot follow or that reaches native code: a computed import() or require(), and any use
//   of createRequire, process.binding, process._linkedBinding, process.dlopen or process.execve;
// - mentions: raw-text backstop, each file whose text names child_process, or names worker_threads or cluster in quotes.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

export interface Walk { files: string[]; builtins: Record<string, string[]>; opaque: string[]; mentions: Record<string, string[]> }
type Node = { type: string; [key: string]: unknown };
const PROCESS_NATIVE = new Set(['binding', '_linkedBinding', 'dlopen', 'execve']);
const MENTIONS: [string, RegExp][] = [['child_process', /child_process/], ['worker_threads', /['"`](?:node:)?worker_threads['"`]/], ['cluster', /['"`](?:node:)?cluster['"`]/]];

/** Whether Node loads `file` as an ES module: .mjs, or .js under a package.json with "type": "module". */
function isEsm(file: string): boolean {
  if (file.endsWith('.mjs')) return true;
  if (file.endsWith('.cjs')) return false;
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) return (JSON.parse(readFileSync(manifest, 'utf8')) as { type?: string }).type === 'module';
    if (dirname(dir) === dir) return false;
  }
}
const literal = (node: unknown): string | null => {
  const n = node as Node | undefined;
  if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n?.type === 'TemplateLiteral' && (n.expressions as unknown[]).length === 0) return ((n.quasis as { value: { cooked: string } }[])[0]!).value.cooked;
  return null;
};
const identifier = (node: unknown): string | null => { const n = node as Node; return n?.type === 'Identifier' && typeof n.name === 'string' ? n.name : null; };
const propertyName = (node: Node): string | null => node.computed ? literal(node.property) : identifier(node.property);

/** The loads of one file: [specifier, how] pairs, plus what it cannot follow. */
function loadsOf(file: string, text: string, opaque: string[]): [string, 'import' | 'require'][] {
  const ast = parseAst(text, { sourceType: isEsm(file) ? 'module' : 'commonjs' }, file) as unknown as Node, found: [string, 'import' | 'require'][] = [];
  const visit = (node: Node): void => {
    switch (node.type) {
      case 'ImportDeclaration': case 'ExportAllDeclaration': case 'ExportNamedDeclaration':
        if (node.source) found.push([literal(node.source)!, 'import']); break;
      case 'ImportExpression': { const spec = literal(node.source); if (spec === null) opaque.push(`${file}: computed import()`); else found.push([spec, 'import']); break; }
      case 'CallExpression': {
        const callee = node.callee as Node;
        if (identifier(callee) === 'require') {
          const spec = literal((node.arguments as unknown[])[0]); if (spec === null) opaque.push(`${file}: computed require()`); else found.push([spec, 'require']);
        }
        break;
      }
      case 'MemberExpression': {
        const object = node.object, name = propertyName(node);
        if (identifier(object) === 'process' && name !== null && PROCESS_NATIVE.has(name)) opaque.push(`${file}: process.${name}`);
        if (name === 'createRequire') opaque.push(`${file}: createRequire`);
        break;
      }
      case 'Identifier': if (identifier(node) === 'createRequire') opaque.push(`${file}: createRequire`); break;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object' && typeof (child as Node).type === 'string') visit(child as Node); }
      else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') visit(value as Node);
    }
  };
  visit(ast);
  return found;
}

/** Resolves as Node would: an import with the import condition, a require with the require condition. */
function target(spec: string, how: 'import' | 'require', from: string): string {
  if (how === 'require') return createRequire(from).resolve(spec);
  const url = (import.meta.resolve as (s: string, parent: string) => string)(spec, pathToFileURL(from).href);
  const path = fileURLToPath(url);
  if (!existsSync(path) || statSync(path).isDirectory()) throw new Error(`${from} imports ${spec}, which resolves to ${path}`);
  return path;
}

export function walk(entries: readonly string[]): Walk {
  const files = new Set<string>(), builtins: Record<string, string[]> = {}, opaque: string[] = [], mentions: Record<string, string[]> = {};
  const queue = entries.map(e => resolve(e));
  while (queue.length) {
    const file = queue.pop()!; if (files.has(file)) continue; files.add(file);
    if (file.endsWith('.json')) continue;
    const text = readFileSync(file, 'utf8');
    for (const [name, pattern] of MENTIONS) if (pattern.test(text)) (mentions[name] ??= []).push(file);
    for (const [spec, how] of loadsOf(file, text, opaque)) {
      if (isBuiltin(spec)) { (builtins[spec.replace(/^node:/, '')] ??= []).push(file); continue; }
      queue.push(target(spec, how, file));
    }
  }
  return { files: [...files].sort(), builtins, opaque, mentions };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(`${JSON.stringify(walk(process.argv.slice(2)))}\n`);
}
