import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { canonicalJson, DefinitionError } from '../packages/contracts/src/index.js';
import { runRoutineCommand } from '../apps/cli/src/routine.js';
import { exportRoutineYaml, loadRoutineFiles } from '../packages/routines/src/files.js';
import { scaffold } from '../packages/startup/src/scaffold.js';
import { planStartup, applyStartup, inspectStartup } from '../packages/startup/src/index.js';

const sha = (value: string | Buffer) => 'sha256:' + createHash('sha256').update(value).digest('hex');
function area(): string {
  const base = realpathSync(process.env.BOWERLOOM_ROUTINE_TEST_FIXTURES ?? tmpdir());
  return realpathSync(mkdtempSync(join(base, 'bowerloom-routine-cli-')));
}
function fixture() {
  const parent = area(), root = join(parent, '.bowerloom'); mkdirSync(root, {mode: 0o700});
  const team = scaffold({projectName:'Synthetic routine',goal:'Review supplied synthetic evidence',assistantName:'Assistant',teamName:'Editorial',reviewMode:'milestones',profile:'engineer'}).files.find(f=>f.path==='teams/first-team/team.yaml')!.text;
  const dependencies = [
    {kind:'recipe',ref:'recipes/labs-to-blog/recipe.json',content:JSON.stringify({format:'trellis/recipe/labs-to-blog/v1',id:'labs-blog',sourceRevision:'a'.repeat(40),github:{host:'github.com',owner:'synthetic',repo:'synthetic-blog',baseBranch:'main',branchPrefix:'trellis/labs-blog/draft',draftPath:'blog/draft.md',evidencePrefix:'labs'}})},
    {kind:'team',ref:'teams/editorial/team.yaml',content:team},
    {kind:'skill',ref:'skills/evidence-summary/SKILL.md',content:'# Evidence summary\nUse only supplied synthetic records.\n'},
    {kind:'connection',ref:'connections/github-publication.json',content:JSON.stringify({format:'bowerloom/mcp-declaration/v1beta1',connectionId:'github-publication',protocolVersion:'2025-11-25',transport:'streamable-http',tools:[{name:'read_selected_record',permissionClass:'read-only'}]})},
  ];
  const pin = (kind: string) => {const d=dependencies.find(d=>d.kind===kind)!;return {ref:d.ref,digest:sha(d.content)};};
  const routine = {format:'bowerloom/routine/v1beta1',id:'labs-to-blog',version:'1.0.0',inputs:{experiment:{type:'resource-reference'}},outputs:{draft:{type:'artifact',mediaType:'text/markdown'}},implementation:{kind:'registered-recipe',id:'labs-to-blog-v1',...pin('recipe')},team:pin('team'),skills:[pin('skill')],connections:[pin('connection')],review:{beforeEffects:'exact-action-approval',completion:'founder-review'},limits:{maxActiveWorkers:2,maxAttempts:1,deadlineSeconds:1800,paidFallback:false},invocation:'manual'};
  const write = (ref: string, text: string) => {const path=join(root,ref);mkdirSync(dirname(path),{recursive:true,mode:0o755});writeFileSync(path,text,{mode:0o644});};
  write('routines/labs-to-blog.yaml', exportRoutineYaml(routine));
  for (const d of dependencies) write(d.ref,d.content);
  write('unreferenced-note.txt','Never selected or copied.\n');
  const inputs={experiment:{id:'synthetic-record',digest:'sha256:'+'b'.repeat(64)}};
  const args=['routine','plan','--root',root,'--experiment-id',inputs.experiment.id,'--experiment-digest',inputs.experiment.digest];
  return {parent,root,inputs,args,dependencies,write};
}
function snapshot(root: string): unknown[] {
  const result: unknown[]=[];
  function walk(path:string,ref:string) {
    for(const name of readdirSync(path).sort()) {const full=join(path,name),relative=ref?ref+'/'+name:name,s=lstatSync(full);
      result.push({path:relative,mode:s.mode,...(s.isFile()?{digest:sha(readFileSync(full))}:{kind:s.isSymbolicLink()?'symlink':'directory'})});
      if(s.isDirectory())walk(full,relative);
    }
  }
  walk(root,'');return result;
}
function cli(args: string[], expected=0) {
  const r=spawnSync(process.execPath,['dist/apps/cli/src/main.js',...args],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,expected,r.stderr);
  if(expected===0)assert.equal(r.stderr,'');else assert.equal(r.stdout,'');
  return r;
}
test('routine CLI produces exact canonical read-only plan from a standalone authoring root',async()=>{
  const f=fixture(),before=snapshot(f.root),expected=canonicalJson(await loadRoutineFiles(f.root,f.inputs))+'\n';
  const first=cli(f.args),second=cli(f.args);
  assert.equal(first.stdout,expected);assert.equal(second.stdout,expected);assert.deepEqual(snapshot(f.root),before);
  const value=JSON.parse(first.stdout);assert.equal(value.installedBindingVerified,false);assert.equal(value.executionAuthorized,false);assert.equal(value.effectsAuthorized,false);assert.deepEqual(value.plan.grants,[]);
  assert.equal(first.stdout.includes(f.root),false);assert.equal(first.stdout.includes('Never selected'),false);
  assert.equal(cli(['routine','plan',...f.args.slice(6,8),...f.args.slice(2,6)]).stdout,expected);
});
test('routine CLI help names the read-only authoring boundary',()=>{
  const r=cli(['help','advanced']);assert.match(r.stdout,/bowerloom routine plan --root/);assert.match(r.stdout,/standalone portable authoring tree/);assert.match(r.stdout,/does not install\/import files/);
});
test('routine CLI exact argument protocol rejects effects and malformed tokens with empty stdout',async()=>{
  const f=fixture(),before=snapshot(f.root);
  for(const operation of ['run','apply','install','import','export','schedule','approve']) {
    const r=cli(['routine',operation,...f.args.slice(2)],2);assert.equal(JSON.parse(r.stderr).error.code,'USAGE');
  }
  const cases=[f.args.slice(0,-1),[...f.args,'--json'],[...f.args.slice(0,6),'--root',f.root],[...f.args.slice(0,6),'--output','out'],[...f.args.slice(0,2),'positional',f.root,...f.args.slice(4)],[...f.args.slice(0,3),'',...f.args.slice(4)]];
  for(const args of cases){const r=cli(args,2);assert.equal(JSON.parse(r.stderr).error.code,'USAGE');assert.equal(r.stderr.includes(f.root),false);}
  for(const value of ['x'.repeat(2049),'é'.repeat(1025)])await assert.rejects(runRoutineCommand([...f.args.slice(0,3),value,...f.args.slice(4)]),e=>e instanceof DefinitionError&&e.code==='USAGE');
  await assert.rejects(runRoutineCommand([...f.args.slice(0,3),null as unknown as string,...f.args.slice(4)]),e=>e instanceof DefinitionError&&e.code==='USAGE');
  assert.deepEqual(snapshot(f.root),before);
});
test('routine CLI loader refusals are sanitized, nonzero and leave local files unchanged',()=>{
  const f=fixture();f.write(f.dependencies[2]!.ref,'# Changed while retaining old definition pin\n');
  const before=snapshot(f.root),r=cli(f.args,1);assert.equal(JSON.parse(r.stderr).error.code,'ROUTINE_FILES_DEPENDENCY');assert.equal(r.stderr.includes(f.root),false);assert.equal(r.stderr.includes('Changed while'),false);assert.deepEqual(snapshot(f.root),before);
  const g=fixture();chmodSync(join(g.root,g.dependencies[2]!.ref),0o666);assert.equal(JSON.parse(cli(g.args,1).stderr).error.code,'ROUTINE_FILES_UNSAFE');
  const h=fixture(),alias=join(h.parent,'other');mkdirSync(alias);symlinkSync(h.root,join(alias,'.bowerloom'));const bad=[...h.args];bad[3]=join(alias,'.bowerloom');assert.equal(JSON.parse(cli(bad,1).stderr).error.code,'ROUTINE_FILES_UNSAFE');
  const invalid=[...h.args];invalid[7]='bad-digest';assert.equal(JSON.parse(cli(invalid,1).stderr).error.code,'ROUTINE_FILES_INPUT');
});
test('routine planning leaves unrelated managed startup intact; added routine files still mean drift',async()=>{
  const parent=area(),targetDir=join(parent,'managed');
  const input={mode:'new' as const,targetDir,brief:{projectName:'Synthetic managed project',goal:'Review a synthetic specification',assistantName:'Assistant',teamName:'Editorial',reviewMode:'milestones' as const}};
  const plan=await planStartup(input);await applyStartup(input,plan.revision);
  const status=await inspectStartup(targetDir),before=snapshot(targetDir);assert.equal(status.specReady,true);
  const f=fixture();cli(f.args);assert.deepEqual(snapshot(targetDir),before);assert.deepEqual(await inspectStartup(targetDir),status);
  const extra=join(targetDir,'.bowerloom/routines');mkdirSync(extra);writeFileSync(join(extra,'labs-to-blog.yaml'),'synthetic: uninstalled\n');
  const drift=await inspectStartup(targetDir);assert.equal(drift.specReady,false);assert.ok(drift.drift.some(d=>d.path==='.bowerloom/routines'&&d.kind==='unexpected'));
});
test('routine adapter sanitizes foreign errors including proxies and throwing properties',()=>{
  const script=String.raw`
    import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';
    const moduleText=\`export class RoutineFilesError extends Error {constructor(code){super('PRIVATE_MESSAGE');this.code=code;}}
      export async function loadRoutineFiles(){switch(globalThis.kind){
        case 'object':throw {code:'PRIVATE_CODE',message:'PRIVATE_MESSAGE'};
        case 'definition':throw globalThis.definitionError;
        case 'proxy':throw new Proxy({}, {get(){globalThis.traps++;throw Error('PRIVATE_MESSAGE')},getPrototypeOf(){globalThis.traps++;throw Error('PRIVATE_MESSAGE')},getOwnPropertyDescriptor(){globalThis.traps++;throw Error('PRIVATE_MESSAGE')}});
        case 'getter':throw Object.create(RoutineFilesError.prototype,{code:{get(){globalThis.traps++;throw Error('PRIVATE_MESSAGE')}}});
        case 'bad-instance':throw new RoutineFilesError('ROUTINE_FILES_PRIVATE');
        case 'message-getter':{const e=new RoutineFilesError('ROUTINE_FILES_UNSAFE');Object.defineProperty(e,'message',{get(){globalThis.traps++;throw Error('PRIVATE_MESSAGE')}});throw e;}
        default:throw new RoutineFilesError('ROUTINE_FILES_CHANGED');
      }}\`;
    const replacement='data:text/javascript,'+encodeURIComponent(moduleText);
    const hook=registerHooks({resolve(spec,context,next){if(context.parentURL?.endsWith('/apps/cli/src/routine.js')&&spec.endsWith('/routines/src/files.js'))return{url:replacement,shortCircuit:true};return next(spec,context);}});
    const {DefinitionError}=await import(pathToFileURL(process.cwd()+'/dist/packages/contracts/src/index.js').href);
    globalThis.definitionError=new DefinitionError('USAGE','PRIVATE_MESSAGE');
    const {runRoutineCommand}=await import(pathToFileURL(process.cwd()+'/dist/apps/cli/src/routine.js').href);
    const results=[];for(const kind of ['object','definition','proxy','getter','bad-instance','message-getter','known']){globalThis.kind=kind;globalThis.traps=0;let error;try{await runRoutineCommand(['routine','plan','--root','/synthetic/.bowerloom','--experiment-id','synthetic','--experiment-digest','sha256:'+'b'.repeat(64)]);}catch(e){error=e;}
      const expected=kind==='known'?'ROUTINE_FILES_CHANGED':kind==='message-getter'?'ROUTINE_FILES_UNSAFE':'ROUTINE_READ_FAILED';assert.equal(error.code,expected);assert.equal(error.message.includes('PRIVATE'),false);assert.equal(globalThis.traps,0);results.push({kind,code:error.code,traps:globalThis.traps});}
    hook.deregister();process.stdout.write(JSON.stringify(results));
  `.replaceAll('\\`','`');
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000,maxBuffer:65536});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(JSON.parse(result.stdout).length,7);
});
