import { importJWK, jwtVerify } from 'jose';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { canonicalJson } from '../../contracts/src/index.js';
import { data, fail, mcpBindingRevision, sha256, validateMcpBinding } from './model.js';

export interface McpPublicRsaKey { kty: 'RSA'; kid: string; alg: 'RS256'; use: 'sig'; n: string; e: string }
export interface McpTokenPolicy {
  format: 'bowerloom/mcp-token-policy/v1beta1'; bindingRevision: string; subject: string; clientId: string; issuer: string; audience: string;
  publicKeys: McpPublicRsaKey[]; maxTokenLifetimeSeconds: number; maxTokenAgeSeconds: number;
  maxRevocationAgeSeconds: number; revocationEpoch: number; revocationRevision: string;
}
export interface McpRevocationSnapshot {
  format: 'bowerloom/mcp-revocation-snapshot/v1beta1'; bindingRevision: string; issuer: string; subject: string;
  revocationEpoch: number; issuedAtMs: number; validUntilMs: number;
  revokedTokenIds: string[]; revokedSubjects: string[]; revokedKeyIds: string[];
}
export interface McpAccessTokenInput {
  token: string; binding: unknown; policy: unknown; revocation: unknown; nowMs: number; synthetic: true;
}
export interface McpTokenReceipt {
  format: 'bowerloom/mcp-token-validation/v1beta1'; contentScope: 'private-local-validation';
  bindingRevision: string; policyRevision: string; revocationRevision: string; subject: string; kid: string;
  expiresAtMs: number; validatedAtMs: number; signatureVerified: true; synthetic: true;
  evidence: 'supplied-token-local-keys-and-policy'; executionAuthorized: false; realIdentityVerified: false; grants: [];
}
const digest = (value: unknown): string => 'sha256:' + sha256(canonicalJson(value));
function record(value: unknown, keys: string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key))) fail(code);
  return v;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(value)
    || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(value)) fail('MCP_AUTH_IDENTIFIER');
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('MCP_AUTH_REVISION');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('MCP_AUTH_NUMBER');
  return value;
}
function url(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 2048 || /[\p{Cc}\p{Cf}\s%\\?#]/u.test(value)) fail('MCP_AUTH_URL');
  let parsed: URL; try { parsed = new URL(value); } catch { return fail('MCP_AUTH_URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.href !== value) fail('MCP_AUTH_URL');
  return value;
}
function identifiers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256) fail('MCP_AUTH_REVOCATION_BOUND');
  const out = value.map(id); if (new Set(out).size !== out.length) fail('MCP_AUTH_DUPLICATE');
  return out;
}
function b64(value: unknown, maxBytes: number, code: string): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) fail(code);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length > maxBytes || decoded.toString('base64url') !== value) fail(code);
  return decoded;
}
function publicKey(value: unknown): McpPublicRsaKey {
  const v = record(value, ['kty', 'kid', 'alg', 'use', 'n', 'e'], 'MCP_AUTH_KEY_FIELDS');
  if (v.kty !== 'RSA' || v.alg !== 'RS256' || v.use !== 'sig') fail('MCP_AUTH_KEY_TYPE');
  const n = b64(v.n, 512, 'MCP_AUTH_KEY_ENCODING'), e = b64(v.e, 4, 'MCP_AUTH_KEY_ENCODING');
  if (!n.length || n[0] === 0 || !e.length || e[0] === 0) fail('MCP_AUTH_KEY_ENCODING');
  const bits = (n.length - 1) * 8 + 32 - Math.clz32(n[0]!);
  const exponent = e.readUIntBE(0, e.length);
  if (bits < 2048 || bits > 4096 || !(n[n.length - 1]! & 1) || exponent < 3 || !(exponent & 1)) fail('MCP_AUTH_KEY_SIZE');
  return { kty: 'RSA', kid: id(v.kid), alg: 'RS256', use: 'sig', n: v.n as string, e: v.e as string };
}
function snapshot(value: unknown): McpRevocationSnapshot {
  const v = record(data(value), ['format', 'bindingRevision', 'issuer', 'subject', 'revocationEpoch', 'issuedAtMs', 'validUntilMs', 'revokedTokenIds', 'revokedSubjects', 'revokedKeyIds'], 'MCP_AUTH_REVOCATION_FIELDS');
  if (v.format !== 'bowerloom/mcp-revocation-snapshot/v1beta1') fail('MCP_AUTH_REVOCATION_FORMAT');
  return { format: v.format, bindingRevision: hash(v.bindingRevision), issuer: url(v.issuer), subject: id(v.subject),
    revocationEpoch: integer(v.revocationEpoch, 0, Number.MAX_SAFE_INTEGER), issuedAtMs: integer(v.issuedAtMs, 0, 8640000000000000), validUntilMs: integer(v.validUntilMs, 0, 8640000000000000),
    revokedTokenIds: identifiers(v.revokedTokenIds), revokedSubjects: identifiers(v.revokedSubjects), revokedKeyIds: identifiers(v.revokedKeyIds) };
}
export function mcpRevocationRevision(value: unknown): string { return digest(snapshot(value)); }
function policy(value: unknown): McpTokenPolicy {
  const v = record(data(value), ['format', 'bindingRevision', 'subject', 'clientId', 'issuer', 'audience', 'publicKeys', 'maxTokenLifetimeSeconds', 'maxTokenAgeSeconds', 'maxRevocationAgeSeconds', 'revocationEpoch', 'revocationRevision'], 'MCP_AUTH_POLICY_FIELDS');
  if (v.format !== 'bowerloom/mcp-token-policy/v1beta1') fail('MCP_AUTH_POLICY_FORMAT');
  if (!Array.isArray(v.publicKeys) || v.publicKeys.length < 1 || v.publicKeys.length > 8) fail('MCP_AUTH_KEY_BOUND');
  const keys = v.publicKeys.map(publicKey); if (new Set(keys.map(key => key.kid)).size !== keys.length) fail('MCP_AUTH_DUPLICATE_KEY');
  return { format: v.format, bindingRevision: hash(v.bindingRevision), subject: id(v.subject), clientId: id(v.clientId), issuer: url(v.issuer), audience: url(v.audience), publicKeys: keys,
    maxTokenLifetimeSeconds: integer(v.maxTokenLifetimeSeconds, 1, 3600), maxTokenAgeSeconds: integer(v.maxTokenAgeSeconds, 1, 3600),
    maxRevocationAgeSeconds: integer(v.maxRevocationAgeSeconds, 1, 300), revocationEpoch: integer(v.revocationEpoch, 0, Number.MAX_SAFE_INTEGER), revocationRevision: hash(v.revocationRevision) };
}
function jsonSegment(segment: unknown, limit: number): unknown {
  const bytes = b64(segment, limit, 'MCP_AUTH_TOKEN_ENCODING');
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail('MCP_AUTH_TOKEN_ENCODING'); }
  try { return data(strictJson(text, limit)); } catch { return fail('MCP_AUTH_TOKEN_JSON'); }
}
/** Resource-side verification of supplied synthetic evidence. The trusted host owns policy provenance, time and durable revocation state. */
export async function validateMcpAccessToken(value: McpAccessTokenInput): Promise<McpTokenReceipt> {
  let captured: Record<string, unknown>;
  try { captured = record(data(value), ['token', 'binding', 'policy', 'revocation', 'nowMs', 'synthetic'], 'MCP_AUTH_INPUT'); }
  catch { return fail('MCP_AUTH_INPUT'); }
  if (captured.synthetic !== true || typeof captured.token !== 'string') fail('MCP_AUTH_SYNTHETIC_REQUIRED');
  const nowMs = integer(captured.nowMs, 0, 8640000000000000), now = Math.floor(nowMs / 1000);
  const binding = validateMcpBinding(captured.binding);
  if (binding.transport.kind !== 'streamable-http' || binding.transport.auth.kind !== 'oauth2') fail('MCP_AUTH_OAUTH_BINDING_REQUIRED');
  const auth = binding.transport.auth, bindingRevision = mcpBindingRevision(binding), trusted = policy(captured.policy), revoked = snapshot(captured.revocation);
  const revocationRevision = digest(revoked);
  if (trusted.bindingRevision !== bindingRevision || revoked.bindingRevision !== bindingRevision || trusted.issuer !== auth.issuer
    || trusted.audience !== auth.audience || revoked.issuer !== auth.issuer || revoked.subject !== trusted.subject) fail('MCP_AUTH_BINDING_MISMATCH');
  if (trusted.revocationRevision !== revocationRevision || trusted.revocationEpoch !== revoked.revocationEpoch) fail('MCP_AUTH_REVOCATION_REVISION');
  if (revoked.issuedAtMs > nowMs || revoked.validUntilMs <= nowMs || revoked.validUntilMs <= revoked.issuedAtMs
    || nowMs - revoked.issuedAtMs > trusted.maxRevocationAgeSeconds * 1000
    || revoked.validUntilMs - revoked.issuedAtMs > trusted.maxRevocationAgeSeconds * 1000) fail('MCP_AUTH_REVOCATION_STALE');
  const token = captured.token;
  if (Buffer.byteLength(token) > 16384) fail('MCP_AUTH_TOKEN_BOUND');
  const segments = token.split('.'); if (segments.length !== 3) fail('MCP_AUTH_TOKEN_ENCODING');
  const header = record(jsonSegment(segments[0], 2048), ['alg', 'typ', 'kid'], 'MCP_AUTH_HEADER_FIELDS');
  if (header.alg !== 'RS256' || header.typ !== 'at+jwt') fail('MCP_AUTH_HEADER_PROFILE');
  const kid = id(header.kid), key = trusted.publicKeys.find(item => item.kid === kid); if (!key) fail('MCP_AUTH_KEY_UNKNOWN');
  const signature = b64(segments[2], 512, 'MCP_AUTH_TOKEN_ENCODING');
  if (signature.length !== Buffer.from(key.n, 'base64url').length) fail('MCP_AUTH_SIGNATURE');
  const claims = record(jsonSegment(segments[1], 8192), ['iss', 'aud', 'sub', 'client_id', 'scope', 'exp', 'nbf', 'iat', 'jti'], 'MCP_AUTH_CLAIM_FIELDS');
  if (claims.iss !== auth.issuer || claims.aud !== auth.audience || claims.sub !== trusted.subject || claims.client_id !== trusted.clientId) fail('MCP_AUTH_CLAIM_BINDING');
  const exp = integer(claims.exp, 0, 8640000000000), nbf = integer(claims.nbf, 0, 8640000000000), iat = integer(claims.iat, 0, 8640000000000), jti = id(claims.jti);
  if (iat > now || nbf > now || exp <= now || nbf < iat || nbf >= exp || exp <= iat || exp - iat > trusted.maxTokenLifetimeSeconds || now - iat > trusted.maxTokenAgeSeconds) fail('MCP_AUTH_TOKEN_TIME');
  if (typeof claims.scope !== 'string' || Buffer.byteLength(claims.scope) > 4096 || !claims.scope.length || claims.scope.trim() !== claims.scope) fail('MCP_AUTH_SCOPE');
  const scopes = claims.scope.split(' ');
  if (new Set(scopes).size !== scopes.length || scopes.length !== auth.scopes.length || scopes.some(scope => !auth.scopes.includes(scope))) fail('MCP_AUTH_SCOPE');
  if (revoked.revokedTokenIds.includes(jti) || revoked.revokedSubjects.includes(trusted.subject) || revoked.revokedKeyIds.includes(kid)) fail('MCP_AUTH_REVOKED');
  try {
    const publicCryptoKey = await importJWK({ ...key }, 'RS256');
    await jwtVerify(token, publicCryptoKey, { algorithms: ['RS256'], typ: 'at+jwt', issuer: auth.issuer, audience: auth.audience, subject: trusted.subject,
      requiredClaims: ['iss', 'aud', 'sub', 'client_id', 'scope', 'exp', 'nbf', 'iat', 'jti'], maxTokenAge: trusted.maxTokenAgeSeconds, clockTolerance: 0, currentDate: new Date(nowMs) });
  } catch { return fail('MCP_AUTH_SIGNATURE'); }
  return Object.freeze({ format: 'bowerloom/mcp-token-validation/v1beta1', contentScope: 'private-local-validation',
    bindingRevision, policyRevision: digest(trusted), revocationRevision, subject: trusted.subject, kid,
    expiresAtMs: exp * 1000, validatedAtMs: nowMs, signatureVerified: true, synthetic: true,
    evidence: 'supplied-token-local-keys-and-policy', executionAuthorized: false, realIdentityVerified: false, grants: Object.freeze([]) as unknown as [] });
}
