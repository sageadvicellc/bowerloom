import { posix } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { data, fail, McpConnectionError, sha256 } from './model.js';

export interface McpContainerSpec {
  format: 'bowerloom/mcp-container-launch/v1beta1'; operationKey: string;
  imageIndexDigest: string; imageManifestDigest: string; imageConfigDigest: string;
  platform: 'linux/arm64' | 'linux/amd64'; entrypoint: string; args: string[]; workingDirectory: string;
  user: { uid: number; gid: number }; imageEnvironment: string[];
  limits: { cpuMillis: number; memoryBytes: number; pids: number; scratchBytes: number; shmBytes: number };
}
export interface McpContainerPlanInput { spec: unknown; imageIndexJson: string; imageManifestJson: string; imageConfigJson: string; synthetic: true }
export interface McpContainerPlan {
  format: 'bowerloom/mcp-container-plan/v1beta1'; contentScope: 'private-local-plan';
  spec: McpContainerSpec; argv: string[]; revision: string;
  executionAuthorized: false; containmentVerified: false; transportVerified: false; grants: [];
}
const INDEX = 'application/vnd.oci.image.index.v1+json', MANIFEST = 'application/vnd.oci.image.manifest.v1+json', CONFIG = 'application/vnd.oci.image.config.v1+json';
const blockedEnvironment = /^(?:HOME|SHELL|ENV|BASH_ENV|IFS|CDPATH|NODE_OPTIONS|NODE_PATH|NODE_V8_COVERAGE|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|NODE_REPL_EXTERNAL_MODULE|OPENSSL_CONF|OPENSSL_MODULES|SSL_CERT_FILE|SSL_CERT_DIR|PYTHON.*|PERL.*|RUBY.*|GEM_.*|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|CLASSPATH|LD_.*|DYLD_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/;
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MCP_CONTAINER_FIELDS');
  const v = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(v, key)) || Object.keys(v).some(key => !required.concat(optional).includes(key))) fail('MCP_CONTAINER_FIELDS');
  return v;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('MCP_CONTAINER_LIMIT'); return value;
}
function text(value: unknown, max = 2048, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value) || Buffer.byteLength(value) > max || /[\p{Cc}\p{Cf}]/u.test(value) || value !== value.normalize('NFC')) fail('MCP_CONTAINER_TEXT'); return value;
}
function digest(value: unknown): string { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('MCP_CONTAINER_DIGEST'); return value; }
function list(value: unknown, max: number, min = 0): unknown[] { if (!Array.isArray(value) || value.length < min || value.length > max) fail('MCP_CONTAINER_BOUND'); return value; }
function imagePath(value: unknown): string {
  const v = text(value);
  if (!v.startsWith('/') || posix.normalize(v) !== v || v.includes('\\') || (v !== '/' && v.endsWith('/'))
    || /^\/(?:proc|sys|dev|scratch|run)(?:\/|$)/.test(v)) fail('MCP_CONTAINER_PATH'); return v;
}
function environment(value: unknown): string[] {
  const names = new Set<string>(); let bytes = 0;
  return list(value, 32).map(item => {
    const v = text(item, 2048), at = v.indexOf('='), name = v.slice(0, at);
    if (at < 1 || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || names.has(name) || blockedEnvironment.test(name)
      || /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY)(?:_|$)/.test(name) || (bytes += Buffer.byteLength(v)) > 16384) fail('MCP_CONTAINER_ENVIRONMENT');
    names.add(name); return v;
  });
}
function spec(value: unknown): McpContainerSpec {
  const v = record(value, ['format', 'operationKey', 'imageIndexDigest', 'imageManifestDigest', 'imageConfigDigest', 'platform', 'entrypoint', 'args', 'workingDirectory', 'user', 'imageEnvironment', 'limits']);
  if (v.format !== 'bowerloom/mcp-container-launch/v1beta1' || !['linux/arm64', 'linux/amd64'].includes(v.platform as string)) fail('MCP_CONTAINER_PLATFORM');
  const user = record(v.user, ['uid', 'gid']), limits = record(v.limits, ['cpuMillis', 'memoryBytes', 'pids', 'scratchBytes', 'shmBytes']);
  let bytes = 0;
  const args = list(v.args, 32, 1).map(item => { const arg = text(item, 8192, true); if ((bytes += Buffer.byteLength(arg)) > 32768) fail('MCP_CONTAINER_BOUND'); return arg; });
  const normalized: McpContainerSpec = { format: 'bowerloom/mcp-container-launch/v1beta1', operationKey: digest(v.operationKey), imageIndexDigest: digest(v.imageIndexDigest), imageManifestDigest: digest(v.imageManifestDigest), imageConfigDigest: digest(v.imageConfigDigest), platform: v.platform as McpContainerSpec['platform'],
    entrypoint: imagePath(v.entrypoint), args, workingDirectory: imagePath(v.workingDirectory), user: { uid: integer(user.uid, 1, 2147483647), gid: integer(user.gid, 1, 2147483647) }, imageEnvironment: environment(v.imageEnvironment),
    limits: { cpuMillis: integer(limits.cpuMillis, 100, 2000), memoryBytes: integer(limits.memoryBytes, 32 * 1024 * 1024, 1024 ** 3), pids: integer(limits.pids, 8, 256), scratchBytes: integer(limits.scratchBytes, 1024 ** 2, 64 * 1024 ** 2), shmBytes: integer(limits.shmBytes, 65536, 16 * 1024 ** 2) } };
  if (normalized.limits.scratchBytes + normalized.limits.shmBytes > normalized.limits.memoryBytes / 2) fail('MCP_CONTAINER_LIMIT');
  return normalized;
}
function annotations(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 64) fail('MCP_CONTAINER_METADATA');
  for (const [key, item] of Object.entries(value)) { text(key, 256); text(item, 4096, true); }
}
function descriptor(value: unknown, withPlatform = false): Record<string, unknown> {
  const v = record(value, ['mediaType', 'digest', 'size'], withPlatform ? ['platform', 'annotations'] : ['annotations']);
  text(v.mediaType, 128); digest(v.digest); integer(v.size, 1, 4 * 1024 ** 3); annotations(v.annotations); return v;
}
function raw(value: unknown, expected: string): { parsed: Record<string, unknown>; bytes: number } {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 131072 || Buffer.from(value).toString('utf8') !== value || 'sha256:' + sha256(value) !== expected) fail('MCP_CONTAINER_ARTIFACT');
  try { return { parsed: data(strictJson(value, 131072)) as Record<string, unknown>, bytes: Buffer.byteLength(value) }; } catch { return fail('MCP_CONTAINER_ARTIFACT'); }
}
function verifyArtifacts(input: Record<string, unknown>, selected: McpContainerSpec): void {
  const indexRaw = raw(input.imageIndexJson, selected.imageIndexDigest), manifestRaw = raw(input.imageManifestJson, selected.imageManifestDigest), configRaw = raw(input.imageConfigJson, selected.imageConfigDigest);
  const index = record(indexRaw.parsed, ['schemaVersion', 'mediaType', 'manifests'], ['annotations']);
  if (index.schemaVersion !== 2 || index.mediaType !== INDEX) fail('MCP_CONTAINER_ARTIFACT'); annotations(index.annotations);
  const arch = selected.platform.slice(6), matches: Record<string, unknown>[] = [];
  for (const item of list(index.manifests, 64, 1)) {
    const d = descriptor(item, true); if (d.mediaType !== MANIFEST) fail('MCP_CONTAINER_ARTIFACT');
    const platform = record(d.platform, ['architecture', 'os'], ['variant']); text(platform.architecture, 32); text(platform.os, 32);
    if (platform.variant !== undefined) text(platform.variant, 32);
    if (platform.architecture === arch && platform.os === 'linux') matches.push(d);
  }
  if (matches.length !== 1 || matches[0]!.digest !== selected.imageManifestDigest || matches[0]!.size !== manifestRaw.bytes) fail('MCP_CONTAINER_PLATFORM');
  const selectedPlatform = matches[0]!.platform as Record<string, unknown>;
  if (arch === 'arm64' ? selectedPlatform.variant !== undefined && selectedPlatform.variant !== 'v8' : selectedPlatform.variant !== undefined) fail('MCP_CONTAINER_PLATFORM');
  const manifest = record(manifestRaw.parsed, ['schemaVersion', 'mediaType', 'config', 'layers'], ['annotations']);
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== MANIFEST) fail('MCP_CONTAINER_ARTIFACT'); annotations(manifest.annotations);
  const config = descriptor(manifest.config);
  if (config.mediaType !== CONFIG || config.digest !== selected.imageConfigDigest || config.size !== configRaw.bytes) fail('MCP_CONTAINER_ARTIFACT');
  const layers = list(manifest.layers, 128, 1); let layerBytes = 0;
  for (const item of layers) { const layer = descriptor(item); if (!['application/vnd.oci.image.layer.v1.tar', 'application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.oci.image.layer.v1.tar+zstd'].includes(layer.mediaType as string)
    || (layerBytes += layer.size as number) > 8 * 1024 ** 3) fail('MCP_CONTAINER_ARTIFACT'); }
  const image = record(configRaw.parsed, ['architecture', 'os', 'config', 'rootfs'], ['variant', 'created', 'author', 'history']);
  if (image.architecture !== arch || image.os !== 'linux' || image.variant !== selectedPlatform.variant) fail('MCP_CONTAINER_PLATFORM');
  const rootfs = record(image.rootfs, ['type', 'diff_ids']);
  if (rootfs.type !== 'layers' || list(rootfs.diff_ids, 128, 1).length !== layers.length) fail('MCP_CONTAINER_ARTIFACT');
  for (const diff of rootfs.diff_ids as unknown[]) digest(diff);
  const runtime = record(image.config, [], ['Env', 'User', 'WorkingDir', 'Entrypoint', 'Cmd', 'Volumes', 'Healthcheck', 'OnBuild', 'ExposedPorts', 'Labels', 'StopSignal', 'ArgsEscaped']);
  if (canonicalJson(environment(runtime.Env ?? [])) !== canonicalJson(selected.imageEnvironment)) fail('MCP_CONTAINER_ENVIRONMENT');
  for (const key of ['Volumes', 'ExposedPorts']) if (runtime[key] !== undefined && runtime[key] !== null && (typeof runtime[key] !== 'object' || Array.isArray(runtime[key]) || Object.keys(runtime[key] as object).length !== 0)) fail('MCP_CONTAINER_IMAGE_DEFAULT');
  if (runtime.Healthcheck !== undefined && runtime.Healthcheck !== null) fail('MCP_CONTAINER_IMAGE_DEFAULT');
  if (runtime.OnBuild !== undefined && runtime.OnBuild !== null && list(runtime.OnBuild, 0).length) fail('MCP_CONTAINER_IMAGE_DEFAULT');
  if (runtime.ArgsEscaped !== undefined && runtime.ArgsEscaped !== false) fail('MCP_CONTAINER_IMAGE_DEFAULT');
  for (const key of ['Entrypoint', 'Cmd']) if (runtime[key] !== undefined && runtime[key] !== null) for (const arg of list(runtime[key], 32)) text(arg, 8192, true);
  for (const key of ['User', 'WorkingDir', 'StopSignal']) if (runtime[key] !== undefined) text(runtime[key], 2048, true);
  annotations(runtime.Labels);
}
function frozen<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; }

/** Pure policy only: never contacts Docker, grants approval, or proves runtime containment. */
export function planMcpContainerLaunch(value: McpContainerPlanInput): McpContainerPlan {
  try {
    const input = record(data(value), ['spec', 'imageIndexJson', 'imageManifestJson', 'imageConfigJson', 'synthetic']);
    if (input.synthetic !== true) fail('MCP_CONTAINER_SYNTHETIC_REQUIRED');
    const selected = spec(input.spec); verifyArtifacts(input, selected);
    const l = selected.limits, u = selected.user;
    const argv = ['container', 'create', '--pull=never', '--name', 'bowerloom-mcp-' + selected.operationKey.slice(7), '--label', 'ai.bowerloom.mcp.operation=' + selected.operationKey,
      '--platform', selected.platform, '--init', '--user', `${u.uid}:${u.gid}`, '--network', 'none', '--ipc', 'private', '--cgroupns', 'private', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--security-opt', 'seccomp=builtin',
      '--memory', String(l.memoryBytes), '--memory-swap', String(l.memoryBytes), '--pids-limit', String(l.pids), '--cpus', (l.cpuMillis / 1000).toFixed(3), '--shm-size', String(l.shmBytes), '--restart', 'no', '--log-driver', 'none', '--stop-timeout', '1', '--stop-signal', 'SIGTERM', '--no-healthcheck',
      '--ulimit', 'core=0:0', '--ulimit', 'nofile=64:64', '--tmpfs', `/scratch:rw,noexec,nosuid,nodev,size=${l.scratchBytes},mode=0700,uid=${u.uid},gid=${u.gid}`, '--workdir', selected.workingDirectory, '--entrypoint', selected.entrypoint,
      '--', selected.imageIndexDigest, ...selected.args];
    const body = { format: 'bowerloom/mcp-container-plan/v1beta1' as const, contentScope: 'private-local-plan' as const, spec: selected, argv, executionAuthorized: false as const, containmentVerified: false as const, transportVerified: false as const, grants: [] as [] };
    return frozen({ ...body, revision: 'sha256:' + sha256(canonicalJson(body)) });
  } catch (error) {
    const codes = ['MCP_CONTAINER_FIELDS', 'MCP_CONTAINER_LIMIT', 'MCP_CONTAINER_TEXT', 'MCP_CONTAINER_DIGEST', 'MCP_CONTAINER_BOUND', 'MCP_CONTAINER_PATH', 'MCP_CONTAINER_ENVIRONMENT', 'MCP_CONTAINER_PLATFORM', 'MCP_CONTAINER_METADATA', 'MCP_CONTAINER_ARTIFACT', 'MCP_CONTAINER_IMAGE_DEFAULT', 'MCP_CONTAINER_SYNTHETIC_REQUIRED'];
    return fail(error instanceof McpConnectionError && codes.includes(error.code) ? error.code : 'MCP_CONTAINER_INPUT');
  }
}
