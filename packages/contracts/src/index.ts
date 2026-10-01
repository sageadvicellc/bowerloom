import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';

export const CREW_FORMAT = 'trellis/crew/v0.7-alpha' as const;
export const PLAN_FORMAT = 'trellis/plan/v0.7-alpha' as const;
export const COMPILER_VERSION = '0.7.0-alpha.0';
export const CAPABILITIES = ['workspace.read', 'workspace.write', 'command.test', 'approval.exact-revision'] as const;
export type Capability = typeof CAPABILITIES[number];
export type DataType =
  | { kind: 'string' | 'number' | 'integer' | 'boolean' }
  | { kind: 'array'; items: DataType }
  | { kind: 'record'; fields: Record<string, DataType> }
  | { kind: 'artifact'; mediaType: string };
export type Effect =
  | { operation: 'workspace.read' | 'workspace.write'; path: string }
  | { operation: 'command.test'; command: string };
export interface Asset { path: string; mediaType: string }
export interface Owner {
  id: string;
  role: string;
  prompt: string;
  skills: string[];
  modelClass: 'economy' | 'standard' | 'reasoning';
  permissions: Effect[];
}
export interface Task {
  id: string;
  owner: string;
  description: string;
  dependsOn: string[];
  requires: Capability[];
  inputs: Record<string, { type: DataType; source: { asset: string } | { task: string; output: string } }>;
  outputs: Record<string, DataType>;
  effects: Effect[];
  approval: 'required' | 'none';
  policy: { maxAttempts: number; timeoutSeconds: number; deadlineSeconds: number; backoffSeconds: number; onFailure: 'escalate' };
  acceptance: string[];
}
export interface CrewDefinition {
  format: typeof CREW_FORMAT;
  id: string;
  description: string;
  requiredCapabilities: Capability[];
  budget: { maxActiveWorkers: number; reservePercent: number; paidFallback: false };
  scope: Effect[];
  assets: Record<string, Asset>;
  owners: Owner[];
  tasks: Task[];
}
export interface PinnedAsset extends Asset { bytes: number; digest: string }
export interface CompiledPlan {
  format: typeof PLAN_FORMAT;
  compilerVersion: string;
  definition: CrewDefinition;
  assets: Record<string, PinnedAsset>;
  taskOrder: string[];
  layers: string[][];
  candidateRevision: string;
}

export class DefinitionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DefinitionError';
  }
}

const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$', not: { enum: ['constructor', 'prototype', '__proto__'] } };
const text = { type: 'string', minLength: 1, maxLength: 2000 };
const mediaType = { type: 'string', maxLength: 100, pattern: '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' };
const path = { type: 'string', minLength: 1, maxLength: 240 };
const list = (items: object, maxItems = 256, minItems = 0): object => ({ type: 'array', items, maxItems, minItems, uniqueItems: true });
const record = (additionalProperties: object, maxProperties = 64): object => ({ type: 'object', propertyNames: id, additionalProperties, maxProperties });
const object = (properties: Record<string, object>, required = Object.keys(properties)): object => ({ type: 'object', properties, required, additionalProperties: false });
const typeRef = { $ref: '#/definitions/dataType' };
const effect = {
  oneOf: [
    object({ operation: { enum: ['workspace.read', 'workspace.write'] }, path }),
    object({ operation: { const: 'command.test' }, command: id }),
  ],
};

export const crewSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: CREW_FORMAT,
  ...object({
    format: { const: CREW_FORMAT },
    id,
    description: text,
    requiredCapabilities: list({ enum: CAPABILITIES }, CAPABILITIES.length),
    budget: object({
      maxActiveWorkers: { type: 'integer', minimum: 1, maximum: 2 },
      reservePercent: { type: 'integer', minimum: 25, maximum: 100 },
      paidFallback: { const: false },
    }),
    scope: list(effect, 64),
    assets: record(object({ path, mediaType }), 128),
    owners: list(object({
      id, role: text, prompt: id, skills: list(id, 32),
      modelClass: { enum: ['economy', 'standard', 'reasoning'] },
      permissions: list(effect, 64),
    }), 32, 1),
    tasks: list(object({
      id, owner: id, description: text, dependsOn: list(id),
      requires: list({ enum: CAPABILITIES }, CAPABILITIES.length),
      inputs: record(object({
        type: typeRef,
        source: { oneOf: [object({ asset: id }), object({ task: id, output: id })] },
      })),
      outputs: record(typeRef),
      effects: list(effect, 64),
      approval: { enum: ['required', 'none'] },
      policy: object({
        maxAttempts: { type: 'integer', minimum: 1, maximum: 3 },
        timeoutSeconds: { type: 'integer', minimum: 1, maximum: 3600 },
        deadlineSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
        backoffSeconds: { type: 'integer', minimum: 0, maximum: 300 },
        onFailure: { const: 'escalate' },
      }),
      acceptance: list(text, 32, 1),
    }), 256, 1),
  }),
  definitions: {
    dataType: {
      oneOf: [
        object({ kind: { enum: ['string', 'number', 'integer', 'boolean'] } }),
        object({ kind: { const: 'array' }, items: typeRef }),
        object({ kind: { const: 'record' }, fields: record(typeRef) }),
        object({ kind: { const: 'artifact' }, mediaType }),
      ],
    },
  },
};

const validator = new Ajv({ strict: true, allErrors: false, ownProperties: true }).compile<CrewDefinition>(crewSchema);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new DefinitionError('INVALID_VALUE', 'The definition contains a value outside JSON.');
}

export function digest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function assertPortablePath(value: string): void {
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)
    || value.length > 240
    || value.split('/').some(part => part === '.' || part === '..' || part.startsWith('.')
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      || part.endsWith('.'))) {
    throw new DefinitionError('UNSAFE_PATH', 'Use a relative path without hidden files, traversal, or platform-specific syntax.');
  }
}

function assertBoundedValue(value: unknown, depth = 0): void {
  if (depth > 32) throw new DefinitionError('DEFINITION_LIMIT', 'The definition exceeds 32 levels.');
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new DefinitionError('INVALID_VALUE', 'Numbers must be finite and integers must be safe.');
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new DefinitionError('DEFINITION_LIMIT', 'An array exceeds 256 entries.');
    for (const child of value) assertBoundedValue(child, depth + 1);
  } else if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new DefinitionError('INVALID_VALUE', 'Only plain records are permitted.');
    }
    if (Object.keys(value).length > 256) throw new DefinitionError('DEFINITION_LIMIT', 'A record exceeds 256 fields.');
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new DefinitionError('INVALID_VALUE', 'Reserved object keys are forbidden.');
      assertBoundedValue(child, depth + 1);
    }
  } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new DefinitionError('INVALID_VALUE', 'The definition contains a value outside JSON.');
  }
}

function covers(grant: Effect, effect: Effect): boolean {
  if (grant.operation !== effect.operation) return false;
  if ('command' in grant && 'command' in effect) return grant.command === effect.command;
  return 'path' in grant && 'path' in effect
    && (effect.path === grant.path || effect.path.startsWith(`${grant.path}/`));
}

function requireScope(effects: Effect[], grants: Effect[]): void {
  for (const effect of effects) {
    if ('path' in effect) assertPortablePath(effect.path);
    if (!grants.some(grant => covers(grant, effect))) {
      throw new DefinitionError('EFFECT_OUT_OF_SCOPE', 'An effect exceeds its declared permission scope.');
    }
  }
}

export function validateDefinition(value: unknown): CrewDefinition {
  assertBoundedValue(value);
  if (!validator(value)) {
    const error = validator.errors?.[0];
    throw new DefinitionError('SCHEMA_INVALID', `The definition fails the schema at ${error?.instancePath || '/'} (${error?.keyword || 'unknown'}).`);
  }
  const definition = value;
  const owners = new Map(definition.owners.map(owner => [owner.id, owner]));
  const tasks = new Map(definition.tasks.map(task => [task.id, task]));
  if (owners.size !== definition.owners.length) throw new DefinitionError('DUPLICATE_OWNER', 'Each owner ID must be unique.');
  if (tasks.size !== definition.tasks.length) throw new DefinitionError('DUPLICATE_TASK', 'Each task ID must be unique.');
  for (const asset of Object.values(definition.assets)) assertPortablePath(asset.path);
  for (const effect of definition.scope) if ('path' in effect) assertPortablePath(effect.path);
  for (const owner of owners.values()) {
    for (const assetId of [owner.prompt, ...owner.skills]) {
      const asset = definition.assets[assetId];
      if (!asset) throw new DefinitionError('MISSING_ASSET', 'An owner references an unknown prompt or skill.');
      if (!asset.mediaType.startsWith('text/')) throw new DefinitionError('ASSET_TYPE', 'Prompts and skills must declare a text media type.');
    }
    requireScope(owner.permissions, definition.scope);
  }
  for (const task of tasks.values()) {
    const owner = owners.get(task.owner);
    if (!owner) throw new DefinitionError('MISSING_OWNER', 'A task references an unknown owner.');
    requireScope(task.effects, owner.permissions);
    for (const required of task.requires) {
      if (!definition.requiredCapabilities.includes(required)) throw new DefinitionError('MISSING_CAPABILITY', 'A task requires a capability absent from the crew declaration.');
    }
    for (const effect of task.effects) {
      if (!task.requires.includes(effect.operation)) throw new DefinitionError('MISSING_CAPABILITY', 'A task effect lacks its required capability declaration.');
    }
    if (task.approval === 'required' && !task.requires.includes('approval.exact-revision')) {
      throw new DefinitionError('MISSING_CAPABILITY', 'Required approval needs the exact-revision capability.');
    }
    const policy = task.policy;
    if (policy.maxAttempts * policy.timeoutSeconds + (policy.maxAttempts - 1) * policy.backoffSeconds > policy.deadlineSeconds) {
      throw new DefinitionError('INVALID_DEADLINE', 'The deadline must contain all permitted attempts and backoff periods.');
    }
    for (const dependency of task.dependsOn) {
      if (!tasks.has(dependency)) throw new DefinitionError('MISSING_DEPENDENCY', 'A task references an unknown dependency.');
    }
    for (const input of Object.values(task.inputs)) {
      let sourceType: DataType | undefined;
      if ('asset' in input.source) {
        const asset = definition.assets[input.source.asset];
        if (!asset) throw new DefinitionError('MISSING_ASSET', 'A task input references an unknown asset.');
        sourceType = { kind: 'artifact', mediaType: asset.mediaType };
      } else {
        const source = tasks.get(input.source.task);
        if (!source) throw new DefinitionError('MISSING_DEPENDENCY', 'An input references an unknown task.');
        if (!task.dependsOn.includes(source.id)) throw new DefinitionError('UNDECLARED_DEPENDENCY', 'An input producer must appear in dependsOn.');
        sourceType = source.outputs[input.source.output];
        if (!sourceType) throw new DefinitionError('MISSING_OUTPUT', 'An input references an unknown output.');
      }
      if (canonicalJson(sourceType) !== canonicalJson(input.type)) throw new DefinitionError('TYPE_MISMATCH', 'Input and source types must match exactly.');
    }
  }
  graphOrder(definition);
  return definition;
}

export function graphOrder(definition: CrewDefinition): { taskOrder: string[]; layers: string[][] } {
  const pending = new Map(definition.tasks.map(task => [task.id, new Set(task.dependsOn)]));
  const taskOrder: string[] = [];
  const layers: string[][] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
    if (ready.length === 0) throw new DefinitionError('GRAPH_CYCLE', 'The task graph contains a cycle.');
    layers.push(ready);
    taskOrder.push(...ready);
    for (const id of ready) pending.delete(id);
    for (const dependencies of pending.values()) for (const id of ready) dependencies.delete(id);
  }
  return { taskOrder, layers };
}
