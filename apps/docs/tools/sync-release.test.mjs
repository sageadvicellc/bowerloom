import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const repo=resolve(import.meta.dirname,'../../..');
const pages=['index','start','setup','revision','stop','cli','backend','mcp','releases','status'];
const files=['release/beta.json','README.md','docs/assets/badge-version.svg','apps/docs/tools/sync-release.mjs',...pages.map(x=>`apps/docs/src/content/docs/${x}.md`)];
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'bowerloom-docs-release-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const f of files){await mkdir(dirname(join(root,f)),{recursive:true});await copyFile(join(repo,f),join(root,f));}return root;}
function run(root,check=true){return spawnSync(process.execPath,[join(root,'apps/docs/tools/sync-release.mjs'),...(check?['--check']:[])],{encoding:'utf8',timeout:5000});}
test('current generated surfaces match the release record',()=>{const r=run(repo);assert.equal(r.status,0,r.stderr);});
test('changed release identity refuses stale docs then synchronizes every marked surface',async t=>{const root=await fixture(t);const path=join(root,'release/beta.json'),record=JSON.parse(await readFile(path));record.version='0.7.0-beta.99';record.distribution.archive='bowerloom-0.7.0-beta.99.tgz';record.npm.installCommand='npm install -g ./bowerloom-0.7.0-beta.99.tgz';await writeFile(path,JSON.stringify(record));assert.notEqual(run(root).status,0);assert.equal(run(root,false).status,0);assert.equal(run(root).status,0);for(const f of ['README.md','docs/assets/badge-version.svg',...pages.map(x=>`apps/docs/src/content/docs/${x}.md`)]){const s=await readFile(join(root,f),'utf8');assert(s.includes('0.7.0-beta.99'),f);assert(!s.includes('0.7.0-beta.1'),f);}});
test('manual release block or badge drift is refused',async t=>{for(const f of ['README.md','docs/assets/badge-version.svg']){const root=await fixture(t);const path=join(root,f);await writeFile(path,(await readFile(path,'utf8')).replace('0.7.0-beta.1','0.7.0-beta.98'));assert.notEqual(run(root).status,0,f);}});
test('missing generated boundary cannot silently omit a release surface',async t=>{const root=await fixture(t);await writeFile(join(root,'apps/docs/src/content/docs/start.md'),'No generated boundary');assert.notEqual(run(root,false).status,0);});
test('current onboarding omits alpha narratives and source-only commands outside contributors',async()=>{for(const name of [...pages,'security','configuration','permissions','harnesses','workbench','company']){const s=await readFile(join(repo,'apps/docs/src/content/docs',name+'.md'),'utf8');assert(!/alpha|cd62b530|private candidate|node dist\//i.test(s),name);}assert(!/alpha|node dist\//i.test(await readFile(join(repo,'README.md'),'utf8')));});
