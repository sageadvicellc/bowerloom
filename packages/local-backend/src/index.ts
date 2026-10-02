import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, closeSync, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:net';
import pg from 'pg';
import { CREDENTIAL_KEYS, IMAGES, JWT_SQL, PROFILE_VERSION, composeProfile, gatewayProfile, rolesSql } from './profile.js';
import type { Credentials } from './profile.js';

export const FORMAT = 'bowerloom/local-backend/v1alpha1' as const;
export const DOCKER_INSTALL_URL = 'https://docs.docker.com/desktop/setup/install/mac-install/';
const GiB = 1024 ** 3;
const RESERVE = 12 * GiB, GROWTH = 4 * GiB;
const ARTIFACTS = ['compose.json', 'credentials.json', 'stack.env', 'gateway.json', 'roles.sql', 'jwt.sql'] as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
export class BackendError extends Error { constructor(public readonly code: string) { super(code); this.name = 'BackendError'; } }
function fail(code: string): never { throw new BackendError(code); }
export interface DockerResult { code: number; stdout: string }
export type DockerRunner = (args: string[], timeoutMs: number) => Promise<DockerResult>;
export interface BackendInput { rootDir: string; studioPort?: number; databasePort?: number }
export interface Readiness { postgresAuthenticated: true; studioAuthenticated: true; metadataAuthenticated: true; studioRejectsUnauthenticated: true; restReady: true; postgresVersion: string }
export interface Dependencies {
  runner?: DockerRunner; platform?: string; freeBytes?: (path: string) => number;
  portsAvailable?: (ports: number[]) => Promise<boolean>;
  readiness?: (plan: BackendPlan, credentials: Credentials) => Promise<Readiness>;
}
export interface DockerIdentity { endpoint: string; daemonId: string; architecture: 'aarch64' | 'arm64'; composeVersion: string }
export interface DoctorResult { ready: boolean; reason: string; dockerInstallUrl: string; supportedPlatform: 'macOS / Docker Desktop / ARM64'; identity?: DockerIdentity; cachedImages?: string[] }
export interface BackendPlan {
  format: typeof FORMAT; profileVersion: string; templateDigest: string; rootDir: string; project: string; identity: DockerIdentity;
  studioPort: number; databasePort: number; studioUrl: string; images: typeof IMAGES; downloads: string[];
  reserveBytes: number; growthBudgetBytes: number; minimumFreeBytes: number; generatedFiles: readonly string[];
  runtimeProvisioned: false; modelsStarted: false; cloudSupported: false; revision: string;
}
interface InstallationRecord { format: typeof FORMAT; plan: BackendPlan; artifacts: Record<string, string>; state: 'prepared' | 'starting' | 'ready' | 'failed'; failure?: string; readiness?: Readiness }
const controlCredentials: Credentials = { POSTGRES_PASSWORD: '0'.repeat(48), JWT_SECRET: '0'.repeat(64), ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'service', PG_META_CRYPTO_KEY: '0'.repeat(64), DASHBOARD_USERNAME: 'bowerloom', DASHBOARD_PASSWORD: '0'.repeat(48) };
const templateDigest = () => hash(canonical({ compose: composeProfile({ project: 'bowerloom-placeholder', revision: '0'.repeat(64), databasePort: 57582, studioPort: 57581 }), gateway: gatewayProfile(controlCredentials), roles: rolesSql(controlCredentials.POSTGRES_PASSWORD), jwt: JWT_SQL }));

async function docker(args: string[], timeoutMs: number): Promise<DockerResult> {
  const binary = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker'].find(path => existsSync(path));
  if (!binary) fail('DOCKER_NOT_INSTALLED');
  return new Promise((res, rej) => {
    const child = spawn(binary!, args, { env: { HOME: homedir(), PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', bytes = 0, failure: string | undefined;
    const stop = (code: string) => { failure = code; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('DOCKER_TIMEOUT'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) stop('DOCKER_OUTPUT_LIMIT'); else out += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) stop('DOCKER_OUTPUT_LIMIT'); });
    child.once('error', () => { clearTimeout(timer); rej(new BackendError('DOCKER_UNAVAILABLE')); });
    child.once('close', code => { clearTimeout(timer); if (failure) rej(new BackendError(failure)); else res({ code: code ?? 1, stdout: out }); });
  });
}
const run = (deps: Dependencies) => deps.runner ?? docker;
const freeBytes = (path: string, deps: Dependencies): number => { if (deps.freeBytes) return deps.freeBytes(path); const stat = statfsSync(path); return stat.bavail * stat.bsize; };
function parse(text: string): unknown { try { return JSON.parse(text); } catch { return fail('INVALID_DOCKER_RESPONSE'); } }
export async function doctorBackend(deps: Dependencies = {}): Promise<DoctorResult> {
  const result: DoctorResult = { ready: false, reason: 'DOCKER_NOT_READY', dockerInstallUrl: DOCKER_INSTALL_URL, supportedPlatform: 'macOS / Docker Desktop / ARM64' };
  if ((deps.platform ?? process.platform) !== 'darwin') return { ...result, reason: 'UNSUPPORTED_PLATFORM' };
  try {
    const context = await run(deps)(['context', 'inspect', 'desktop-linux', '--format', '{{json .Endpoints.docker.Host}}'], 5000);
    if (context.code) return { ...result, reason: 'DOCKER_DESKTOP_CONTEXT_MISSING' };
    const endpoint = parse(context.stdout);
    if (typeof endpoint !== 'string' || !/^unix:\/\/[A-Za-z0-9_/. -]+$/.test(endpoint) || !endpoint.endsWith('.sock') || endpoint.includes('/../')) return { ...result, reason: 'REMOTE_DOCKER_FORBIDDEN' };
    const info = await run(deps)(['--host', endpoint, 'info', '--format', '{{json .}}'], 5000);
    if (info.code) return result;
    const value = parse(info.stdout) as Record<string, unknown>;
    if (!value || value.OSType !== 'linux' || !['aarch64', 'arm64'].includes(String(value.Architecture)) || typeof value.ID !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value.ID)) return { ...result, reason: 'UNSUPPORTED_DOCKER_ENGINE' };
    const version = await run(deps)(['--host', endpoint, 'compose', 'version', '--short'], 5000);
    if (version.code || !/^v?2\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?\s*$/.test(version.stdout)) return { ...result, reason: 'COMPOSE_V2_REQUIRED' };
    const cachedImages: string[] = [];
    for (const image of Object.values(IMAGES)) {
      const inspected = await run(deps)(['--host', endpoint, 'image', 'inspect', image, '--format', '{{json .RepoDigests}}'], 5000);
      if (inspected.code === 0) { const digests = parse(inspected.stdout); if (!Array.isArray(digests) || !digests.includes(image)) return { ...result, reason: 'IMAGE_DIGEST_MISMATCH' }; cachedImages.push(image); }
    }
    return { ...result, ready: true, reason: 'READY', identity: { endpoint, daemonId: value.ID, architecture: value.Architecture as 'aarch64' | 'arm64', composeVersion: version.stdout.trim() }, cachedImages };
  } catch (error) { return { ...result, reason: error instanceof BackendError ? error.code : 'DOCKER_UNAVAILABLE' }; }
}
function safeDirectory(path: string, leafMayBeMissing = false): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('ABSOLUTE_ROOT_REQUIRED');
  const root = resolve(path);
  if (root !== path || root !== root.normalize('NFC')) fail('CANONICAL_ROOT_REQUIRED');
  let cursor: string = sep;
  const segments = root.split(sep).slice(1);
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    try { const stat = lstatSync(cursor); if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_ROOT_PATH'); }
    catch (error) { if (leafMayBeMissing && index === segments.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return root; throw error; }
  }
  return root;
}
function newRoot(path: string): string {
  const root = safeDirectory(path, true);
  const folded = root.normalize('NFC').toLowerCase();
  if (folded === homedir().normalize('NFC').toLowerCase() || root === sep || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(basename(root)) || folded.split(sep).some(segment => ['.git', '.agents', '.codex', '.config', 'node_modules', 'library'].includes(segment))
    || ['/usr', '/etc', '/bin', '/sbin', '/opt', '/system', '/library', '/applications'].some(prefix => folded === prefix || folded.startsWith(prefix + '/'))) fail('UNSAFE_INSTALL_ROOT');
  if (existsSync(root)) fail('INSTALL_ROOT_EXISTS');
  const parent = lstatSync(dirname(root));
  if (parent.uid !== process.getuid?.() || (parent.mode & 0o022)) fail('PRIVATE_PARENT_REQUIRED');
  return root;
}
async function portsAvailable(ports: number[]): Promise<boolean> {
  const servers = ports.map(() => createServer());
  try { const outcomes = await Promise.allSettled(servers.map((server, index) => new Promise<void>((res, rej) => { server.once('error', rej); server.listen({ host: '127.0.0.1', port: ports[index]!, exclusive: true }, res); }))); return outcomes.every(outcome => outcome.status === 'fulfilled'); }
  catch { return false; }
  finally { await Promise.all(servers.map(server => new Promise<void>(res => { if (server.listening) server.close(() => res()); else res(); }))); }
}
function port(value: unknown, fallback: number): number { const p = value === undefined ? fallback : value; if (!Number.isInteger(p) || (p as number) < 1024 || (p as number) > 65535) fail('INVALID_PORT'); return p as number; }
function projectName(root: string): string { return `bowerloom-${hash(root).slice(0, 20)}`; }
async function assertNoResources(identity: DockerIdentity, project: string, deps: Dependencies): Promise<void> {
  for (const args of [['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}'], ['volume', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Name}}'], ['network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}']]) {
    const result = await run(deps)(['--host', identity.endpoint, ...args], 5000);
    if (result.code) fail('RESOURCE_INSPECTION_FAILED'); if (result.stdout.trim()) fail('PROJECT_ALREADY_EXISTS');
  }
  for (const resource of resourceNames(project)) {
    const result = await run(deps)(resourceInspectArgs(identity, resource), 5000);
    if (result.code === 0) fail('PROJECT_NAME_COLLISION');
  }
}

type ResourceName = { kind: 'container' | 'volume' | 'network'; name: string; service?: string };
function resourceNames(project: string): ResourceName[] {
  return [...Object.keys(IMAGES).map(service => ({ kind: 'container' as const, name: `${project}-${service}-1`, service })),
    { kind: 'volume', name: `${project}_data` }, { kind: 'volume', name: `${project}_db-config` }, { kind: 'network', name: `${project}_default` }];
}
function resourceInspectArgs(identity: DockerIdentity, resource: ResourceName): string[] {
  return ['--host', identity.endpoint, resource.kind, 'inspect', resource.name, '--format', resource.kind === 'container' ? '{{json .Config.Labels}}' : '{{json .Labels}}'];
}
async function ownedResources(plan: BackendPlan, deps: Dependencies): Promise<boolean> {
  let complete = true;
  for (const resource of resourceNames(plan.project)) {
    const result = await run(deps)(resourceInspectArgs(plan.identity, resource), 5000);
    if (result.code) { complete = false; continue; }
    const labels = parse(result.stdout) as Record<string, unknown>;
    if (!labels || labels['com.docker.compose.project'] !== plan.project || labels['io.bowerloom.local-backend'] !== plan.project || labels['io.bowerloom.plan-revision'] !== plan.revision
      || (resource.service && labels['com.docker.compose.service'] !== resource.service)) fail('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return complete;
}
function disk(root: string, deps: Dependencies): void { const available = freeBytes(dirname(root), deps); if (!Number.isFinite(available) || available < RESERVE + GROWTH) fail('DISK_RESERVE_REQUIRED'); }
export async function planBackend(input: BackendInput, deps: Dependencies = {}): Promise<BackendPlan> {
  if (!input || Object.keys(input).some(key => !['rootDir', 'studioPort', 'databasePort'].includes(key))) fail('BACKEND_INPUT');
  const rootDir = newRoot(input.rootDir), studioPort = port(input.studioPort, 57581), databasePort = port(input.databasePort, 57582);
  if (studioPort === databasePort) fail('PORT_COLLISION');
  disk(rootDir, deps);
  const doctor = await doctorBackend(deps); if (!doctor.ready || !doctor.identity) fail(doctor.reason);
  const project = projectName(rootDir);
  await assertNoResources(doctor.identity, project, deps);
  if (!await (deps.portsAvailable ?? portsAvailable)([studioPort, databasePort])) fail('PORT_IN_USE');
  const body = { format: FORMAT, profileVersion: PROFILE_VERSION, templateDigest: templateDigest(), rootDir, project, identity: doctor.identity,
    studioPort, databasePort, studioUrl: `http://127.0.0.1:${studioPort}/project/default`, images: IMAGES,
    downloads: Object.values(IMAGES).filter(image => !doctor.cachedImages?.includes(image)), reserveBytes: RESERVE, growthBudgetBytes: GROWTH, minimumFreeBytes: RESERVE + GROWTH,
    generatedFiles: [...ARTIFACTS, 'installation.json'], runtimeProvisioned: false as const, modelsStarted: false as const, cloudSupported: false as const };
  return { ...body, revision: hash(canonical(body)) };
}
function credentials(): Credentials {
  const jwtSecret = randomBytes(32).toString('hex');
  const jwt = (role: string): string => {
    const body = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 86400 })).toString('base64url')].join('.');
    return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`;
  };
  return { POSTGRES_PASSWORD: randomBytes(24).toString('hex'), JWT_SECRET: jwtSecret, ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: jwt('service_role'), PG_META_CRYPTO_KEY: randomBytes(32).toString('hex'), DASHBOARD_USERNAME: 'bowerloom', DASHBOARD_PASSWORD: randomBytes(24).toString('hex') };
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
function composeArgs(plan: BackendPlan): string[] { return ['--host', plan.identity.endpoint, 'compose', '--project-name', plan.project, '--project-directory', plan.rootDir, '--env-file', join(plan.rootDir, 'stack.env'), '-f', join(plan.rootDir, 'compose.json')]; }
function privateText(path: string): string {
  safeDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd); if (!before.isFile() || before.uid !== process.getuid?.() || (before.mode & 0o077) || before.nlink !== 1 || before.size > 256 * 1024) fail('PRIVATE_FILE_REQUIRED');
    const buffer = Buffer.alloc(256 * 1024 + 1); let length = 0;
    while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(fd); if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('INSTALLATION_CHANGED');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } finally { closeSync(fd); }
}
function readRecord(rootDir: string): InstallationRecord {
  const root = safeDirectory(rootDir), stat = lstatSync(root);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o077)) fail('PRIVATE_ROOT_REQUIRED');
  let record: InstallationRecord;
  try { record = JSON.parse(privateText(join(root, 'installation.json'))) as InstallationRecord; } catch (error) { if (error instanceof BackendError) throw error; return fail('INVALID_INSTALLATION'); }
  const plan = record.plan;
  if (!plan || record.format !== FORMAT || plan.format !== FORMAT || plan.rootDir !== root || plan.project !== projectName(root) || !/^[a-f0-9]{64}$/.test(plan.revision)) fail('INVALID_INSTALLATION');
  const { revision, ...body } = plan;
  if (hash(canonical(body)) !== revision || plan.templateDigest !== templateDigest() || canonical(plan.images) !== canonical(IMAGES) || plan.profileVersion !== PROFILE_VERSION || plan.runtimeProvisioned !== false || plan.modelsStarted !== false || plan.cloudSupported !== false) fail('INSTALLATION_CHANGED');
  if (port(plan.databasePort, 0) === port(plan.studioPort, 0) || plan.studioUrl !== `http://127.0.0.1:${plan.studioPort}/project/default`) fail('INVALID_INSTALLATION');
  if (!record.artifacts || Object.keys(record.artifacts).sort().join() !== [...ARTIFACTS].sort().join()) fail('INVALID_INSTALLATION');
  for (const name of ARTIFACTS) if (hash(privateText(join(root, name))) !== record.artifacts[name]) fail('INSTALLATION_CHANGED');
  return record;
}
async function readiness(plan: BackendPlan, secret: Credentials): Promise<Readiness> {
  const client = new pg.Client({ host: '127.0.0.1', port: plan.databasePort, database: 'postgres', user: 'postgres', password: secret.POSTGRES_PASSWORD, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 5000, application_name: 'bowerloom_backend_health' });
  let version = '';
  try { await client.connect(); const result = await client.query("SELECT current_database() AS database, current_setting('server_version_num') AS version"); if (result.rows[0]?.database !== 'postgres' || !/^[0-9]{5,6}$/.test(result.rows[0]?.version)) fail('POSTGRES_HEALTH_FAILED'); version = result.rows[0].version; }
  catch { fail('POSTGRES_HEALTH_FAILED'); } finally { await client.end().catch(() => undefined); }
  const anonymous = await fetch(`http://127.0.0.1:${plan.studioPort}/project/default`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  await anonymous.body?.cancel();
  if (anonymous.status !== 401) fail('STUDIO_AUTH_GATE_FAILED');
  for (const path of ['/project/default', '/api/platform/profile', '/api/platform/pg-meta/default/tables']) {
    const response = await fetch(`http://127.0.0.1:${plan.studioPort}${path}`, { headers: { Authorization: 'Basic ' + Buffer.from(`${secret.DASHBOARD_USERNAME}:${secret.DASHBOARD_PASSWORD}`).toString('base64') }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.status !== 200) { await response.body?.cancel(); fail('STUDIO_HEALTH_FAILED'); }
    await response.body?.cancel();
  }
  const rest = await fetch(`http://127.0.0.1:${plan.studioPort}/rest/v1/`, { headers: { Authorization: `Bearer ${secret.ANON_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  await rest.body?.cancel();
  if (rest.status !== 200) fail('REST_HEALTH_FAILED');
  return { postgresAuthenticated: true, studioAuthenticated: true, metadataAuthenticated: true, studioRejectsUnauthenticated: true, restReady: true, postgresVersion: version };
}
function readCredentials(root: string): Credentials {
  const value = JSON.parse(privateText(join(root, 'credentials.json'))) as Credentials;
  if (Object.keys(value).sort().join() !== [...CREDENTIAL_KEYS].sort().join() || CREDENTIAL_KEYS.some(key => typeof value[key] !== 'string' || !value[key] || value[key].length > 4096)) fail('INVALID_CREDENTIALS');
  return value;
}
async function sameDaemon(plan: BackendPlan, deps: Dependencies): Promise<void> {
  const observed = await doctorBackend(deps);
  if (!observed.ready || canonical(observed.identity) !== canonical(plan.identity)) fail('DOCKER_IDENTITY_CHANGED');
}
function saveRecord(record: InstallationRecord): void {
  const path = join(record.plan.rootDir, 'installation.json');
  const fd = openSync(path, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) fail('PRIVATE_FILE_REQUIRED'); const text = json(record); writeFileSync(fd, text); ftruncateSync(fd, Buffer.byteLength(text)); }
  finally { closeSync(fd); }
}
export async function installBackend(input: BackendInput, approvalRevision: string, deps: Dependencies = {}): Promise<object> {
  if (!/^[a-f0-9]{64}$/.test(approvalRevision)) fail('EXACT_APPROVAL_REQUIRED');
  const plan = await planBackend(input, deps); if (plan.revision !== approvalRevision) fail('STALE_APPROVAL');
  newRoot(input.rootDir); mkdirSync(plan.rootDir, { mode: 0o700 });
  const secret = credentials();
  const files: Record<string, string> = { 'compose.json': json(composeProfile({ ...plan })), 'credentials.json': json(secret), 'stack.env': CREDENTIAL_KEYS.map(key => `${key}=${secret[key]}\n`).join(''), 'gateway.json': json(gatewayProfile(secret)), 'roles.sql': rolesSql(secret.POSTGRES_PASSWORD), 'jwt.sql': JWT_SQL };
  const record: InstallationRecord = { format: FORMAT, plan, artifacts: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, hash(text)])), state: 'prepared' };
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(plan.rootDir, name), text, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(plan.rootDir, 'installation.json'), json(record), { flag: 'wx', mode: 0o600 });
    for (const image of plan.downloads) {
      readRecord(plan.rootDir); disk(plan.rootDir, deps);
      const pull = await run(deps)(['--host', plan.identity.endpoint, 'pull', image], 300000); if (pull.code) fail('IMAGE_PULL_FAILED');
      disk(plan.rootDir, deps);
    }
    readRecord(plan.rootDir); await sameDaemon(plan, deps); await assertNoResources(plan.identity, plan.project, deps);
    if (!await (deps.portsAvailable ?? portsAvailable)([plan.studioPort, plan.databasePort])) fail('PORT_IN_USE');
    disk(plan.rootDir, deps); record.state = 'starting'; saveRecord(record);
    const result = await run(deps)([...composeArgs(plan), 'up', '--detach', '--wait', '--wait-timeout', '120', '--pull', 'never'], 150000);
    if (result.code) fail('BACKEND_START_FAILED');
    if (!await ownedResources(plan, deps)) fail('OWNED_RESOURCES_MISSING');
    if (freeBytes(dirname(plan.rootDir), deps) < RESERVE) fail('DISK_RESERVE_REQUIRED');
    readRecord(plan.rootDir); const ready = await (deps.readiness ?? readiness)(plan, secret);
    record.state = 'ready'; record.readiness = ready; saveRecord(record);
    return { status: 'ready', revision: plan.revision, rootDir: plan.rootDir, project: plan.project, studioUrl: plan.studioUrl, database: { host: '127.0.0.1', port: plan.databasePort, name: 'postgres' }, readiness: ready, hostFreeBytesAfter: freeBytes(dirname(plan.rootDir), deps), credentialsFile: join(plan.rootDir, 'credentials.json'), runtimeProvisioned: false, modelsStarted: false, cloudSupported: false };
  } catch (error) {
    const code = error instanceof BackendError ? error.code : 'BACKEND_INSTALL_FAILED';
    try { record.state = 'failed'; record.failure = code; saveRecord(record); } catch { /* Preserve partial private state for inspection. */ }
    // Never destroy containers, volumes, images, or a partial installation after a failure.
    throw new BackendError(code);
  }
}
export async function statusBackend(rootDir: string, deps: Dependencies = {}): Promise<object> {
  const record = readRecord(rootDir); await sameDaemon(record.plan, deps);
  const result = await run(deps)([...composeArgs(record.plan), 'ps', '--format', 'json'], 10000);
  if (result.code) fail('BACKEND_STATUS_FAILED');
  const owned = await ownedResources(record.plan, deps);
  let current: Readiness | null = null;
  try { if (owned) current = await (deps.readiness ?? readiness)(record.plan, readCredentials(rootDir)); } catch { /* Stored readiness never substitutes for a fresh observation. */ }
  return { recordedState: record.state, ownedResourcesComplete: owned, hostFreeBytes: freeBytes(dirname(record.plan.rootDir), deps), ready: current !== null, readiness: current, revision: record.plan.revision, project: record.plan.project, studioUrl: record.plan.studioUrl, credentialsFile: join(rootDir, 'credentials.json'), runtimeProvisioned: false, modelsStarted: false, cloudSupported: false };
}
