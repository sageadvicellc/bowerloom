// Helpers shared by the tests of this package. Not a test file.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The text of a fixture of llama-server, such as `example-9b/props.json`. */
export const fixture = name => fs.readFileSync(fileURLToPath(new URL(`./fixtures/llama-server/${name}`, import.meta.url)), 'utf8');

export const ok = (body, status = 200) => ({ ok: true, status, body: typeof body === 'string' ? body : JSON.stringify(body) });
export const failed = code => ({ ok: false, code });

/** The five paths of llama-server, as they answer for one recorded server. */
export function recorded(dir) {
  return { '/health': ok(fixture(`${dir}/health.json`)), '/props': ok(fixture(`${dir}/props.json`)), '/slots': ok(fixture(`${dir}/slots-idle.json`)), '/metrics': ok(fixture(`${dir}/metrics.txt`)), '/v1/models': ok(fixture(`${dir}/models.json`)) };
}

/** A `get` that answers from a table. A path that is not in the table answers 404. Every path asked for is kept in `calls`. */
export function fakeGet(table) {
  const calls = [];
  const get = async path => { calls.push(path); return Object.hasOwn(table, path) ? table[path] : ok('not found', 404); };
  get.calls = calls;
  return get;
}

/** A `get` that fails every path with one code. */
export const failAll = code => fakeGet(Object.fromEntries(['/health', '/props', '/slots', '/metrics', '/v1/models'].map(p => [p, failed(code)])));
