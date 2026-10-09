import { createHash } from 'node:crypto';
import { canonicalJson } from '../../contracts/src/index.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25' as const;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export type TransportKind = 'stdio' | 'streamable-http';
export type PermissionClass = 'read-only' | 'local-write' | 'external-write' | 'destructive';
export interface ServerIdentity { name: string; version: string }
export interface McpDeclaration {
  format: 'bowerloom/mcp-declaration/v1beta1'; connectionId: string;
  protocolVersion: typeof MCP_PROTOCOL_VERSION; transport: TransportKind;
  tools: { name: string; permissionClass: PermissionClass }[];
}
export interface McpBinding {
  format: 'bowerloom/mcp-binding/v1beta1'; connectionId: string; bindingId: string;
  protocolVersion: typeof MCP_PROTOCOL_VERSION; serverIdentity: ServerIdentity;
  transport: { kind: 'stdio'; executable: string; workingDirectory: string;
    secretReferences: { environmentVariable: string; reference: string }[] }
    | { kind: 'streamable-http'; endpoint: string; auth: { kind: 'none' }
      | { kind: 'oauth2'; issuer: string; audience: string; scopes: string[]; credentialRef: string } };
}
export interface McpCatalog {
  format: 'bowerloom/mcp-recorded-catalog/v1beta1'; synthetic: true;
  connectionId: string; bindingId: string; bindingRevision: string;
  protocolVersion: typeof MCP_PROTOCOL_VERSION; serverIdentity: ServerIdentity; transport: TransportKind;
  tools: { name: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>;
    description?: string; annotations?: Record<string, unknown> }[];
}
export interface McpPlanInput { declaration: unknown; binding: unknown; catalog: unknown; synthetic: true }
export interface McpConnectionPlan {
  format: 'bowerloom/mcp-connection-plan/v1beta1'; contentScope: 'private-local-plan';
  inputEvidence: 'caller-supplied-synthetic-record'; status: 'planning-only';
  declaration: McpDeclaration; binding: McpBinding; declarationRevision: string; bindingRevision: string;
  catalogRevision: string; catalogTools: { name: string; inputSchemaRevision: string; outputSchemaRevision: string | null }[];
  selectedTools: { name: string; permissionClass: PermissionClass; inputSchemaRevision: string; outputSchemaRevision: string | null }[];
  executionAuthorized: false; writesAuthorized: false; liveDiscoveryVerified: false;
  authenticationVerified: false; runtimePortabilityVerified: false; grants: []; revision: string;
}
export class McpConnectionError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'McpConnectionError'; }
}
export function fail(code: string): never { throw new McpConnectionError(code); }
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const revision = (value: unknown): string => 'sha256:' + sha256(canonicalJson(value));
const forbidden = new Set(['__proto__', 'constructor', 'prototype', 'toJSON']);
const control = /[\p{Cc}\p{Cf}]/u;

// Clone plain JSON data through descriptors before any serialization or field access.
// Accessors, custom prototypes, cycles, sparse arrays and symbols are rejected.
export function data(value: unknown): unknown {
  let nodes = 0, size = 0;
  const parents = new Set<object>();
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > 12000 || depth > 32) fail('MCP_INPUT_COMPLEXITY');
    if (v === null || typeof v === 'boolean') { size += 5; return v; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail('MCP_INPUT_NUMBER'); size += 32; return v; }
    if (typeof v === 'string') {
      if (Buffer.from(v).toString('utf8') !== v || control.test(v.replace(/[\r\n\t]/g, ''))) fail('MCP_INPUT_TEXT');
      size += Buffer.byteLength(v) + 2; if (size > MAX_DOCUMENT_BYTES * 3) fail('MCP_INPUT_BOUND'); return v;
    }
    if (!v || typeof v !== 'object') fail('MCP_INPUT_DATA');
    if (parents.has(v)) fail('MCP_INPUT_CYCLE');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('MCP_INPUT_PROTOTYPE');
    const keys = Reflect.ownKeys(v); if (keys.length > 4096) fail('MCP_INPUT_COMPLEXITY');
    const desc = Object.getOwnPropertyDescriptors(v);
    if (keys.some(key => typeof key !== 'string' || forbidden.has(key)
      || !('value' in desc[key]!) || (key !== 'length' && !desc[key]!.enumerable))) fail('MCP_INPUT_FIELDS');
    parents.add(v);
    let result: unknown;
    if (array) {
      const length = desc.length!.value as number;
      if (!Number.isSafeInteger(length) || length > 4096 || keys.length !== length + 1
        || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key as string))) fail('MCP_INPUT_ARRAY');
      result = Array.from({ length }, (_, i) => { if (!desc[String(i)]) fail('MCP_INPUT_ARRAY'); return visit(desc[String(i)]!.value, depth + 1); });
    } else {
      const out: Record<string, unknown> = Object.create(null);
      for (const key of keys as string[]) {
        if (!key || Buffer.byteLength(key) > 256 || key !== key.normalize('NFC') || control.test(key)) fail('MCP_INPUT_KEY');
        size += Buffer.byteLength(key) + 4; out[key] = visit(desc[key]!.value, depth + 1);
      }
      result = out;
    }
    parents.delete(v);
    if (size > MAX_DOCUMENT_BYTES * 3) fail('MCP_INPUT_BOUND');
    return result;
  }
  try { return visit(value, 0); } catch (error) { if (error instanceof McpConnectionError) throw error; return fail('MCP_INPUT_DATA'); }
}
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MCP_OBJECT');
  const v = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !required.includes(key) && !optional.includes(key))) fail('MCP_FIELDS');
  return v;
}
function list(value: unknown, max = 64, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('MCP_LIST_BOUND');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) || forbidden.has(value)) fail('MCP_NAME');
  return value;
}
function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > max || control.test(value) || value !== value.normalize('NFC')) fail('MCP_TEXT');
  return value;
}
function protocol(value: unknown): typeof MCP_PROTOCOL_VERSION { if (value !== MCP_PROTOCOL_VERSION) fail('MCP_PROTOCOL'); return value; }
function kind(value: unknown): TransportKind { if (value !== 'stdio' && value !== 'streamable-http') fail('MCP_TRANSPORT'); return value; }
function identity(value: unknown): ServerIdentity {
  const v = record(value, ['name', 'version']);
  const version = text(v.version, 64); if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version)) fail('MCP_SERVER_VERSION');
  return { name: name(v.name), version };
}
function unique<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>(); for (const value of values) { const id = key(value); if (seen.has(id)) fail('MCP_DUPLICATE'); seen.add(id); }
  return values;
}
function bounded(value: unknown): unknown { const cloned = data(value); if (Buffer.byteLength(canonicalJson(cloned)) > MAX_DOCUMENT_BYTES) fail('MCP_INPUT_BOUND'); return cloned; }
export function validateMcpDeclaration(value: unknown): McpDeclaration {
  const v = record(bounded(value), ['format', 'connectionId', 'protocolVersion', 'transport', 'tools']);
  if (v.format !== 'bowerloom/mcp-declaration/v1beta1') fail('MCP_DECLARATION_FORMAT');
  const tools = unique(list(v.tools, 64, 1).map(item => {
    const tool = record(item, ['name', 'permissionClass']);
    if (!['read-only', 'local-write', 'external-write', 'destructive'].includes(tool.permissionClass as string)) fail('MCP_PERMISSION_CLASS');
    return { name: name(tool.name), permissionClass: tool.permissionClass as PermissionClass };
  }), tool => tool.name);
  return { format: v.format, connectionId: name(v.connectionId), protocolVersion: protocol(v.protocolVersion), transport: kind(v.transport), tools };
}
function localPath(value: unknown): string {
  const path = text(value);
  if (!path.startsWith('/') || path.endsWith('/') || path.includes('//') || path.split('/').some(part => part === '.' || part === '..') || path.includes('\\')) fail('MCP_BINDING_PATH');
  return path;
}
function https(value: unknown): string {
  const raw = text(value); let url: URL;
  try { url = new URL(raw); } catch { return fail('MCP_ENDPOINT'); }
  // Canonical spelling avoids alternate authority, port, escape and dot-segment identities.
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
    || raw.includes('?') || raw.includes('#') || raw.includes('%') || raw.includes('\\') || /\s/.test(raw)
    || url.href !== raw || !url.pathname.startsWith('/')) fail('MCP_ENDPOINT');
  return raw;
}
function secretRef(value: unknown): string {
  if (typeof value !== 'string' || !/^secret-ref:[a-z][a-z0-9-]{0,31}\/[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)) fail('MCP_SECRET_REFERENCE');
  return value;
}
export function validateMcpBinding(value: unknown): McpBinding {
  const v = record(bounded(value), ['format', 'connectionId', 'bindingId', 'protocolVersion', 'serverIdentity', 'transport']);
  if (v.format !== 'bowerloom/mcp-binding/v1beta1') fail('MCP_BINDING_FORMAT');
  const k = kind(record(v.transport, ['kind'], ['executable', 'workingDirectory', 'secretReferences', 'endpoint', 'auth']).kind);
  let transport: McpBinding['transport'];
  if (k === 'stdio') {
    const t = record(v.transport, ['kind', 'executable', 'workingDirectory', 'secretReferences']);
    const refs = unique(list(t.secretReferences, 16).map(item => {
      const r = record(item, ['environmentVariable', 'reference']);
      if (typeof r.environmentVariable !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(r.environmentVariable)) fail('MCP_ENVIRONMENT_NAME');
      return { environmentVariable: r.environmentVariable, reference: secretRef(r.reference) };
    }), ref => ref.environmentVariable);
    transport = { kind: k, executable: localPath(t.executable), workingDirectory: localPath(t.workingDirectory), secretReferences: refs };
  } else {
    const t = record(v.transport, ['kind', 'endpoint', 'auth']), a = record(t.auth, ['kind'], ['issuer', 'audience', 'scopes', 'credentialRef']);
    let auth: Extract<McpBinding['transport'], { kind: 'streamable-http' }>['auth'];
    if (a.kind === 'none') { record(a, ['kind']); auth = { kind: 'none' }; }
    else if (a.kind === 'oauth2') {
      record(a, ['kind', 'issuer', 'audience', 'scopes', 'credentialRef']);
      const scopes = unique(list(a.scopes, 32, 1).map(value => {
        const scope = text(value, 128); if (!/^[A-Za-z][A-Za-z0-9:._/-]*$/.test(scope)) fail('MCP_AUTH_SCOPE'); return scope;
      }), scope => scope);
      auth = { kind: 'oauth2', issuer: https(a.issuer), audience: https(a.audience), scopes, credentialRef: secretRef(a.credentialRef) };
    } else return fail('MCP_AUTH_KIND');
    transport = { kind: k, endpoint: https(t.endpoint), auth };
  }
  return { format: v.format, connectionId: name(v.connectionId), bindingId: name(v.bindingId), protocolVersion: protocol(v.protocolVersion), serverIdentity: identity(v.serverIdentity), transport };
}
export function mcpBindingRevision(value: unknown): string { return revision(validateMcpBinding(value)); }
function schema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).type !== 'object') fail('MCP_SCHEMA_OBJECT');
  if (Buffer.byteLength(canonicalJson(value)) > 64 * 1024) fail('MCP_SCHEMA_BOUND');
  return value as Record<string, unknown>;
}
function catalog(value: unknown): McpCatalog {
  const v = record(bounded(value), ['format', 'synthetic', 'connectionId', 'bindingId', 'bindingRevision', 'protocolVersion', 'serverIdentity', 'transport', 'tools']);
  if (v.format !== 'bowerloom/mcp-recorded-catalog/v1beta1' || v.synthetic !== true) fail('MCP_CATALOG_FORMAT');
  if (typeof v.bindingRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v.bindingRevision)) fail('MCP_BINDING_REVISION');
  const tools = unique(list(v.tools, 256, 1).map(item => {
    const tool = record(item, ['name', 'inputSchema'], ['outputSchema', 'description', 'annotations']);
    if (tool.description !== undefined && (typeof tool.description !== 'string' || Buffer.byteLength(tool.description) > 4096)) fail('MCP_DESCRIPTION_BOUND');
    if (tool.annotations !== undefined) {
      const a = record(tool.annotations, [], ['title', 'readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']);
      for (const [key, value] of Object.entries(a)) if (key === 'title' ? typeof value !== 'string' || Buffer.byteLength(value) > 256 : typeof value !== 'boolean') fail('MCP_ANNOTATION');
    }
    return { name: name(tool.name), inputSchema: schema(tool.inputSchema), ...(tool.outputSchema !== undefined ? { outputSchema: schema(tool.outputSchema) } : {}),
      ...(tool.description !== undefined ? { description: tool.description as string } : {}), ...(tool.annotations !== undefined ? { annotations: tool.annotations as Record<string, unknown> } : {}) };
  }), tool => tool.name);
  return { format: v.format, synthetic: true, connectionId: name(v.connectionId), bindingId: name(v.bindingId), bindingRevision: v.bindingRevision,
    protocolVersion: protocol(v.protocolVersion), serverIdentity: identity(v.serverIdentity), transport: kind(v.transport), tools };
}
export function planMcpConnection(value: McpPlanInput): McpConnectionPlan {
  const input = record(data(value), ['declaration', 'binding', 'catalog', 'synthetic']);
  if (input.synthetic !== true) fail('MCP_SYNTHETIC_REQUIRED');
  const declaration = validateMcpDeclaration(input.declaration), binding = validateMcpBinding(input.binding), recorded = catalog(input.catalog);
  const bindingRevision = revision(binding);
  if (declaration.connectionId !== binding.connectionId || recorded.connectionId !== binding.connectionId || recorded.bindingId !== binding.bindingId
    || recorded.bindingRevision !== bindingRevision || canonicalJson(recorded.serverIdentity) !== canonicalJson(binding.serverIdentity)) fail('MCP_IDENTITY_MISMATCH');
  if (declaration.transport !== binding.transport.kind || recorded.transport !== binding.transport.kind) fail('MCP_TRANSPORT_MISMATCH');
  const catalogTools = recorded.tools.map(tool => ({ name: tool.name, inputSchemaRevision: revision(tool.inputSchema), outputSchemaRevision: tool.outputSchema ? revision(tool.outputSchema) : null }));
  const selectedTools = declaration.tools.map(tool => {
    const found = catalogTools.find(item => item.name === tool.name); if (!found) fail('MCP_TOOL_MISSING');
    return { ...found, permissionClass: tool.permissionClass };
  });
  const body = { format: 'bowerloom/mcp-connection-plan/v1beta1' as const, contentScope: 'private-local-plan' as const,
    inputEvidence: 'caller-supplied-synthetic-record' as const, status: 'planning-only' as const, declaration, binding,
    declarationRevision: revision(declaration), bindingRevision, catalogRevision: revision(recorded), catalogTools, selectedTools,
    executionAuthorized: false as const, writesAuthorized: false as const, liveDiscoveryVerified: false as const,
    authenticationVerified: false as const, runtimePortabilityVerified: false as const, grants: [] as [] };
  return { ...body, revision: revision(body) };
}
