import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getDocuments,indexMarkdown} from '../src/lib/content.mjs';
const dist=new URL('../dist/',import.meta.url),docs=await getDocuments();
let pairs=0;
for(const doc of docs){
  const markdown=doc.markdownUrl?await readFile(new URL((doc.slug||'index')+'.md',dist),'utf8'):doc.markdown;
  if(doc.markdownUrl)assert.equal(markdown,doc.markdown,`Markdown mismatch: ${doc.url}`);
  const html=await readFile(new URL(doc.slug==='404'?'404.html':doc.slug?doc.slug+'/index.html':'index.html',dist),'utf8');
  assert(html.includes(`data-content-sha256="${doc.contentHash}"`),`HTML snapshot mismatch: ${doc.url}`);
  assert(html.includes(doc.html),`HTML body mismatch: ${doc.url}`);
  for(const id of doc.aliases)assert(html.includes(`id="${id}"`),`Lost legacy anchor: ${doc.url}#${id}`);
  if(doc.copy.prompt){pairs++;assert(markdown.includes(doc.copy.prompt));assert(html.includes('Copy prompt'));assert(html.includes('Copy procedure'));}
}
assert.equal(await readFile(new URL('llms.txt',dist),'utf8'),indexMarkdown(docs));
assert.equal(await readFile(new URL('llms-full.txt',dist),'utf8'),docs.filter(d=>!d.hidden).map(d=>d.markdown).join('\n\n---\n\n'));
const search=JSON.parse(await readFile(new URL('search.json',dist),'utf8'));assert.equal(search.type,'simple');
console.log(JSON.stringify({pages:docs.length,pairedPages:pairs,htmlMarkdownParity:true,legacyAnchors:true,staticSearch:true,sourceWrites:0}));
