import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {GitHubConnection} from '../packages/recipes/src/index.js';
import {spec} from './recipes-fixtures.js';
const branch=`${spec.github.branchPrefix}/fixed`,base='c'.repeat(40);
function transport(handler:(method:string,route:string,body:any)=>unknown){const calls:{method:string;route:string;body:any}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api.github.com');assert.ok(url.pathname.startsWith('/repos/example/labs/'));
    assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal((init?.headers as any).Authorization,'Bearer private-test-token');
    const method=init?.method??'GET',route=url.pathname.slice('/repos/example/labs/'.length)+url.search,body=init?.body?JSON.parse(String(init.body)):null;calls.push({method,route,body});
    const value=handler(method,route,body);return new Response(JSON.stringify(value),{status:value===null?404:200});};
  return{calls,connection:new GitHubConnection(spec,async()=>'private-test-token',fetcher)};}
test('GitHub draft creation forces draft and scopes every URL; unsafe branch rejects before transport',async()=>{
  const t=transport(()=>({number:1}));await t.connection.createPull(branch,'main','Title','Body');
  assert.deepEqual(t.calls[0],{method:'POST',route:'pulls',body:{head:branch,base:'main',title:'Title',body:'Body',draft:true,maintainer_can_modify:false}});
  await assert.rejects(t.connection.createBranch('main',base),{code:'BRANCH_SCOPE'});assert.equal(t.calls.length,1);
});
test('file write constructs a single-path commit from the exact approved parent and never force-updates',async()=>{
  const t=transport((method,route)=>{
    if(route===`git/ref/heads/${branch}`)return{ref:`refs/heads/${branch}`,object:{type:'commit',sha:base}};
    if(route===`git/trees/${base}`)return{tree:[],truncated:false};
    if(route===`git/commits/${base}`)return{tree:{sha:'1'.repeat(40)}};
    if(route==='git/blobs')return{sha:'2'.repeat(40)};if(route==='git/trees')return{sha:'3'.repeat(40)};if(route==='git/commits')return{sha:'4'.repeat(40)};
    if(method==='PATCH')return{};throw Error('unexpected synthetic route');
  });
  await t.connection.writeFile(branch,spec.github.draftPath,'draft',null,base,'fixed message');
  assert.deepEqual(t.calls.find(c=>c.route==='git/trees')!.body,{base_tree:'1'.repeat(40),tree:[{path:spec.github.draftPath,mode:'100644',type:'blob',sha:'2'.repeat(40)}]});
  assert.deepEqual(t.calls.find(c=>c.route==='git/commits')!.body,{message:'fixed message',tree:'3'.repeat(40),parents:[base]});
  assert.deepEqual(t.calls.at(-1)!.body,{sha:'4'.repeat(40),force:false});
});
test('parent or target symlink and submodule entries are refused',async()=>{
  for(const mode of ['120000','160000']){const t=transport(()=>({tree:[{path:'drafts',type:'blob',mode,sha:'1'.repeat(40)}]}));await assert.rejects(t.connection.file(spec.github.draftPath,base),{code:'GITHUB_SPECIAL_PATH'});}
  const t=transport((_m,r)=>r===`git/trees/${base}`?{tree:[{path:'drafts',type:'tree',mode:'040000',sha:'1'.repeat(40)}]}:{tree:[{path:'experiment.md',type:'blob',mode:'120000',sha:'2'.repeat(40)}]});
  await assert.rejects(t.connection.file(spec.github.draftPath,base),{code:'GITHUB_SPECIAL_PATH'});
});
test('immutable file retrieval validates regular blob content SHA and bounded metadata',async()=>{
  const bytes=Buffer.from('verified'),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const t=transport((_m,r)=>r===`git/trees/${base}`?{tree:[{path:'drafts',mode:'040000',type:'tree',sha:'1'.repeat(40)}]}:r==='git/trees/'+'1'.repeat(40)?{tree:[{path:'experiment.md',mode:'100644',type:'blob',sha:blob}]}:{type:'file',path:spec.github.draftPath,encoding:'base64',sha:blob,size:bytes.length,content:bytes.toString('base64')});
  assert.deepEqual(await t.connection.file(spec.github.draftPath,base),{sha:blob,content:'verified'});
});
test('ambiguous HTTP write is not retried and raw remote error bodies never escape',async()=>{
  let calls=0;const c=new GitHubConnection(spec,async()=>'secret',async()=>{calls++;return new Response('credential=PRIVATE',{status:503});});
  await assert.rejects(c.createBranch(branch,base),(error:any)=>error.code==='GITHUB_WRITE_UNKNOWN'&&!String(error).includes('PRIVATE'));assert.equal(calls,1);
});
