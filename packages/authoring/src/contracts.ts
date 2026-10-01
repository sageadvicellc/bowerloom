import { Ajv } from 'ajv';
import { parseDocument } from 'yaml';
import { DefinitionError } from '../../contracts/src/index.js';
import { copyJson } from '../../graph/src/validation.js';

export const FORMATS = Object.freeze({
  authoring: 'trellis/authoring/v0.7-alpha', skill: 'trellis/skill/v0.7-alpha',
  relay: 'trellis/relay-map/v0.7-alpha', vines: 'trellis/vines-map/v0.7-alpha',
  scenario: 'trellis/workbench-scenario/v0.7-alpha', bundle: 'trellis/authored-crew/v0.7-alpha',
} as const);
export const AUTHORING_LIMITS = Object.freeze({ jsonBytes: 32768, assetBytes: 65536, sourceBytes: 524288, bundleBytes: 1048576 });
export interface AuthoringManifest {
  format: typeof FORMATS.authoring; id: string; crew: string; classification: 'synthetic';
  brief: string; skills: string[]; relay: string; vines: string; scenario: string;
}
export interface SkillDefinition {
  format: typeof FORMATS.skill; id: string; instructions: string; owners: string[];
  requiredCapabilities: ('workspace.write' | 'command.test' | 'approval.exact-revision')[];
}
export interface RelayRoute {
  fromOwner: string; fromTask: string; toOwner: string; toTask: string;
  delivery: 'accepted-output'; bindings: { output: string; input: string }[];
}
export interface RelayMap { format: typeof FORMATS.relay; participants: string[]; routes: RelayRoute[] }
export const EVIDENCE = ['runtime.status', 'workspace.receipt', 'test.acceptance'] as const;
export interface VinesMap {
  format: typeof FORMATS.vines; purpose: 'logging-only';
  entries: { task: string; owner: string; evidence: typeof EVIDENCE[number][]; sink: 'local-session' }[];
}
export interface Scenario {
  format: typeof FORMATS.scenario; id: string; revision: string; classification: 'synthetic';
  brief: { asset: string; digest: string; bytes: number };
  inputs: { asset: string; digest: string; bytes: number }[];
  testId: 'craft-shop-ui-v1'; criteria: ['add-job', 'change-stage', 'reload', 'export'];
  taskCount: 2; writePaths: ['output/design/index.html', 'output/job-board/index.html'];
}
const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$', not: { enum: ['constructor', 'prototype', '__proto__'] } };
const object = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: object, minItems = 0, maxItems = 32) => ({ type: 'array', items, minItems, maxItems, uniqueItems: true });
const pin = object({ asset: id, digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, bytes: { type: 'integer', minimum: 1, maximum: AUTHORING_LIMITS.assetBytes } });
export const schemas = Object.freeze({
  authoring: object({ format: { const: FORMATS.authoring }, id, crew: { type: 'string', minLength: 1, maxLength: 240 }, classification: { const: 'synthetic' },
    brief: id, skills: array(id, 1), relay: id, vines: id, scenario: id }),
  skill: object({ format: { const: FORMATS.skill }, id, instructions: id, owners: array(id, 1),
    requiredCapabilities: array({ enum: ['workspace.write', 'command.test', 'approval.exact-revision'] }, 0, 3) }),
  relay: object({ format: { const: FORMATS.relay }, participants: array(id, 1), routes: array(object({
    fromOwner: id, fromTask: id, toOwner: id, toTask: id, delivery: { const: 'accepted-output' },
    bindings: array(object({ output: id, input: id }), 0, 64),
  }), 0, 128) }),
  vines: object({ format: { const: FORMATS.vines }, purpose: { const: 'logging-only' }, entries: array(object({
    task: id, owner: id, evidence: array({ enum: EVIDENCE }, 3, 3), sink: { const: 'local-session' },
  }), 1) }),
  scenario: object({ format: { const: FORMATS.scenario }, id, revision: id, classification: { const: 'synthetic' }, brief: pin,
    inputs: array(pin, 1), testId: { const: 'craft-shop-ui-v1' }, criteria: { const: ['add-job', 'change-stage', 'reload', 'export'] },
    taskCount: { const: 2 }, writePaths: { const: ['output/design/index.html', 'output/job-board/index.html'] } }),
});
const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true });
const checks = Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]));
export function fail(code: string): never { throw new DefinitionError(code, 'The portable authoring contract was refused. No execution was requested.'); }
/** JSON syntax plus duplicate-key checking. Plain-value traversal precedes YAML parsing to bound depth and nodes. */
export function parseJson(source: string): unknown {
  if (typeof source !== 'string' || Buffer.byteLength(source) > AUTHORING_LIMITS.jsonBytes) fail('AUTHORING_LIMIT');
  let value: unknown;
  try { value = copyJson(JSON.parse(source), AUTHORING_LIMITS.jsonBytes); } catch { fail('AUTHORING_JSON'); }
  const doc = parseDocument(source, { strict: true, uniqueKeys: true, schema: 'core', merge: false, prettyErrors: false });
  if (doc.errors.length || doc.warnings.length) fail('AUTHORING_JSON');
  return value;
}
export function checked<T>(kind: keyof typeof schemas, value: unknown): T {
  const copy = copyJson(value, AUTHORING_LIMITS.jsonBytes);
  if (!checks[kind]!(copy)) fail(`AUTHORING_${kind.toUpperCase()}_SCHEMA`);
  return copy as T;
}
export const parseScenario = (bytes: string): Scenario => checked<Scenario>('scenario', parseJson(bytes));
