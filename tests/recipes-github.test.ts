import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {GitHubConnection} from '../packages/recipes/src/index.js';
import {blobSha,treeSha,expectedWriteTree} from '../packages/recipes/src/git-tree.js';
import type {TreeEntry} from '../packages/recipes/src/git-tree.js';
import {spec} from './recipes-fixtures.js';
const branch=`${spec.github.branchPrefix}/fixed`,base='c'.repeat(40);
function transport(handler:(method:string,route:string,body:any)=>unknown){const calls:{method:string;route:string;body:any}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api.github.com');assert.ok(url.pathname.startsWith('/repos/example/labs/'));
    assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal((init?.headers as any).Authorization,'Bearer private-test-token');
    const method=init?.method??'GET',route=url.pathname.slice('/repos/example/labs/'.length)+url.search,body=init?.body?JSON.parse(String(init.body)):null;calls.push({method,route,body});
    const value=handler(method,route,body);return new Response(JSON.stringify(value),{status:value===null?404:200});};
  return{calls,connection:new GitHubConnection(spec,async()=>'private-test-token',fetcher)};}
test('GitHub draft creation forces draft and scopes every URL; unsafe branch rejects before transport',async()=>{
  const t=transport((_m,r)=>r.startsWith('git/ref/')?{ref:`refs/heads/${branch}`,object:{type:'commit',sha:base}}:{number:1});await t.connection.createPull(branch,'main','Title','Body',base);
  assert.deepEqual(t.calls[1],{method:'POST',route:'pulls',body:{head:branch,base:'main',title:'Title',body:'Body',draft:true,maintainer_can_modify:false}});
  await assert.rejects(t.connection.createBranch('main',base),{code:'BRANCH_SCOPE'});assert.equal(t.calls.length,2);
});
test('file write constructs a single-path commit from the exact approved parent and never force-updates',async()=>{
  const t=transport((method,route)=>{
    if(route===`git/ref/heads/${branch}`)return{ref:`refs/heads/${branch}`,object:{type:'commit',sha:base}};
    if(route===`git/trees/${base}`)return{tree:[],truncated:false};
    if(route===`git/commits/${base}`)return{sha:base,tree:{sha:'1'.repeat(40)},parents:[],message:'base'};
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
function writeProofFixture(){
  const content='approved draft',message='fixed approval message',head='d'.repeat(40),trees=new Map<string,TreeEntry[]>();
  const keep:TreeEntry={path:'keep.txt',mode:'100644',type:'blob',sha:blobSha('keep')};
  const parentEntries=[keep],parentTree=treeSha(parentEntries);trees.set(parentTree,parentEntries);
  const child:TreeEntry[]=[{path:'experiment.md',mode:'100644',type:'blob',sha:blobSha(content)}];const childTree=treeSha(child);
  const resultingTree=treeSha([...parentEntries,{path:'drafts',mode:'040000',type:'tree',sha:childTree}]);
  const commits=new Map([[base,{sha:base,tree:{sha:parentTree},parents:[],message:'base'}],[head,{sha:head,tree:{sha:resultingTree},parents:[{sha:base}],message}]]);
  let currentHead=head;
  const t=transport((method,route)=>{
    assert.equal(method,'GET');
    if(route===`git/ref/heads/${branch}`)return{ref:`refs/heads/${branch}`,object:{type:'commit',sha:currentHead}};
    if(route.startsWith('git/commits/'))return commits.get(route.slice('git/commits/'.length))??null;
    if(route.startsWith('git/trees/')){const sha=route.slice('git/trees/'.length);return{sha,truncated:false,tree:trees.get(sha)};}
    throw Error('unexpected route');
  });
  return{...t,head,content,message,parentTree,resultingTree,trees,commits,setHead:(v:string)=>{currentHead=v;}};
}
test('write proof binds exact parent, message and complete single-path Git tree with unchanged siblings',async()=>{
  const f=writeProofFixture();assert.deepEqual(await f.connection.verifyWrite(branch,spec.github.draftPath,f.content,base,f.message),
    {head:f.head,parent:base,tree:f.resultingTree,blob:blobSha(f.content)});
  assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('write proof rejects extra descendant, same-parent extra tree change, unrelated head and message drift',async()=>{
  for(const kind of ['descendant','extra-tree','unrelated','message']){
    const f=writeProofFixture(),commit=f.commits.get(f.head)!;
    if(kind==='descendant')commit.parents=[{sha:'e'.repeat(40)}];
    if(kind==='extra-tree')commit.tree.sha=treeSha([{path:'unapproved.txt',mode:'100644',type:'blob',sha:blobSha('unapproved')}]);
    if(kind==='unrelated')commit.parents=[];
    if(kind==='message')commit.message='unapproved';
    await assert.rejects(f.connection.verifyWrite(branch,spec.github.draftPath,f.content,base,f.message),{code:kind==='extra-tree'?'WRITE_TREE_DRIFT':'WRITE_COMMIT_DRIFT'});
  }
});
test('write proof validates parent tree object hash and refuses invalid entries and symlink parent',async()=>{
  const f=writeProofFixture();f.trees.get(f.parentTree)![0]!.sha=blobSha('tampered');
  await assert.rejects(f.connection.verifyWrite(branch,spec.github.draftPath,f.content,base,f.message),{code:'GITHUB_TREE_HASH'});
  const g=writeProofFixture(),entries:TreeEntry[]=[{path:'drafts',mode:'120000',type:'blob',sha:blobSha('outside')}],tree=treeSha(entries);
  g.trees.set(tree,entries);g.commits.get(base)!.tree.sha=tree;
  await assert.rejects(g.connection.verifyWrite(branch,spec.github.draftPath,g.content,base,g.message),{code:'GITHUB_SPECIAL_PATH'});
  for(const entries of [[{path:'x',mode:'100644',type:'blob',sha:base},{path:'x',mode:'100644',type:'blob',sha:base}],
    [{path:'../x',mode:'100644',type:'blob',sha:base}],[{path:'x',mode:'100644',type:'tree',sha:base}]])assert.throws(()=>treeSha(entries as TreeEntry[]));
});
test('Git tree reconstruction preserves non-target executable, link and subtree entries',async()=>{
  assert.equal(treeSha([]),'4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  const oldDrafts:TreeEntry[]=[{path:'other.md',mode:'100755',type:'blob',sha:blobSha('other')}];
  const tree=treeSha(oldDrafts),entries:TreeEntry[]=[{path:'drafts',mode:'040000',type:'tree',sha:tree},{path:'link',mode:'120000',type:'blob',sha:blobSha('target')}];
  const root=treeSha(entries),blob=blobSha('new');
  const expected=treeSha([{...entries[0]!,sha:treeSha([...oldDrafts,{path:'experiment.md',mode:'100644',type:'blob',sha:blob}])},entries[1]!]);
  assert.equal(await expectedWriteTree(root,['drafts','experiment.md'],blob,async s=>s===root?entries:oldDrafts),expected);
});
test('PR create and update refuse changed branch before sending a mutation',async()=>{
  const t=transport(()=>({ref:`refs/heads/${branch}`,object:{type:'commit',sha:'e'.repeat(40)}}));
  await assert.rejects(t.connection.createPull(branch,'main','Title','Body',base),{code:'HEAD_DRIFT'});assert.equal(t.calls.filter(c=>c.method!=='GET').length,0);
  const pull={number:1,draft:true,state:'open',title:'Title',body:'Body',html_url:'https://github.com/example/labs/pull/1',head:{ref:branch,sha:base,repo:{full_name:'example/labs'}},base:{ref:'main',sha:base,repo:{full_name:'example/labs'}}};
  const u=transport((_m,r)=>r==='pulls/1'?pull:{ref:`refs/heads/${branch}`,object:{type:'commit',sha:'e'.repeat(40)}});
  await assert.rejects(u.connection.updatePull(1,'Title','Body',branch,base),{code:'HEAD_DRIFT'});assert.equal(u.calls.filter(c=>c.method!=='GET').length,0);
});

test('tree encoding matches a Git hash-object vector with directory-aware sort order',()=>{
  assert.equal(treeSha([{path:'drafts0',mode:'100644',type:'blob',sha:'64'.repeat(20)},
    {path:'drafts',mode:'040000',type:'tree',sha:'63'.repeat(20)},
    {path:'drafts.c',mode:'100644',type:'blob',sha:'62'.repeat(20)}]),'026cb7ec290de3822991eb68f4f66437daf1876c');
});
