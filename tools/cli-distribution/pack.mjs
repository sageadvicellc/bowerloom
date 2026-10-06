#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, statfsSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { parseAst } from 'rolldown/parseAst';
export const MODULES = Object.freeze(['admission','authoring','broker','broker-postgres','codex-adapter','connections','contracts','controlled-tests','crew','graph','harness-portability','linux-browser','local-backend','local-control','mcp-connections','portable','recipes','roots','runtime','runtime-bridge','startup','workbench','workspace-effects']);
export const ASSETS = Object.freeze(['release/beta.json','packages/linux-browser/assets/runner.cjs','packages/linux-browser/assets/seccomp.json','packages/linux-browser/assets/runtime-manifest.json','packages/linux-browser/assets/craft-shop-contract.md','packages/linux-browser/PLAYWRIGHT-LICENSE.txt','packages/linux-browser/IMPORT-MANIFEST.json','packages/local-backend/THIRD_PARTY_NOTICES.md','packages/local-backend/licenses/supabase-Apache-2.0.txt']);
const ENTRY = ['dist/apps/cli/src/main.js','dist/apps/mcp/src/main.js'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw new Error(message); };
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
    const path=locate('',name); if(lock.packages[path].version!==version) fail('Direct dependency lock mismatch: '+name); queue.push(path);
  }
  while(queue.length) {
    const path=queue.shift(); if(chosen[path]) continue;
    const item=lock.packages[path];
    if(item.link || !/^https:\/\/registry\.npmjs\.org\//.test(item.resolved??'') || !/^sha512-/.test(item.integrity??'')) fail('Nonregistry or unpinned dependency: '+path);
    const {dev,devOptional,workspaces,...entry}=item; chosen[path]=entry;
    for(const [name] of Object.entries({...item.dependencies,...item.optionalDependencies,...item.peerDependencies})) {
      const optional=Object.hasOwn(item.optionalDependencies??{},name) || item.peerDependenciesMeta?.[name]?.optional===true;
      const found=locate(path,name,optional); if(found) queue.push(found);
    }
  }
  return {name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':{name:manifest.name,version:manifest.version,license:manifest.license,dependencies:manifest.dependencies,bin:manifest.bin,engines:manifest.engines},...Object.fromEntries(Object.entries(chosen).sort(([a],[b])=>a.localeCompare(b)))}};
}
export function collect({repoDir, name='bowerloom', releaseCandidate=false}) {
  if(typeof releaseCandidate !== 'boolean') fail('releaseCandidate must be boolean');
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214) fail('Invalid npm package identity');
  const repo = realpathSync(repoDir), rootPackage = JSON.parse(regular(repo,'package.json'));
  const release = JSON.parse(regular(repo,'release/beta.json'));
  if(release.schema !== 'bowerloom/release/v1' || release.version !== rootPackage.version || rootPackage.name !== name
    || release.npm?.packageName !== name || !['unreleased','published'].includes(release.state)
    || release.npm.published !== (release.state === 'published')
    || release.npm.registry !== 'https://registry.npmjs.org'
    || release.npm.distTag !== 'beta'
    || release.npm.installCommand !== `npm install --global ${name}@${rootPackage.version}`) fail('Release record does not match package identity');
  if(releaseCandidate && release.state !== 'unreleased') fail('Release candidate requires an unreleased record');
  const versions = {}, manifests = [];
  for (const path of ['package.json',...['apps/cli','apps/mcp',...MODULES.map(n=>'packages/'+n)].map(n=>n+'/package.json')]) {
    // Connections currently belongs to the root MIT package and has no workspace manifest.
    if (path === 'packages/connections/package.json' && !existsSync(join(repo,path))) continue;
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
  const manifest={name,version:rootPackage.version,private:!releaseCandidate,description:releaseCandidate?'Bowerloom open beta release candidate; unreleased':'Private Bowerloom CLI distribution proof; not a published beta release',...(releaseCandidate?{publishConfig:{access:'public',tag:release.npm.distTag,registry:release.npm.registry}}:{}),type:'module',license:rootPackage.license,engines:rootPackage.engines,bin:{bowerloom:ENTRY[0],'bowerloom-mcp':ENTRY[1]},files:['dist/apps/cli/src','dist/apps/mcp/src','dist/packages',...ASSETS,'LICENSE','docs/beta/license-boundary.md','npm-shrinkwrap.json','DISTRIBUTION.json','DISTRIBUTION-NOTICE.md','README.md'],dependencies:Object.fromEntries(Object.entries(dependencies).sort(([a],[b])=>a.localeCompare(b)))};
  files.set('package.json',Buffer.from(json(manifest)));
  files.set('npm-shrinkwrap.json',Buffer.from(json(lockedDependencies(JSON.parse(regular(repo,'package-lock.json')),manifest.dependencies,manifest))));
  files.set('DISTRIBUTION-NOTICE.md',Buffer.from('# Private packaging proof\n\nThe current monorepo code is MIT licensed under LICENSE. See docs/beta/license-boundary.md for historical source excluded from that grant. This artifact is private; publication remains separately authorized.\n\nPlaywright-derived seccomp policy notice: packages/linux-browser/PLAYWRIGHT-LICENSE.txt. Supabase upstream notice: packages/local-backend/THIRD_PARTY_NOTICES.md. External npm dependencies are installed separately under their own package licenses. No prior module repository source or its history is imported by this staging tool.\n'));
  files.set('README.md',Buffer.from('# Bowerloom CLI packaging proof\n\nRequires Node '+rootPackage.engines.node+'. Private, unpublished artifact. Install the supplied tarball with npm; external pinned npm dependencies must be available from cache or a separately authorized registry connection. No lifecycle scripts are supplied. No source checkout is needed at installation.\n\n`bowerloom --help`\n\n`bowerloom init plan --mode new --target /absolute/new-project --name "My project" --goal "Review a project setup" --profile engineer --json`\n\nReview the plan. Apply the identical arguments with `init apply --approve EXACT_REVISION`; use `init status --target /absolute/new-project` afterward. Setup writes a review-required portable profile and team. It does not run a team, import settings, start Docker, provision a backend, or authorize actions. The `bowerloom-mcp` bin requires a separately approved installation; it is not a hosted service.\n\nHelp, isolated startup, exact setup revision, optional demo planning, and approved synthetic harness projection/removal are distribution acceptance targets in this proof. Other runtime commands, MCP sessions, Docker, database-backed recipes, browser executors, global installation, and other platforms remain unverified as packaged operations.\n'));
  if(releaseCandidate) {
    files.set('DISTRIBUTION-NOTICE.md',Buffer.from('# Bowerloom beta candidate\n\nThis candidate is unreleased. Publication requires founder acceptance and an authorized npm identity. The monorepo code is MIT licensed under LICENSE. See docs/beta/license-boundary.md for excluded historical source.\n\nUpstream notices: packages/linux-browser/PLAYWRIGHT-LICENSE.txt and packages/local-backend/THIRD_PARTY_NOTICES.md. External dependencies retain their own licenses.\n'));
    files.set('README.md',Buffer.from(`# Bowerloom ${release.release}\n\nOpen beta, ${release.state}. Requires Node ${release.requirements.node}.\n\n${release.npm.availabilityNote}\n\nAfter publication:\n\n\`\`\`sh\n${release.npm.installCommand}\nbowerloom --version\nbowerloom --help\n\`\`\`\n\n${release.capabilities.setup}\n\n${release.capabilities.execution}\n\n${release.systems.note} Full runtime acceptance remains incomplete.\n\nDocumentation: ${release.urls.docs}\n`));
  }
  const inventory=[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes),executable:ENTRY.includes(path)}));
  const record={schema:'bowerloom/cli-distribution/v0.1',name,version:manifest.version,private:manifest.private,releaseRecordSha256:sha256(regular(repo,'release/beta.json')),publicationState:release.state,buildRequirement:'Root TypeScript build completed before packaging; compiled bytes are pinned below.',sourceManifests:manifests,sourceFiles:sourceFiles.sort((a,b)=>a.path.localeCompare(b.path)),sourceLockSha256:sha256(regular(repo,'package-lock.json')),files:inventory,dependencies:manifest.dependencies,acceptanceScope:['help','isolated startup plan/apply/status'],unverified:['other packaged runtime operations','MCP session','global installation','cross-platform installation'],licenseStatus:'MIT; see LICENSE and docs/beta/license-boundary.md'};
  files.set('DISTRIBUTION.json',Buffer.from(json(record)));
  return {files,record,manifest};
}
function newDestination(destination) {
  if (!isAbsolute(destination) || resolve(destination)!==destination || existsSync(destination)) fail('Destination must be a new absolute path');
  const parent=dirname(destination); if(realpathSync(parent)!==parent || !lstatSync(parent).isDirectory()) fail('Destination parent must be real directory');
  let current=parent; while(current!==dirname(current)) { if(lstatSync(current).isSymbolicLink()) fail('Destination symlink ancestor'); current=dirname(current); }
  const s=statfsSync(parent); if(s.bavail*s.bsize < 12.05*2**30) fail('12 GiB reserve plus 0.05 GiB staging bound required');
}
export function stage(options) {
  const prepared=collect(options); newDestination(options.stageDir);
  mkdirSync(options.stageDir,{mode:0o700});
  try { for(const [path,bytes] of [...prepared.files].sort(([a],[b])=>a.localeCompare(b))) { const target=join(options.stageDir,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx',mode:prepared.manifest.bin.bowerloom===path||prepared.manifest.bin['bowerloom-mcp']===path?0o755:0o644}); } }
  catch(e) { rmSync(options.stageDir,{recursive:true,force:true}); throw e; }
  return prepared.record;
}
export function pack(options) {
  const output=options.outputDir; newDestination(output);
  if(output===options.stageDir || output.startsWith(options.stageDir+sep) || options.stageDir.startsWith(output+sep)) fail('Stage and output must be distinct siblings or separate trees');
  const record=stage(options);
  newDestination(output); mkdirSync(output,{mode:0o700});
  writeFileSync(join(output,'.empty-npmrc'),'',{flag:'wx',mode:0o600});
  const result=spawnSync('npm',['pack','--ignore-scripts','--offline','--json','--pack-destination',output],{cwd:options.stageDir,encoding:'utf8',timeout:120000,maxBuffer:2**20,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,npm_config_userconfig:'/dev/null',npm_config_globalconfig:join(output,'.empty-npmrc'),npm_config_ignore_scripts:'true',npm_config_offline:'true'}});
  if(result.status!==0) fail('npm pack failed: '+(result.stderr||result.error?.message));
  const info=JSON.parse(result.stdout)[0];
  const actual=info.files.map(f=>f.path).sort(),expected=[...record.files.map(f=>f.path),'DISTRIBUTION.json'].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)) fail('npm tarball contents differ from explicit inventory');
  return {file:join(output,info.filename),sha256:sha256(readFileSync(join(output,info.filename))),bytes:info.size,unpackedBytes:info.unpackedSize,files:actual.length,record};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const raw=process.argv.slice(2), releaseCandidate=raw.includes('--release-candidate');
  if(raw.filter(x=>x==='--release-candidate').length>1) fail('Duplicate release candidate flag');
  const args=raw.filter(x=>x!=='--release-candidate'), values={};
  for(let i=0;i<args.length;i+=2) { if(!['--repo','--stage','--output','--name'].includes(args[i])||!args[i+1]||values[args[i]]) fail('Use --repo ABS --stage NEW_ABS --output NEW_ABS [--name IDENTITY]'); values[args[i]]=args[i+1]; }
  if(!values['--repo']||!values['--stage']||!values['--output']) fail('Missing required paths');
  const result=pack({repoDir:values['--repo'],stageDir:values['--stage'],outputDir:values['--output'],releaseCandidate,...(values['--name']?{name:values['--name']}:{})});
  console.log(json({...result,record:undefined}));
}
