import test from 'node:test';
import {attachDrawerFocus} from '../src/lib/drawer-focus.mjs';
import assert from 'node:assert/strict';
import {documentationSources} from '../src/lib/build-paths.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {htmlIds,duplicateHtmlIds,missingLegacyAliases} from '../src/lib/html-ids.mjs';
import {copyFeedback} from '../src/lib/copy-feedback.mjs';
import {expandRelease,readRelease,releaseReference,releaseSections} from '../src/lib/release.mjs';
import {pairedCopy,normalizeNotices,markdownSections,getDocuments,indexMarkdown,searchIndexes,pageTree} from '../src/lib/content.mjs';

test('resolved release block refuses unknown markers and preserves unavailable installation in copy',async()=>{
  const release=await readRelease();
  const resolved=expandRelease('Before\n<!-- release:install:start -->STALE<!-- release:install:end -->\nAfter',release);
  assert(!resolved.includes('STALE'));assert(resolved.includes(release.npm.installCommand));
  if(!release.npm.published)assert.match(resolved,/Do not run it before this exact version is published/);
  assert.throws(()=>expandRelease('<!-- release:unknown:start -->x<!-- release:unknown:end -->',release));
  assert.throws(()=>expandRelease('<!-- release:status:start -->',release));
});
test('paired copy keeps prerequisite and refusal context, handles headings inside code, and distinguishes prompt',()=>{
  const page='# Title\n\n## Prerequisites\nExact approval required.\n\n## Ask your agent\nHelp me review this plan.\n\n## Agent procedure\n```sh\n# Ask your agent\nbowerloom init --help\n```\n\n## On refusal\nStop; preserve files.\n';
  const copy=pairedCopy(page);assert.equal(copy.prompt,'Help me review this plan.');
  assert.match(copy.procedure,/Exact approval required/);assert.match(copy.procedure,/Stop; preserve files/);assert.match(copy.procedure,/bowerloom init --help/);assert(!copy.procedure.includes('Help me review this plan.'));
  assert.equal(markdownSections(page).sections.filter(x=>x.title==='Ask your agent').length,1);
  assert.deepEqual(pairedCopy('## Ask your agent\nHello'),{prompt:null,procedure:null});
  assert.equal(pairedCopy('## Ask your agent\n```text\nReview this.\n```\n## Agent procedure\nWait.').prompt,'Review this.');
});
test('notice conversion remains plain readable Markdown and preserves fenced literals',()=>{
  assert.equal(normalizeNotices(':::caution[Approval]\nWait.\n:::'),'> **caution: Approval**\n> Wait.\n');
  const code='```md\n:::note\n```';assert.equal(normalizeNotices(code),code);
  assert.throws(()=>normalizeNotices(':::note\nunclosed'));
});
test('real document snapshot retains routes and matching Markdown/HTML support boundaries',async()=>{
  const docs=await getDocuments();assert(docs.length>=18);assert(docs.some(x=>x.url==='/docs/'));
  for(const d of docs){assert(d.markdown.includes(d.body));assert(d.contentHash.match(/^[a-f0-9]{64}$/));assert(!d.markdown.includes('<!-- release:'));assert(!d.markdown.includes('/Users/'));if(d.copy.procedure)assert(d.copy.procedure.includes('Agent procedure'));}
  const index=indexMarkdown(docs);assert(!index.includes('/docs/404.md'));for(const d of docs.filter(d=>d.hidden))assert(!index.includes('https://bowerloom.ai'+d.markdownUrl));
  const search=searchIndexes(docs);for(const doc of docs.filter(d=>!d.hidden)){assert(search.some(x=>x.url===doc.url&&x.content===doc.markdown));for(const heading of doc.headings)assert(search.some(x=>x.url===doc.url+'#'+heading.slug));}
  for(const doc of docs.filter(d=>d.hidden))assert(!search.some(x=>x.url.startsWith(doc.url)));
});

test('all exports and copied procedures identify the exact shared release and support boundary',async()=>{
  const release=await readRelease(),docs=await getDocuments();
  const reference=releaseReference(release);
  assert.match(reference,/Release-record SHA256: `[a-f0-9]{64}`/);
  assert(reference.includes(`State: ${release.state}`));assert(reference.includes(release.version));
  assert(reference.includes(release.urls.repository));assert(reference.includes(new URL('status/',release.urls.docs).href));
  const raw=await readFile(new URL('../../../release/beta.json',import.meta.url));
  assert.equal(release.sourceRecordSha256,createHash('sha256').update(raw).digest('hex'));
  for(const doc of docs){
    assert(doc.markdown.includes(reference),doc.url);
    if(doc.copy.procedure)assert(doc.copy.procedure.includes(reference),doc.url);
  }
  assert(indexMarkdown(docs).includes(reference));
});
test('support section distinguishes tested systems from the exact release-qualified list or empty state',async()=>{
  const release=await readRelease();
  const support=releaseSections(release).support;
  for(const row of release.systems.tested)for(const value of [row.os,row.architecture,row.node,row.scope])assert(support.includes(value));
  assert(support.includes(`Release-qualified systems for \`${release.version}\``));
  if(!release.systems.releaseQualified.length)assert(support.includes('No operating system is recorded as release-qualified yet.'));
  const qualified=releaseSections({...release,systems:{...release.systems,releaseQualified:[{os:'SyntheticOS',architecture:'synthetic64',node:'24.11.0',scope:'fixture only'}]}}).support;
  assert(qualified.includes('SyntheticOS synthetic64'));assert(qualified.includes('fixture only'));
  assert(!qualified.includes('No operating system is recorded as release-qualified yet.'));
});
test('rendered raw anchors suppress legacy aliases and duplicate IDs fail the shared link rule',()=>{
  const html='<h2 id="title">Title</h2><a id="old-anchor"></a><a title=" id=not-an-id" id=bare></a><span id="escaped&#45;id"></span><!-- <a id="ignored"> --><script>"<a id=script>"</script><pre>&lt;a id="code"&gt;</pre>';
  assert.deepEqual(htmlIds(html),['title','old-anchor','bare','escaped-id']);
  assert.deepEqual(missingLegacyAliases(['title','old-anchor','bare','escaped-id','missing','missing','starlight__x','theme-icons'],html),['missing']);
  assert.deepEqual(duplicateHtmlIds(html),[]);
  assert.deepEqual(duplicateHtmlIds(html+'<span id="old-anchor"></span><a id="escaped-id"></a>'),['old-anchor','escaped-id']);
});
test('advanced navigation remains collapsed except when a child is selected',async()=>{
  const docs=await getDocuments(),name='Guides: Connections and shared work';
  const page=docs.find(d=>d.group===name&&!d.hidden);assert(page,'advanced guides must exist');
  const folder=tree=>tree.children.find(x=>x.name===name);
  assert.equal(folder(pageTree(docs)).defaultOpen,false);
  assert.equal(folder(pageTree(docs,'/docs/')).defaultOpen,false);
  assert.equal(folder(pageTree(docs,page.url)).defaultOpen,true);
});
test('clipboard success and refusal identify the requested block',()=>{
  for(const kind of ['prompt','procedure','page Markdown']){
    assert.equal(copyFeedback(kind,true),`Copied ${kind}.`);
    assert(copyFeedback(kind,false).includes(`Could not copy ${kind}.`));
  }
  assert.throws(()=>copyFeedback('unknown',true));
});


test('build source paths stay anchored to configured source root after prerender relocation',()=>{
  const source='file:///synthetic/repository/apps/docs/';
  const original=source+'src/lib/build-paths.mjs';
  const relocated=source+'dist/.prerender/chunks/content.mjs';
  const expected={release:'file:///synthetic/repository/release/beta.json',content:source+'src/content/docs/'};
  for(const paths of [documentationSources(original),documentationSources(relocated,source)]){
    assert.equal(paths.release.href,expected.release);assert.equal(paths.content.href,expected.content);
  }
  assert.notEqual(documentationSources(relocated).release.href,expected.release,'bundled relative imports alone must not be relied upon');
});

test('mobile drawer closes with Escape, traps Tab, defers to search, and restores trigger focus',()=>{
  const listeners=new Map(),attrs=new Map(),doc={activeElement:null,search:false,querySelector(){return this.search?{}:null;},addEventListener(k,f){listeners.set(k,f);},removeEventListener(k){listeners.delete(k);}};
  const button=()=>({tabIndex:0,isConnected:true,getClientRects(){return [{}];},focus(){doc.activeElement=this;}});
  const trigger=button(),first=button(),last=button();doc.activeElement=trigger;
  const drawer={getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelector:()=>first,querySelectorAll:()=>[first,last],contains:x=>[first,last].includes(x)};
  let closed=0;const cleanup=attachDrawerFocus(drawer,doc,()=>closed++);
  assert.equal(doc.activeElement,first);assert.equal(attrs.get('aria-modal'),'true');
  const key=(key,shiftKey=false)=>{const event={key,shiftKey,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};listeners.get('keydown')(event);return event;};
  assert(key('Tab',true).defaultPrevented);assert.equal(doc.activeElement,last);
  assert(key('Tab').defaultPrevented);assert.equal(doc.activeElement,first);
  doc.search=true;assert(!key('Escape').defaultPrevented);assert.equal(closed,0);
  doc.search=false;assert(key('Escape').defaultPrevented);assert.equal(closed,1);
  cleanup();assert.equal(listeners.size,0);assert.equal(doc.activeElement,trigger);assert.equal(attrs.size,0);
});
