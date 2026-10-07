import test from 'node:test';
import { validateReleaseIdentity } from '../apps/cli/src/release.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url),'utf8')) as {version:string}).version;
function fixture(t: test.TestContext) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-cli-discovery-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'package.json'),JSON.stringify({version:'9.9.9-unrelated-cwd'}));
  writeFileSync(join(root,'preserve.txt'),'Synthetic existing file.\n');
  return {root,target:join(root,'must-not-exist')};
}
function run(root:string,args:string[]) {
  const result=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);return result;
}

test('version aliases report the actual distribution version independent of working directory',t=>{
  const f=fixture(t),before=readdirSync(f.root).sort();
  for(const option of ['--version','-V']) {
    const r=run(f.root,[option]);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
    assert.equal(r.stdout,`Bowerloom ${version}\n`);assert.doesNotMatch(r.stdout,/9\.9\.9/);
  }
  assert.deepEqual(readdirSync(f.root).sort(),before);assert.equal(existsSync(f.target),false);
});
test('root and exact init help aliases succeed without creating a target or changing files',t=>{
  const f=fixture(t),before=readdirSync(f.root).sort();
  for(const args of [['help','advanced'],['init','--help'],['init','-h']]) {
    const r=run(f.root,args);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.match(r.stdout,/bowerloom init plan/);
    assert.match(r.stdout,/engineer\|founder\|research/);
    assert.ok(r.stdout.startsWith(`Bowerloom ${version}: open beta (unreleased)`));
    assert.doesNotMatch(r.stdout,/alpha/i);
  }
  assert.deepEqual(readdirSync(f.root).sort(),before);assert.equal(existsSync(f.target),false);
  assert.equal(readFileSync(join(f.root,'preserve.txt'),'utf8'),'Synthetic existing file.\n');
});
test('discovery flags with extra arguments and malformed startup remain usage refusals without writes',t=>{
  const f=fixture(t),before=readdirSync(f.root).sort();
  for(const args of [
    ['--version','extra'],['-V','--help'],['--help','extra'],['init','--help','--target',f.target],
    ['init','-h','extra'],['init','plan','--help'],['init','apply','--mode','new','--target',f.target],
  ]) {
    const r=run(f.root,args);assert.equal(r.status,2,JSON.stringify({args,...r}));assert.equal(r.stdout,'');
    assert.equal(JSON.parse(r.stderr).error.code,'USAGE');
  }
  const unknown=run(f.root,['unknown']);assert.equal(unknown.status,2);assert.match(JSON.parse(unknown.stderr).error.message,/bowerloom plan/);assert.doesNotMatch(unknown.stderr,/trellis plan/);
  assert.deepEqual(readdirSync(f.root).sort(),before);assert.equal(existsSync(f.target),false);
  assert.equal(readFileSync(join(f.root,'preserve.txt'),'utf8'),'Synthetic existing file.\n');
});

test('release identity refuses same-version wrong names and inconsistent publication state',()=>{
 const release=JSON.parse(readFileSync(new URL('../../release/beta.json',import.meta.url),'utf8'));
 const pkg={name:'bowerloom',version};
 assert.equal(validateReleaseIdentity(release,pkg).version,version);
 for(const [record,metadata] of [
  [{...release,npm:{...release.npm,packageName:'other'}},pkg],
  [release,{...pkg,name:'other'}],
  [{...release,npm:{...release.npm,packageName:'other'}},{...pkg,name:'other'}],
  [{...release,npm:{...release.npm,published:true}},pkg],
  [{...release,npm:{...release.npm,installCommand:'npm install unrelated'}},pkg],
  [{...release,version:'9.9.9'},pkg],
  [{...release,capabilities:{}},pkg],
 ]) assert.throws(()=>validateReleaseIdentity(record,metadata),/installed release record/);
});
