import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runPortableCommand } from '../apps/cli/src/portable.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bowerloom-cli-'));
  // macOS /var is a symlink. Use the resolved path for the no-symlink contract.
  const actual = realpathSync(root), bundle = join(actual, 'bundle');
  mkdirSync(join(bundle, '.bowerloom/skills/draft'), {recursive:true});
  writeFileSync(join(bundle, '.bowerloom/manifest.json'), JSON.stringify({schemaVersion:'bowerloom/v1alpha1',parts:[{id:'draft',kind:'skill',files:['skills/draft/SKILL.md'],dependsOn:[]}]}));
  writeFileSync(join(bundle, '.bowerloom/skills/draft/SKILL.md'), '---\nname: draft\ndescription: Draft local notes.\n---\nAsk for a goal.\n');
  return {root:actual,bundle,target:join(actual,'new-workspace')};
}

test('portable CLI requires exact install approval and records no execution authority', () => {
  const f=fixture();
  try {
    const args=['portable','plan',f.bundle,'--select','draft','--harness','codex','--target',f.target];
    const plan=runPortableCommand(args) as {revision:string; executionAuthorized:boolean};
    assert.equal(plan.executionAuthorized,false);
    assert.throws(()=>runPortableCommand(args.map(v=>v==='plan'?'install':v)),{code:'USAGE'});
    assert.throws(()=>runPortableCommand([...args.map(v=>v==='plan'?'install':v),'--approve','0'.repeat(64)]),{code:'STALE_APPROVAL'});
    const receipt=runPortableCommand([...args.map(v=>v==='plan'?'install':v),'--approve',plan.revision]) as {executionAuthorized:boolean};
    assert.equal(receipt.executionAuthorized,false);
    assert.match(readFileSync(join(f.target,'START-HERE.md'),'utf8'),/does not execute teams/);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('portable CLI rejects ambiguous flags and unsupported harnesses before writing',()=>{
  const f=fixture();
  try {
    const args=['portable','plan',f.bundle,'--select','draft','--harness','codex','--target',f.target];
    for(const extra of [['--target',f.target],['--unknown','yes'],['--approve','0'.repeat(64)],['--select']]) {
      assert.throws(()=>runPortableCommand([...args,...extra]),{code:'USAGE'});
    }
    assert.throws(()=>runPortableCommand(args.map(v=>v==='codex'?'unknown':v)),{code:'UNSUPPORTED_HARNESS'});
    assert.throws(()=>runPortableCommand(['portable','validate',f.bundle,'--approve','yes']),{code:'USAGE'});
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('Bowerloom help and legacy command aliases share the existing CLI',()=>{
  const root=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {bin:Record<string,string>};
  assert.equal(root.bin.bowerloom,root.bin.trellis);
  assert.equal(root.bin['bowerloom-mcp'],root.bin['trellis-mcp']);
  const result=spawnSync(process.execPath,['dist/apps/cli/src/main.js','--help'],{encoding:'utf8'});
  assert.equal(result.status,0);
  assert.match(result.stdout,/Bowerloom v0.7-alpha/);
  assert.match(result.stdout,/bowerloom portable/);
});
