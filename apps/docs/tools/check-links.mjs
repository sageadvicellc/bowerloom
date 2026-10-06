import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
const dist=resolve(import.meta.dirname,'../dist');
const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat();
const files=await walk(dist),html=files.filter(f=>extname(f)==='.html'),failures=[];let checked=0;
for(const file of html){
 const text=await readFile(file,'utf8');
 const pagePath='/docs/'+file.slice(dist.length+1).replace(/index\.html$/,'');
 for(const match of text.matchAll(/\b(?:href|src)="([^"]+)"/g)){
  const raw=match[1].replaceAll('&amp;','&');if(/^(?:https?:|data:|mailto:|tel:)/.test(raw))continue;
  const url=new URL(raw,'https://bowerloom.ai'+pagePath);if(!url.pathname.startsWith('/docs/')){if(url.pathname!=='/')failures.push(`${pagePath}: outside docs ${raw}`);continue;}
  let destination=join(dist,decodeURIComponent(url.pathname.slice(6)));
  if(url.pathname.endsWith('/'))destination=join(destination,'index.html');
  try{if(!(await stat(destination)).isFile())throw Error('not file');checked++;}catch{failures.push(`${pagePath}: missing ${raw}`);continue;}
  if(url.hash&&destination.endsWith('.html')){
   const target=await readFile(destination,'utf8'),id=decodeURIComponent(url.hash.slice(1));
   if(!target.includes(`id="${id}"`))failures.push(`${pagePath}: missing fragment ${raw}`);
  }
 }
 if(/\/Users\/|file:\/\/|BEGIN PRIVATE KEY/.test(text))failures.push(`${pagePath}: private path or material`);
 if(!/class="home-links"[^>]*>[\s\S]*?href="\/"[\s\S]*?Main site[\s\S]*?href="\/docs\/"[\s\S]*?Docs home/.test(text))failures.push(`${pagePath}: persistent home navigation missing`);
 if(!text.includes('noindex'))failures.push(`${pagePath}: preview indexing gate missing`);
}
const search=files.filter(f=>f.includes('/pagefind/'));if(search.length===0)failures.push('Pagefind index absent');
for(const asset of ['fonts/newsreader/roman.ttf','fonts/newsreader/italic.ttf','fonts/manrope/font.ttf','brand/s4-g3-icon.svg','brand/s4-g3-icon-dark.svg','brand/bowerloom-wordmark-plain-ink.svg','brand/bowerloom-wordmark-plain-cream.svg'])await stat(join(dist,asset));
const bytes=(await Promise.all(files.map(async f=>(await stat(f)).size))).reduce((a,b)=>a+b,0);
console.log(JSON.stringify({htmlPages:html.length,localLinksAndAssetsChecked:checked,searchFiles:search.length,totalBuiltBytes:bytes,failures},null,2));
process.exitCode=failures.length?1:0;
