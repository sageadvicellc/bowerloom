import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url);
test('historical tags keep original bytes and claims in one wrapping inline paragraph',async()=>{
 const readme=await readFile(new URL('README.md',root),'utf8');
 const paragraph=readme.match(/<p>\s*<a href="https:\/\/github.com\/sageadvicellc\/bowerloom\/releases\/tag\/v0.7.0-alpha.0">[\s\S]*?<\/p>/)?.[0];
 assert.ok(paragraph);assert.equal((paragraph.match(/<a /g)||[]).length,4);assert.doesNotMatch(paragraph,/<br|<div|<table|style=|badge-access/);
 const tags=[['version','https://github.com/sageadvicellc/bowerloom/releases/tag/v0.7.0-alpha.0','d52fc9eef57f0457a7b57368c26f6b6c448defbdd0e346d1ef046b75cad0373e'],['license','LICENSE','a8c84e87ee08ac19fd2dcbf1cd52fe9d209237723bd6b90df55f583c3c72a4f6'],['node','package.json','0478ed3a682dd9cf8c97bcfcb6d824395c465ce9d3fa1bcdc787cf813f23b0d7'],['npm','#prepare-the-development-checkout','32d786c3ee1eda3562c6fef83f592fb281f281ebcbc53441e20bad52f3a06705']];
 for(const[name,href,hash]of tags){assert.ok(paragraph.includes(`<a href="${href}"><img src="docs/assets/badge-${name}.svg"`));const bytes=await readFile(new URL(`docs/assets/badge-${name}.svg`,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);assert.match(bytes.toString(),/font-family="monospace"/);if(href.startsWith('#'))assert.match(readme,/^### Prepare the development checkout$/m);else if(!href.startsWith('https:'))assert.ok((await readFile(new URL(href,root))).length);}
 const pkg=JSON.parse(await readFile(new URL('package.json',root)));assert.equal(pkg.version,'0.7.0-alpha.0');assert.match(pkg.engines.node,/24\.11/);
 assert.doesNotMatch(paragraph,/\/Users\/|file:\/\/|private alpha|beta released/i);
});
