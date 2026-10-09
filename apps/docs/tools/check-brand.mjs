import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {unsupportedPublicInstalls} from './install-guard.mjs';
const root=resolve(import.meta.dirname,'../..');
const landing=await readFile(resolve(root,'landing/src/brand.css'),'utf8');
const docs=await readFile(resolve(root,'docs/src/styles/theme.css'),'utf8');
const themes=css=>[...css.matchAll(/--brand-(ground|surface|ink|muted|rose|foliage|clay|water|line|action|action-ink):\s*(#[\da-f]{6})/gi)].map(m=>`${m[1]}:${m[2].toUpperCase()}`);
const accepted=new Set(themes(landing));
for(const token of themes(docs))assert(accepted.has(token),`Unapproved token ${token}`);
assert.equal(themes(docs).length,22);
for(const dir of ['newsreader','manrope'])for(const file of dir==='newsreader'?['roman.ttf','italic.ttf','OFL.txt']:['font.ttf','OFL.txt'])assert.deepEqual(await readFile(resolve(root,'docs/public/fonts',dir,file)),await readFile(resolve(root,'landing/public/fonts',dir,file)));
for(const name of ['s4-g3-icon.svg','s4-g3-icon-dark.svg','bowerloom-wordmark-plain-ink.svg','bowerloom-wordmark-plain-cream.svg'])assert.deepEqual(await readFile(resolve(root,'docs/public/brand',name)),await readFile(resolve(root,'landing/public/brand/rose-conservatory',name)));
const userPages=[...['index','start','setup','revision','stop','cli','backend','mcp','releases','beta-guide','troubleshooting','guides/add-skills'].map(page=>`docs/src/content/docs/${page}.md`),'../README.md'];
for(const page of userPages){
 const text=await readFile(resolve(root,page),'utf8');
 assert(!text.includes('node dist/'),`${page}: checkout executable in user path`);
 // The public beta installs by its dist-tag or exact version. A bare or latest install would get the stable stream, which does not exist yet.
 assert.deepEqual(unsupportedPublicInstalls(text),[],`${page}: unsupported public install`);
}
console.log(JSON.stringify({approvedColorTokens:22,identicalFontAndLicenseFiles:5,identicalLogoFiles:4,normalUserPagesChecked:userPages.length,limitations:'Source and byte-parity checks only; responsive/browser review and beta artifact acceptance remain separate.'},null,2));
