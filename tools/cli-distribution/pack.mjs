#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants as fsConstants, openSync, closeSync, fstatSync, readSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, statfsSync, statSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { parseAst } from 'rolldown/parseAst';
import { UnpackSync, list as listTar } from 'tar';
export const MODULES = Object.freeze(['admission','authoring','broker','broker-postgres','codex-adapter','connections','contracts','controlled-tests','crew','graph','harness-portability','linux-browser','local-backend','local-control','mcp-connections','portable','recipes','roots','routines','runtime','runtime-bridge','skill-sources','managed-skills','project-context','project-authoring','skill-manifest','project-sync','startup','workbench','workspace-effects']);
export const ASSETS = Object.freeze(['release/beta.json','packages/linux-browser/assets/runner.cjs','packages/linux-browser/assets/seccomp.json','packages/linux-browser/assets/runtime-manifest.json','packages/linux-browser/assets/craft-shop-contract.md','packages/linux-browser/PLAYWRIGHT-LICENSE.txt','packages/linux-browser/IMPORT-MANIFEST.json','packages/local-backend/THIRD_PARTY_NOTICES.md','packages/local-backend/licenses/supabase-Apache-2.0.txt']);
export const CANONICAL_URLS = Object.freeze({site:'https://bowerloom.ai',docs:'https://bowerloom.ai/docs/',repository:'https://github.com/sageadvicellc/bowerloom'});
const ENTRY = ['dist/apps/cli/src/main.js','dist/apps/mcp/src/main.js'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw new Error(message); };
const byName = (a,b) => a.localeCompare(b);
function regular(root, path) {
  const full = join(root,path);
  if (!isAbsolute(root) || resolve(full) !== full || relative(root,full).startsWith('..')) fail('Unsafe source path');
  let current = root;
  for (const part of path.split('/')) { current = join(current,part); if (lstatSync(current).isSymbolicLink()) fail('Source symlink refused: '+path); }
  const info = lstatSync(full);
  if (!info.isFile() || info.size > 2 ** 20 || info.nlink !== 1) fail('Unsafe or oversized source: '+path);
  return readFileSync(full);
}
function allowed(path) {
  return /^dist\/apps\/(cli|mcp)\/src\/[a-z0-9-]+\.js$/.test(path) || MODULES.some(name => path.startsWith(`dist/packages/${name}/src/`) && /^[a-zA-Z0-9_./-]+\.js$/.test(path) && !path.includes('/test'));
}
const dependencyName = spec => spec.startsWith('@') ? spec.split('/').slice(0,2).join('/') : spec.split('/')[0];
export function imports(text, path) {
  const ast = parseAst(text), result = [];
  function add(node) { if (!node || node.type !== 'Literal' || typeof node.value !== 'string') fail('Nonliteral runtime import: '+path); result.push(node.value); }
  function visit(node) {
    if (node.type === 'ImportDeclaration' || ['ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) && node.source) add(node.source);
    if (node.type === 'ImportExpression') add(node.source);
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') add(node.arguments[0]);
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && node.arguments.length === 2 && typeof node.arguments[0]?.value === 'string' && node.arguments[0].value.startsWith('.') && node.arguments[0].value.endsWith('.js')) result.push(node.arguments[0].value);
    for (const value of Object.values(node)) { if(Array.isArray(value)) { for(const child of value) if(child?.type) visit(child); } else if(value?.type) visit(value); }
  }
  visit(ast); return result;
}
// The root entry of a shrinkwrap, built from a manifest. optionalDependencies appears only when it holds a pin.
const rootEntry = manifest => ({name:manifest.name,version:manifest.version,license:manifest.license,dependencies:manifest.dependencies,...(manifest.optionalDependencies && Object.keys(manifest.optionalDependencies).length ? {optionalDependencies:manifest.optionalDependencies} : {}),bin:manifest.bin,engines:manifest.engines});
// An npm package name, and a lock path made only of such names. A name never starts a segment with a dot, so no path leaves node_modules.
const SEGMENT = '[A-Za-z0-9_~-][A-Za-z0-9._~-]*', NAME = `(?:@${SEGMENT}/)?${SEGMENT}`;
const NAME_RE = new RegExp(`^${NAME}$`), LOCK_PATH_RE = new RegExp(`^node_modules/${NAME}(?:/node_modules/${NAME})*$`);
export function lockedDependencies(lock, dependencies, manifest) {
  if(lock.lockfileVersion !== 3 || !lock.packages) fail('Expected npm lockfile v3');
  const chosen = {}, queue = [];
  function locate(from, name, optional=false) {
    let directory = from;
    for (;;) {
      const path = directory ? directory+'/node_modules/'+name : 'node_modules/'+name;
      if (lock.packages[path]) return path;
      if (!directory) break;
      directory = dirname(directory); if(directory==='.') directory='';
    }
    if(optional) return null;
    fail('Missing locked runtime dependency: '+name);
  }
  for(const [name,version] of Object.entries(dependencies)) {
    if(!NAME_RE.test(name)) fail('Bundle path unsafe: '+name);
    const path=locate('',name); if(lock.packages[path].version!==version) fail('Direct dependency lock mismatch: '+name); queue.push(path);
  }
  while(queue.length) {
    const path=queue.shift(); if(chosen[path]) continue;
    if(!LOCK_PATH_RE.test(path)) fail('Bundle path unsafe: '+path);
    const item=lock.packages[path];
    if(item.link || !/^https:\/\/registry\.npmjs\.org\//.test(item.resolved??'') || !/^sha512-/.test(item.integrity??'')) fail('Nonregistry or unpinned dependency: '+path);
    // Security freeze info 5: "no install scripts" is a checked rule, not an observation.
    if(Object.hasOwn(item,'hasInstallScript') && item.hasInstallScript!==false) fail('Locked dependency has an install script: '+path);
    const {dev,devOptional,workspaces,...entry}=item; chosen[path]=entry;
    for(const [name] of Object.entries({...item.dependencies,...item.optionalDependencies,...item.peerDependencies})) {
      if(!NAME_RE.test(name)) fail('Bundle path unsafe: '+name);
      const optional=Object.hasOwn(item.optionalDependencies??{},name) || item.peerDependenciesMeta?.[name]?.optional===true;
      const found=locate(path,name,optional); if(found) queue.push(found);
    }
  }
  return {name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':rootEntry(manifest),...Object.fromEntries(Object.entries(chosen).sort(([a],[b])=>a.localeCompare(b)))}};
}
// Every top-level lock entry becomes an exact pin, because npm ignores a packed shrinkwrap when it installs a tarball.
const EXACT = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
// A top-level lock path ends in one package name. The name comes from the anchored end of the path, never from a search inside it.
const TOP_PATH_RE = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/, NESTED_PATH_RE = /^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)+$/;
const PACKAGE_NAME_RE = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/;
export function flatDependencies(packages, direct) {
  for (const [name,version] of Object.entries(direct)) {
    const entry = packages['node_modules/'+name];
    if (!entry || entry.version !== version) fail('Pinned dependency differs from the lock: '+name);
  }
  const dependencies = {}, optionalDependencies = {};
  for (const path of Object.keys(packages).sort(byName)) {
    if (path === '') continue;
    const entry = packages[path], top = TOP_PATH_RE.exec(path);
    if (!top) { if (NESTED_PATH_RE.test(path)) continue; fail('Unpinnable dependency: '+path); }
    const name = top[1];
    if ((entry.name !== undefined && entry.name !== name) || entry.link || typeof entry.version !== 'string' || !EXACT.test(entry.version)) fail('Unpinnable dependency: '+path);
    (entry.optional === true ? optionalDependencies : dependencies)[name] = entry.version;
  }
  return { dependencies, optionalDependencies };
}
// The license gate. Seven ids pass; an SPDX expression of ids joined by OR and AND passes by its structure.
const LICENSES = Object.freeze(['MIT','ISC','Apache-2.0','BSD-2-Clause','BSD-3-Clause','0BSD','BlueOak-1.0.0']);
export function licenseAllowed(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  const tokens = value.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const isId = token => token !== undefined && !['(',')','OR','AND'].includes(token);
  function atom() {
    const token = tokens[at++];
    if (token === '(') { const inner = expression(); if (inner === null || tokens[at++] !== ')') return null; return inner; }
    return isId(token) ? LICENSES.includes(token) : null;
  }
  function term() {
    let result = atom(); if (result === null) return null;
    while (peek() === 'AND') { at++; const next = atom(); if (next === null) return null; result = result && next; }
    return result;
  }
  function expression() {
    let result = term(); if (result === null) return null;
    while (peek() === 'OR') { at++; const next = term(); if (next === null) return null; result = result || next; }
    return result;
  }
  const result = expression();
  return result === true && at === tokens.length;
}
// A public beta stream installs from npm under its dist-tag, named alike by the distribution and the npm block and
// never latest. A private archive (a colleague beta) installs the packed file and is never published; otherwise npm.
export function expectedInstallCommand(release, name, version) {
  const d = release.distribution;
  if (d === undefined) return `npm install --global ${name}@${version}`;
  if (d && d.kind === 'npm-beta-stream') {
    if (Object.keys(d).length !== 2 || typeof d.distTag !== 'string' || d.distTag !== release.npm?.distTag
      || !/^[a-z][a-z0-9-]*$/.test(d.distTag) || d.distTag === 'latest') return null;
    return `npm install -g ${name}@${d.distTag}`;
  }
  const archive = `${name}-${version}.tgz`;
  if (!d || Object.keys(d).length !== 3 || d.kind !== 'private-archive' || d.archive !== archive || d.npmPublication !== false || release.npm?.published !== false || release.state !== 'unreleased') return null;
  return `npm install -g ./${archive}`;
}
// Review finding 7: the heading above the install command is true for the record. A private archive is
// installed from the folder that holds it; a beta stream installs from npm; a plain npm record after publication.
export function installHeading(release) {
  if (release.distribution === undefined) return 'After publication:';
  if (release.distribution?.kind === 'npm-beta-stream') return 'Install it:';
  return 'Install it from the folder that holds the archive:';
}
export function collect({repoDir, name='bowerloom', releaseCandidate=false, bundle=false}) {
  if(typeof releaseCandidate !== 'boolean') fail('releaseCandidate must be boolean');
  if(typeof bundle !== 'boolean') fail('bundle must be boolean');
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) fail('Invalid npm package identity');
  const repo = realpathSync(repoDir), rootPackage = JSON.parse(regular(repo,'package.json'));
  const release = JSON.parse(regular(repo,'release/beta.json'));
  // null means the record carries no acceptable install command, so it never matches a missing one.
  const installCommand = expectedInstallCommand(release, name, rootPackage.version);
  if(installCommand === null || release.schema !== 'bowerloom/release/v1' || release.version !== rootPackage.version || rootPackage.name !== name
    || release.npm?.packageName !== name || !['unreleased','published'].includes(release.state)
    || release.npm.published !== (release.state === 'published')
    || release.npm.registry !== 'https://registry.npmjs.org'
    || release.npm.distTag !== 'beta'
    || release.npm.installCommand !== installCommand) fail('Release record does not match package identity');
  // The public package.json and README copy these links, so the record may carry only the canonical set.
  const urls = release.urls, canonicalKeys = Object.keys(CANONICAL_URLS);
  if(urls === null || typeof urls !== 'object' || Array.isArray(urls) || Object.getPrototypeOf(urls) !== Object.prototype
    || Object.keys(urls).length !== canonicalKeys.length || canonicalKeys.some(k => !Object.hasOwn(urls,k) || urls[k] !== CANONICAL_URLS[k])) fail('Release record URLs do not match the package identity');
  if(releaseCandidate && release.state !== 'unreleased') fail('Release candidate requires an unreleased record');
  // Security review finding 1: only an npm record (no distribution, or the npm-beta-stream form accepted above) is
  // packed as a public candidate (private:false, publishConfig). A private archive or any other kind never is.
  if(releaseCandidate && release.distribution !== undefined && release.distribution.kind !== 'npm-beta-stream') fail('Release candidate refused: a private archive or unknown distribution is never packed as an npm candidate');
  const versions = {}, manifests = [];
  for (const path of ['package.json',...['apps/cli','apps/mcp',...MODULES.map(n=>'packages/'+n)].map(n=>n+'/package.json')]) {
    // These explicit internal modules belong to the root MIT package; no standalone workspace is claimed.
    // If present, either manifest must undergo the normal license/dependency checks below.
    if (['packages/connections/package.json', 'packages/routines/package.json', 'packages/skill-sources/package.json', 'packages/managed-skills/package.json', 'packages/project-context/package.json', 'packages/project-authoring/package.json', 'packages/skill-manifest/package.json', 'packages/project-sync/package.json'].includes(path)) {
      try { lstatSync(join(repo,path)); } catch(error) { if(error?.code === 'ENOENT') continue; throw error; }
    }
    const bytes=regular(repo,path), manifest=JSON.parse(bytes);
    if (manifest.license !== 'MIT') fail('Unreviewed first-party license: '+path);
    manifests.push({path,sha256:sha256(bytes),license:manifest.license});
    for (const [dep,version] of Object.entries(manifest.dependencies ?? {})) {
      if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) fail('Dependency must be exactly pinned: '+dep);
      if (versions[dep] && versions[dep] !== version) fail('Conflicting dependency: '+dep);
      versions[dep]=version;
    }
  }
  const files = new Map(), dependencies = {}, sourceFiles = [], pending=[...ENTRY];
  while (pending.length) {
    const path=pending.shift(); if(files.has(path)) continue;
    if(!allowed(path)) fail('Runtime outside allowlist: '+path);
    const bytes=regular(repo,path); files.set(path,bytes);
    const sourcePath=path.replace(/^dist\//,'').replace(/\.js$/,'.ts'); sourceFiles.push({path:sourcePath,sha256:sha256(regular(repo,sourcePath))}); // Refuse stale orphan outputs; root owns the fresh compiler build.
    for(const spec of imports(bytes.toString('utf8'),path)) {
      if (isBuiltin(spec)) continue;
      if (spec.startsWith('.')) {
        const next=relative(repo,resolve(repo,dirname(path),spec)).split(sep).join('/');
        if (!allowed(next)) fail('Runtime import escapes allowlist: '+spec);
        pending.push(next);
      } else {
        const dep=dependencyName(spec); if(!versions[dep]) fail('Undeclared external runtime dependency: '+dep); dependencies[dep]=versions[dep];
      }
    }
  }
  for (const path of [...ASSETS,'LICENSE','docs/beta/license-boundary.md']) files.set(path,regular(repo,path));
  const manifest={name,version:rootPackage.version,private:!releaseCandidate,description:releaseCandidate?'An agent environment manager. Set up the skills, prompts, and teams your agents use, and approve every change.':'Private Bowerloom CLI distribution proof; not a published beta release',...(releaseCandidate?{repository:{type:'git',url:'git+'+release.urls.repository+'.git'},homepage:release.urls.site,bugs:{url:release.urls.repository+'/issues'},publishConfig:{access:'public',tag:release.npm.distTag,registry:release.npm.registry}}:{}),type:'module',license:rootPackage.license,engines:rootPackage.engines,bin:{bowerloom:ENTRY[0],'bowerloom-mcp':ENTRY[1]},files:['dist/apps/cli/src','dist/apps/mcp/src','dist/packages',...ASSETS,'LICENSE','docs/beta/license-boundary.md','npm-shrinkwrap.json','DISTRIBUTION.json','DISTRIBUTION-NOTICE.md','README.md'],dependencies:Object.fromEntries(Object.entries(dependencies).sort(([a],[b])=>a.localeCompare(b)))};
  // One walk of the lock gives the shrinkwrap. Its top-level entries then become exact pins, and the root entry follows the final manifest.
  const direct=manifest.dependencies, shrink=lockedDependencies(JSON.parse(regular(repo,'package-lock.json')),direct,manifest), flat=flatDependencies(shrink.packages,direct);
  if(bundle) for(const path of Object.keys(shrink.packages).filter(Boolean).sort(byName)) {
    const license=shrink.packages[path].license;
    if(!licenseAllowed(license)) fail('Bundled license not allowed: '+path.slice('node_modules/'.length)+' '+(typeof license==='string'?license:'(none)'));
  }
  manifest.dependencies=flat.dependencies;
  if(Object.keys(flat.optionalDependencies).length) manifest.optionalDependencies=flat.optionalDependencies;
  if(bundle) manifest.bundleDependencies=[...Object.keys(flat.dependencies),...Object.keys(flat.optionalDependencies)].sort(byName);
  shrink.packages['']=rootEntry(manifest);
  files.set('package.json',Buffer.from(json(manifest)));
  files.set('npm-shrinkwrap.json',Buffer.from(json(shrink)));
  files.set('DISTRIBUTION-NOTICE.md',Buffer.from('# Private packaging proof\n\nThe current monorepo code is MIT licensed under LICENSE. See docs/beta/license-boundary.md for historical source excluded from that grant. This artifact is private; publication remains separately authorized.\n\nPlaywright-derived seccomp policy notice: packages/linux-browser/PLAYWRIGHT-LICENSE.txt. Supabase upstream notice: packages/local-backend/THIRD_PARTY_NOTICES.md. '+(bundle?'The runtime npm dependencies ship inside this package under node_modules, each with its own license file.':'External npm dependencies are installed separately under their own package licenses.')+' No prior module repository source or its history is imported by this staging tool.\n'));
  files.set('README.md',Buffer.from('# Bowerloom CLI packaging proof\n\nRequires Node '+rootPackage.engines.node+'. Private, unpublished artifact. Install the supplied tarball with npm'+(bundle?'. The runtime dependencies ship inside the tarball.':'; external pinned npm dependencies must be available from cache or a separately authorized registry connection.')+' No lifecycle scripts are supplied. No source checkout is needed at installation.\n\n`bowerloom --help`\n\n`bowerloom init plan --mode new --target /absolute/new-project --name "My project" --goal "Review a project setup" --profile engineer --json`\n\nReview the plan. Apply the identical arguments with `init apply --approve EXACT_REVISION`; use `init status --target /absolute/new-project` afterward. Setup writes a review-required portable profile and team. It does not run a team, import settings, start Docker, provision a backend, or authorize actions. The `bowerloom-mcp` bin requires a separately approved installation; it is not a hosted service.\n\nHelp, isolated startup, exact setup revision, optional demo planning, and approved synthetic harness projection/removal are distribution acceptance targets in this proof. Other runtime commands, MCP sessions, Docker, database-backed recipes, browser executors, global installation, and other platforms remain unverified as packaged operations.\n'));
  if(releaseCandidate) {
    files.set('DISTRIBUTION-NOTICE.md',Buffer.from('# Bowerloom notices\n\nThe monorepo code is MIT licensed under LICENSE. See docs/beta/license-boundary.md for excluded historical source.\n\nUpstream notices: packages/linux-browser/PLAYWRIGHT-LICENSE.txt and packages/local-backend/THIRD_PARTY_NOTICES.md. '+(bundle?'The bundled runtime npm dependencies retain their own licenses and ship with their own license files.':'External dependencies retain their own licenses.')+'\n'));
    files.set('README.md',Buffer.from(`# Bowerloom ${release.release}\n\nOpen beta. Requires Node ${release.requirements.node}.\n\n${release.npm.availabilityNote}\n\n${installHeading(release)}\n\n\`\`\`sh\n${release.npm.installCommand}\nbowerloom --version\nbowerloom --help\n\`\`\`\n\n${release.capabilities.setup}\n\n${release.capabilities.execution}\n\n${release.systems.note} Full runtime acceptance remains incomplete.\n\nDocumentation: ${release.urls.docs}\n`));
  }
  const inventory=[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes),executable:ENTRY.includes(path)}));
  const record={schema:'bowerloom/cli-distribution/v0.1',name,version:manifest.version,private:manifest.private,releaseRecordSha256:sha256(regular(repo,'release/beta.json')),publicationState:release.state,buildRequirement:'Root TypeScript build completed before packaging; compiled bytes are pinned below.',sourceManifests:manifests,sourceFiles:sourceFiles.sort((a,b)=>a.path.localeCompare(b.path)),sourceLockSha256:sha256(regular(repo,'package-lock.json')),files:inventory,dependencies:manifest.dependencies,...(bundle?{bundle:{packageCount:Object.keys(shrink.packages).length-1,entries:Object.keys(shrink.packages).filter(Boolean).sort(byName).map(path=>({path,version:shrink.packages[path].version,integrity:shrink.packages[path].integrity,license:shrink.packages[path].license})),extractedFiles:0,extractedBytes:0}}:{}),acceptanceScope:['help','isolated startup plan/apply/status'],unverified:['other packaged runtime operations','MCP session','global installation','cross-platform installation'],licenseStatus:'MIT; see LICENSE and docs/beta/license-boundary.md'};
  files.set('DISTRIBUTION.json',Buffer.from(json(record)));
  return {files,record,manifest};
}
const GIB = 2 ** 30, STAGING_BOUND = 0.05 * GIB;
export function requireFreeSpace(parent, boundBytes) {
  const s=statfsSync(parent); if(s.bavail*s.bsize < 12*GIB+boundBytes) fail(`12 GiB reserve plus ${boundBytes/GIB} GiB bound required`);
}
function newDestination(destination, boundBytes=STAGING_BOUND) {
  if (!isAbsolute(destination) || resolve(destination)!==destination || existsSync(destination)) fail('Destination must be a new absolute path');
  const parent=dirname(destination); if(realpathSync(parent)!==parent || !lstatSync(parent).isDirectory()) fail('Destination parent must be real directory');
  let current=parent; while(current!==dirname(current)) { if(lstatSync(current).isSymbolicLink()) fail('Destination symlink ancestor'); current=dirname(current); }
  requireFreeSpace(parent, boundBytes);
}
export const defaultNpmCache = () => join(process.env.npm_config_cache ?? join(homedir(),'.npm'),'_cacache');
const ALLOWED_TYPES = new Set(['File','OldFile','ContiguousFile','Directory']);
const MAX_PACKAGE_ENTRIES = 8192, MAX_BUNDLE_ENTRIES = 50000, MIN_ENTRY_COST = 4096, MAX_CACHE_FILE = 256 * 2 ** 20, MAX_DEPTH = 32;
// Files that npm-packlist drops by its default rules, so a staged copy of one may be absent from the tarball.
const DEFAULT_OMITTED = /^(?:\.npmignore|\.gitignore|\.npmrc|\.DS_Store|\._.*|.*\.orig|npm-debug\.log|\.lock-wscript|\.wafpickle-.*)$/;
// npm always keeps these, so a tarball without one is wrong whatever the package files list says.
const ALWAYS_KEPT = /^(?:README|LICENSE|LICENCE)/i;
export function checkMaxBundleBytes(value) {
  if(value === undefined) return GIB;
  if(!Number.isSafeInteger(value) || value <= 0 || value > GIB) fail('maxBundleBytes must be a positive integer of at most 1 GiB');
  return value;
}
const fileHash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function modeWalk(directory, base, modes, onFile) {
  chmodSync(directory,0o755);
  for(const name of readdirSync(directory).sort()) {
    const full=join(directory,name), info=lstatSync(full);
    if(info.isDirectory()) modeWalk(full,base,modes,onFile);
    else if(info.isFile()) { chmodSync(full,(modes.get(relative(base,full).split(sep).join('/')) ?? 0) & 0o111 ? 0o755 : 0o644); onFile(full,info.size); }
    else fail('Bundle tarball unsafe: '+relative(base,full));
  }
}
// Open a cache file without following a link or waiting on a pipe, and read only what the opened file holds.
function readCacheFile(file, path) {
  let fd;
  try { fd=openSync(file,fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); }
  catch(error) {
    if(error?.code === 'ENOENT') fail('Bundle cache entry missing: '+path);
    if(['ELOOP','ENXIO','EISDIR','EMLINK'].includes(error?.code)) fail('Bundle cache entry unsafe: '+path);
    throw error;
  }
  try {
    const info=fstatSync(fd);
    if(!info.isFile() || info.size > MAX_CACHE_FILE) fail('Bundle cache entry unsafe: '+path);
    const data=Buffer.alloc(info.size); let offset=0;
    while(offset < info.size) { const count=readSync(fd,data,offset,info.size-offset,offset); if(count === 0) break; offset+=count; }
    return data.subarray(0,offset);
  } finally { closeSync(fd); }
}
// Extract each locked package from the npm cache into <stage>/<lock path>. The cache file is named by the lock integrity value.
// Every package is then checked against the lock: its own package.json names the same package and version, its license passes
// the gate, and it has no install script.
export function extractBundle({stageDir, packages, npmCache, maxBundleBytes}) {
  if(typeof npmCache !== 'string' || !isAbsolute(npmCache)) fail('npmCache must be an absolute path');
  const max=checkMaxBundleBytes(maxBundleBytes);
  if(mkdirSync(stageDir,{recursive:true}) !== undefined) chmodSync(stageDir,0o700);
  const realStage=realpathSync(stageDir), modulesRoot=join(realStage,'node_modules'), bundleFiles=new Map();
  let total=0, entryTotal=0, bytes=0;
  for(const path of Object.keys(packages).filter(Boolean).sort(byName)) {
    if(!LOCK_PATH_RE.test(path)) fail('Bundle path unsafe: '+path);
    const item=packages[path], name=PACKAGE_NAME_RE.exec(path)[1];
    if(item.resolved !== `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${item.version}.tgz`) fail('Bundle resolved URL mismatch: '+path);
    const integrity=item.integrity;
    if(typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) fail('Bundle integrity mismatch: '+path);
    const hex=Buffer.from(integrity.slice(7),'base64').toString('hex'), file=join(npmCache,'content-v2','sha512',hex.slice(0,2),hex.slice(2,4),hex.slice(4));
    const data=readCacheFile(file,path);
    if('sha512-'+createHash('sha512').update(data).digest('base64') !== integrity) fail('Bundle integrity mismatch: '+path);
    const target=join(realStage,path), rootInfo=lstatSync(modulesRoot,{throwIfNoEntry:false});
    if(rootInfo && !rootInfo.isDirectory()) fail('Bundle path unsafe: '+path);
    if(!rootInfo) mkdirSync(modulesRoot);
    chmodSync(modulesRoot,0o755);
    if(!resolve(target).startsWith(modulesRoot+sep) || lstatSync(target,{throwIfNoEntry:false})) fail('Bundle path unsafe: '+path);
    mkdirSync(target,{recursive:true});
    if(realpathSync(target) !== target) fail('Bundle path unsafe: '+path);
    // Folders made here take the umask of the user, so set them now. They are real folders inside the stage.
    for(let folder=target; folder !== modulesRoot; folder=dirname(folder)) chmodSync(folder,0o755);
    let entries=0, unsafe=null, oversize=false, tooMany=false;
    const modes=new Map(), folders=new Set(), refuse=raw => { unsafe ??= 'Bundle tarball unsafe: '+path+'/'+raw; };
    // Each entry, and each folder that tar makes on its own for a deep path, costs at least 4096 bytes and one entry of the cap.
    const charge=cost => {
      if(++entryTotal > MAX_BUNDLE_ENTRIES) { tooMany=true; return false; }
      total+=cost; if(total > max) { oversize=true; return false; }
      return true;
    };
    const filter=(raw,entry) => {
      const text=String(raw), segments=text.replace(/\/$/,'').split('/'), inner=segments.slice(1);
      if(!ALLOWED_TYPES.has(entry.type) || text.startsWith('/') || /^[A-Za-z]:/.test(text) || segments.some(part => part === '' || part === '.' || part === '..')
        || inner.some(part => part.normalize('NFC').toLowerCase() === 'node_modules')) { refuse(raw); return false; }
      if(inner.length === 0) return true;
      if(inner.length > MAX_DEPTH) { refuse(raw); return false; }
      if(++entries > MAX_PACKAGE_ENTRIES) { refuse(raw); return false; }
      const folderCount=entry.type === 'Directory' ? inner.length : inner.length-1;
      for(let depth=1; depth <= folderCount; depth++) {
        const key=inner.slice(0,depth).join('/');
        if(!folders.has(key)) {
          folders.add(key); if(!charge(MIN_ENTRY_COST)) return false;
          // Make the folder here with fixed modes, so tar never makes it under the umask of the user.
          const folder=join(target,key); mkdirSync(folder,{recursive:true}); chmodSync(folder,0o755);
        }
      }
      if(entry.type === 'Directory') { entry.mode=0o755; return true; }
      if(!charge(Math.max(entry.size ?? 0, MIN_ENTRY_COST))) return false;
      // Modes are set here and by tar's own chmod, so the user umask never decides them.
      const executable=((entry.mode ?? 0) & 0o111) !== 0;
      modes.set(inner.join('/'),executable ? 0o755 : 0o644); entry.mode=executable ? 0o755 : 0o644;
      return true;
    };
    // strict mode sends every tar warning through the throw, with the tar message in the error, so no warning handler is needed.
    const unpack=new UnpackSync({cwd:target,strip:1,strict:true,preserveOwner:false,noMtime:true,maxDepth:MAX_DEPTH,chmod:true,processUmask:0o022,dmode:0o755,filter});
    let thrown=null; try { unpack.end(data); } catch(error) { thrown=error; }
    if(unsafe) fail(unsafe);
    if(tooMany) fail('Bundle exceeds 50000 entries');
    if(oversize) fail('Bundle exceeds 1 GiB');
    if(thrown) fail('Bundle tarball unsafe: '+path+'/'+(thrown.message ?? thrown));
    const manifestFile=join(target,'package.json'), manifestInfo=lstatSync(manifestFile,{throwIfNoEntry:false});
    let pkg; try { if(!manifestInfo?.isFile()) throw new Error('none'); pkg=JSON.parse(readFileSync(manifestFile,'utf8')); } catch { fail('Bundle package mismatch: '+path); }
    if(pkg === null || typeof pkg !== 'object' || pkg.name !== name || pkg.version !== item.version) fail('Bundle package mismatch: '+path);
    if(!licenseAllowed(pkg.license)) fail('Bundled license not allowed: '+name+' '+(typeof pkg.license === 'string' ? pkg.license : '(none)'));
    if(['preinstall','install','postinstall'].some(key => pkg.scripts && typeof pkg.scripts === 'object' && Object.hasOwn(pkg.scripts,key)) || lstatSync(join(target,'binding.gyp'),{throwIfNoEntry:false})) fail('Bundle package has an install script: '+path);
    const restricted=Array.isArray(pkg.files) || ['.npmignore','.gitignore'].some(n => lstatSync(join(target,n),{throwIfNoEntry:false}));
    const kept=new Set(['package.json']);
    const clean=value => typeof value === 'string' ? posix.normalize(value).replace(/^\.\//,'') : null;
    kept.add(clean(pkg.main));
    for(const value of typeof pkg.bin === 'string' ? [pkg.bin] : pkg.bin && typeof pkg.bin === 'object' ? Object.values(pkg.bin) : []) kept.add(clean(value));
    modeWalk(target,target,modes,(full,size) => {
      const rel=relative(realStage,full).split(sep).join('/'), base=relative(target,full).split(sep).join('/');
      const always=kept.has(base) || (!base.includes('/') && ALWAYS_KEPT.test(base));
      bundleFiles.set(rel,{sha256:fileHash(full),mayOmit:!always && (restricted || DEFAULT_OMITTED.test(full.slice(full.lastIndexOf(sep)+1)))}); bytes+=size;
    });
  }
  return {files:bundleFiles.size,bytes,bundleFiles};
}
// Re-hash every staged bundled file just before npm reads the stage.
export function verifyBundleFiles(stageDir, bundleFiles) {
  for(const [path,{sha256:expected}] of bundleFiles) {
    let actual; try { actual=fileHash(join(stageDir,path)); } catch { actual=null; }
    if(actual !== expected) fail('Bundle file changed before pack: '+path);
  }
}
// The sha256 of every bundled file in a packed tarball, keyed by its stage path.
function packedBundleHashes(file) {
  const hashes=new Map();
  listTar({file,sync:true,onReadEntry:entry => {
    if(!entry.path.startsWith('package/node_modules/') || entry.type !== 'File') { entry.resume(); return; }
    const hash=createHash('sha256'), path=entry.path.slice('package/'.length);
    entry.on('data',chunk => hash.update(chunk)); entry.on('end',() => hashes.set(path,hash.digest('hex')));
  }});
  return hashes;
}
function stageBundle(options) {
  const bundle=options.bundle === true, max=checkMaxBundleBytes(options.maxBundleBytes);
  const npmCache=bundle ? (options.npmCache ?? defaultNpmCache()) : undefined;
  if(bundle && !isAbsolute(npmCache)) fail('npmCache must be an absolute path');
  const prepared=collect(options); newDestination(options.stageDir, bundle ? 2*(max+STAGING_BOUND) : STAGING_BOUND);
  mkdirSync(options.stageDir,{mode:0o700});
  let bundleFiles;
  try {
    for(const [path,bytes] of [...prepared.files].sort(([a],[b])=>a.localeCompare(b))) { const target=join(options.stageDir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx',mode:prepared.manifest.bin.bowerloom===path||prepared.manifest.bin['bowerloom-mcp']===path?0o755:0o644}); }
    if(bundle) {
      const extracted=extractBundle({stageDir:options.stageDir,packages:JSON.parse(prepared.files.get('npm-shrinkwrap.json')).packages,npmCache,maxBundleBytes:max});
      prepared.record.bundle.extractedFiles=extracted.files; prepared.record.bundle.extractedBytes=extracted.bytes; bundleFiles=extracted.bundleFiles;
      writeFileSync(join(options.stageDir,'DISTRIBUTION.json'),json(prepared.record));
    }
  }
  catch(e) { rmSync(options.stageDir,{recursive:true,force:true}); throw e; }
  return {record:prepared.record,manifest:prepared.manifest,bundleFiles};
}
export function stage(options) { return stageBundle(options).record; }
export function pack(options) {
  const bundle=options.bundle === true, max=checkMaxBundleBytes(options.maxBundleBytes), output=options.outputDir; newDestination(output, bundle ? max+STAGING_BOUND : STAGING_BOUND);
  if(output===options.stageDir || output.startsWith(options.stageDir+sep) || options.stageDir.startsWith(output+sep)) fail('Stage and output must be distinct siblings or separate trees');
  const {record,manifest,bundleFiles}=stageBundle(options);
  newDestination(output, bundle ? max+STAGING_BOUND : STAGING_BOUND); mkdirSync(output,{mode:0o700});
  writeFileSync(join(output,'.empty-npmrc'),'',{flag:'wx',mode:0o600});
  const run=dryRun => {
    const result=spawnSync('npm',['pack','--ignore-scripts','--offline','--json',...(dryRun ? ['--dry-run'] : ['--pack-destination',output])],{cwd:options.stageDir,encoding:'utf8',timeout:600000,maxBuffer:64*2**20,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(output,'.empty-npmrc'),npm_config_ignore_scripts:'true',npm_config_offline:'true',npm_config_update_notifier:'false'}});
    if(result.error?.code==='ENOBUFS') fail('npm pack output exceeds 64 MiB');
    if(result.status!==0) fail('npm pack failed: '+(result.stderr||result.error?.message));
    let info; try { info=JSON.parse(result.stdout)[0]; if(!info || !Array.isArray(info.files)) throw new Error('shape'); } catch { fail('npm pack output is not JSON'); }
    return info;
  };
  const counts = info => { const bundled=info.files.filter(f=>f.path.startsWith('node_modules/')); return {files:bundled.length,bytes:bundled.reduce((sum,f)=>sum+f.size,0)}; };
  let planned;
  if(bundle) {
    verifyBundleFiles(options.stageDir,bundleFiles);
    // A dry run lists what npm will pack, so the record inside the tarball holds the packed counts and not the staged ones.
    planned=counts(run(true));
    record.bundle.extractedFiles=planned.files; record.bundle.extractedBytes=planned.bytes;
    writeFileSync(join(options.stageDir,'DISTRIBUTION.json'),json(record));
  }
  const info=run(false);
  const all=info.files.map(f=>f.path), own=all.filter(p=>!p.startsWith('node_modules/')).sort(), bundled=info.files.filter(f=>f.path.startsWith('node_modules/')),expected=[...record.files.map(f=>f.path),'DISTRIBUTION.json'].sort();
  if(JSON.stringify(own)!==JSON.stringify(expected)) fail('npm tarball contents differ from explicit inventory');
  const tarball=join(output,info.filename);
  if(bundle) {
    const listed=new Set(all), lockPaths=record.bundle.entries.map(e=>e.path), actual=counts(info), packedHashes=packedBundleHashes(tarball);
    if(bundled.some(f=>!bundleFiles.has(f.path)) || [...bundleFiles].some(([path,{mayOmit}])=>!mayOmit && !listed.has(path)) || lockPaths.some(p=>!listed.has(p+'/package.json'))
      || actual.files!==planned.files || actual.bytes!==planned.bytes
      || [...packedHashes].some(([path,hash])=>bundleFiles.get(path)?.sha256!==hash) || [...bundleFiles].some(([path,{mayOmit}])=>!mayOmit && !packedHashes.has(path))
      || JSON.stringify([...(info.bundled??[])].sort(byName))!==JSON.stringify([...manifest.bundleDependencies].sort(byName))) fail('Bundle packed files differ from the staged bundle');
  }
  return {file:tarball,sha256:sha256(readFileSync(tarball)),bytes:info.size,unpackedBytes:info.unpackedSize,files:own.length,...(bundle?{bundle:{packages:(info.bundled??[]).length,...counts(info)}}:{}),record};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const raw=process.argv.slice(2), releaseCandidate=raw.includes('--release-candidate');
  if(raw.filter(x=>x==='--release-candidate').length>1) fail('Duplicate release candidate flag');
  const args=raw.filter(x=>x!=='--release-candidate'), values={};
  for(let i=0;i<args.length;i+=2) { if(!['--repo','--stage','--output','--name','--npm-cache'].includes(args[i])||!args[i+1]||values[args[i]]) fail('Use --repo ABS --stage NEW_ABS --output NEW_ABS [--name IDENTITY] [--npm-cache ABS]'); values[args[i]]=args[i+1]; }
  if(!values['--repo']||!values['--stage']||!values['--output']) fail('Missing required paths');
  const result=pack({repoDir:values['--repo'],stageDir:values['--stage'],outputDir:values['--output'],releaseCandidate,bundle:true,...(values['--npm-cache']?{npmCache:values['--npm-cache']}:{}),...(values['--name']?{name:values['--name']}:{})});
  console.log(json({...result,record:undefined}));
}
