// Test tooling, never shipped. A static npm registry: a small web server on 127.0.0.1 that serves package records and tarballs from
// files. It answers GET and nothing else, so nothing can be written to it. Every other method gets 405.
//
//   const registry = await startRegistry({ packages: [{ file: '/path/to/a-1.0.0.tgz' }] });
//   registry.url        // http://127.0.0.1:<port>
//   registry.requests   // one row per request: method, path, remote address, status
//   await registry.close();
//
// A package record is built from the package.json inside each tarball and from the integrity and the shasum of its bytes. A caller
// may pass the entry of `npm pack --json` as `pack`: the registry then checks that its integrity and shasum match the bytes.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

/** Reads the text of one file from a gzipped tar archive held in memory. Returns null when the archive has no such file. */
function readTarEntry(archive, wanted) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) return null;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    let name = field(0, 100);
    const prefix = field(345, 155);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    offset += 512;
    const body = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x' || type === 'g') continue;
    if (longName !== null) { name = longName; longName = null; } else if (prefix) name = `${prefix}/${name}`;
    if (name === wanted && (type === '0' || type === '')) return body.toString('utf8');
  }
  return null;
}

/** Reads `package/package.json` from a tarball file and returns it as an object. Throws when it is missing or is not JSON. */
export function readManifest(file) {
  const text = readTarEntry(zlib.gunzipSync(fs.readFileSync(file)), 'package/package.json');
  if (text === null) throw new Error(`${file} has no package/package.json`);
  const manifest = JSON.parse(text);
  if (manifest === null || typeof manifest !== 'object' || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${file} has a package.json without a name and a version`);
  }
  return manifest;
}

/** The integrity (sha512, in the form that npm uses) and the shasum (sha1, hex) of some bytes. */
export function digestsOf(bytes) {
  return {
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'),
  };
}

/** Compares two versions of the form major.minor.patch with an optional dash part. Enough to find the newest one. */
function compareVersions(a, b) {
  const parse = value => {
    const [core, pre] = value.split(/-(.*)/s);
    return { nums: core.split('.').map(Number), pre: pre === undefined ? null : pre.split('.') };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) if (left.nums[i] !== right.nums[i]) return left.nums[i] - right.nums[i];
  if (left.pre === null || right.pre === null) return left.pre === right.pre ? 0 : left.pre === null ? 1 : -1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const bothNumbers = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (bothNumbers && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (!bothNumbers && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Starts the registry. `packages` is a list of `{ file, pack? }`. `tags` maps a package name to its dist-tags, for example
 * `{ bowerloom: { latest: '0.9.0-beta.1' } }`. A package with no `latest` tag gets its newest version.
 * It listens on `host` (127.0.0.1 unless a test says otherwise) and on `port` (a free one by default).
 */
export async function startRegistry({ packages, tags = {}, host = '127.0.0.1', port = 0 }) {
  const byName = new Map();
  const files = new Map();
  for (const entry of packages) {
    const bytes = fs.readFileSync(entry.file);
    const digests = digestsOf(bytes);
    if (entry.pack !== undefined && (entry.pack.integrity !== digests.integrity || entry.pack.shasum !== digests.shasum)) {
      throw new Error(`${entry.file}: the integrity or the shasum of npm pack does not match the bytes`);
    }
    const manifest = readManifest(entry.file);
    const versions = byName.get(manifest.name) ?? new Map();
    if (versions.has(manifest.version)) throw new Error(`${manifest.name}@${manifest.version} is listed twice`);
    versions.set(manifest.version, { manifest, ...digests, filename: path.basename(entry.file), file: entry.file });
    byName.set(manifest.name, versions);
    files.set(`${manifest.name}/-/${path.basename(entry.file)}`, entry.file);
  }

  const requests = [];
  const respond = (req, res, status, headers, body) => {
    requests.push({ method: req.method, path: req.url, remote: req.socket.remoteAddress ?? null, status });
    res.writeHead(status, headers);
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      // Read and drop any request body first, so the connection is not reset while the client is still sending.
      req.resume();
      respond(req, res, 405, { allow: 'GET', connection: 'close', 'content-type': 'application/json' }, JSON.stringify({ error: 'method not allowed: this registry answers GET only' }));
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    } catch {
      respond(req, res, 400, { 'content-type': 'application/json' }, JSON.stringify({ error: 'bad path' }));
      return;
    }
    const tarball = files.get(pathname);
    if (tarball !== undefined) {
      const bytes = fs.readFileSync(tarball);
      requests.push({ method: req.method, path: req.url, remote: req.socket.remoteAddress ?? null, status: 200 });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      res.end(bytes);
      return;
    }
    const versions = byName.get(pathname);
    if (versions === undefined) {
      respond(req, res, 404, { 'content-type': 'application/json' }, JSON.stringify({ error: 'not found' }));
      return;
    }
    const base = `http://${host}:${server.address().port}`;
    const record = { _id: pathname, name: pathname, 'dist-tags': {}, versions: {} };
    for (const [version, found] of versions) {
      const scripts = found.manifest.scripts ?? {};
      const hasInstallScript = ['preinstall', 'install', 'postinstall'].some(key => typeof scripts[key] === 'string');
      record.versions[version] = {
        ...found.manifest,
        _id: `${pathname}@${version}`,
        ...(hasInstallScript ? { hasInstallScript: true } : {}),
        dist: { tarball: `${base}/${pathname}/-/${found.filename}`, integrity: found.integrity, shasum: found.shasum },
      };
    }
    const newest = [...versions.keys()].sort(compareVersions).at(-1);
    record['dist-tags'] = { latest: newest, ...(tags[pathname] ?? {}) };
    respond(req, res, 200, { 'content-type': 'application/json' }, JSON.stringify(record));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    requests,
    packages: Object.fromEntries([...byName].map(([name, versions]) => [name, [...versions.keys()]])),
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
