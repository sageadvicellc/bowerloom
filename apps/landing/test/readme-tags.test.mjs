import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url);
const release=JSON.parse(await readFile(new URL('release/beta.json',root),'utf8'));
test('release badges are local flat monospace tags, one each for version, license, node, npm and the two supported engines',async()=>{
 const readme=await readFile(new URL('README.md',root),'utf8');
 const paragraph=readme.match(/<p>\s*<a href="https:\/\/bowerloom.ai\/docs\/releases\/">[\s\S]*?<\/p>/)?.[0];
 assert.ok(paragraph);assert.equal((paragraph.match(/<a /g)||[]).length,6);assert.doesNotMatch(paragraph,/<br|<div|<table|style=|badge-access|shields\.io/);
 const tags=[['version',new URL('releases/',release.urls.docs).href],['license','LICENSE'],['node','package.json'],['npm','#install-bowerloom'],['claude-code','#how-it-works'],['codex','#how-it-works']];
 for(const[name,href]of tags){
  assert.ok(paragraph.includes(`<a href="${href}"><img src="docs/assets/badge-${name}.svg" alt="`),name);
  const alt=paragraph.match(new RegExp(`badge-${name}\\.svg" alt="([^"]+)"`))?.[1];assert.ok(alt&&alt.length>3,`${name} keeps alt text`);
  const svg=(await readFile(new URL(`docs/assets/badge-${name}.svg`,root))).toString();
  assert.match(svg,/font-family="monospace"/,name);assert.match(svg,/shape-rendering="crispEdges"/,`${name}: pixel-sharp, square corners`);assert.doesNotMatch(svg.replace(/xmlns="[^"]*"/,''),/\brx=|<image|href=|https?:/,name);
  assert.match(svg,/role="img" aria-label="[^"]{3,}"/,`${name}: the file names itself for a screen reader`);
  if(href.startsWith('#'))assert.match(readme,new RegExp(`^## ${href==='#install-bowerloom'?'Install Bowerloom':'How it works'}$`,'m'));else if(!href.startsWith('https:'))assert.ok((await readFile(new URL(href,root))).length);
 }
 assert.ok((await readFile(new URL('docs/assets/badge-version.svg',root))).toString().toLowerCase().includes(release.version));
 assert.match(paragraph,/Engine: Claude Code/);assert.match(paragraph,/Engine: Codex/);
 const pkg=JSON.parse(await readFile(new URL('package.json',root)));assert.equal(pkg.version,release.version);assert.match(pkg.engines.node,/24\.11/);
 assert.doesNotMatch(paragraph,/\/Users\/|file:\/\/|private alpha|beta released/i);
});
