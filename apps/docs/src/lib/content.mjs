import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createMarkdownProcessor, parseFrontmatter} from '@astrojs/markdown-remark';
import {readRelease, expandRelease, releaseReference} from './release.mjs';
import {missingLegacyAliases} from './html-ids.mjs';
import {sourcePaths} from './build-paths.mjs';
import legacy from './legacy-routes.json' with {type:'json'};

const contentRoot = sourcePaths.content;
const knownGroups = [
  ['Start',['index','start','status']],
  ['Your first team',['setup','revision','stop','permissions']],
  ['Capabilities',['harnesses','mcp','company','backend','workbench']],
  ['Reference',['cli','configuration','security','releases','contributors']],
];
export const digest = value => createHash('sha256').update(value).digest('hex');
export function markdownSections(text) {
  const lines = text.split('\n'), sections = []; let fence = null;
  for (let i=0;i<lines.length;i++) {
    const marker = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0]===fence[0] && marker[1].length>=fence.length) fence=null; continue; }
    if (fence) continue;
    const heading = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) sections.push({start:i,depth:heading[1].length,title:heading[2]});
  }
  return {lines,sections};
}
export function pairedCopy(markdown) {
  const {lines,sections} = markdownSections(markdown);
  const ask = sections.find(s=>/^Ask your agent$/i.test(s.title));
  const procedure = sections.find(s=>/^Agent procedure$/i.test(s.title));
  if (!ask || !procedure) return {prompt:null,procedure:null};
  const end = sections.find(s=>s.start>ask.start && s.depth<=ask.depth)?.start ?? lines.length;
  const authoredPrompt = lines.slice(ask.start+1,end).join('\n').trim();
  const fenced = authoredPrompt.match(/^```(?:text|txt)?\n([\s\S]*?)\n```$/);
  const prompt = fenced && !fenced[1].includes('\n```') ? fenced[1] : authoredPrompt;
  // Include prerequisites and refusals outside the procedure heading too.
  const procedureText = [...lines.slice(0,ask.start),...lines.slice(end)].join('\n').trim();
  return {prompt,procedure:procedureText};
}
export function normalizeNotices(text) {
  let active = false, fence = null;
  const result = text.split('\n').map(line=>{
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence=marker[1]; else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null; }
    if (!fence && !active && /^:::(note|tip|caution|danger)(?:\[.*\])?$/.test(line)) {
      active=true; return '> **'+line.slice(3).replace(/\[(.*)\]/,': $1')+'**';
    }
    if (active && !fence && line===':::') {active=false;return '';}
    return active ? '> '+line : line;
  });
  if(active)throw new Error('Unclosed documentation notice.');
  return result.join('\n');
}
async function collect(url, prefix='') {
  const files=[];
  for(const item of await readdir(url,{withFileTypes:true})) {
    if(item.isSymbolicLink())throw new Error('Documentation symlinks are not shipping sources.');
    if(item.name.startsWith('.') || /\s\d+\./.test(item.name))continue;
    if(item.isDirectory())files.push(...await collect(new URL(item.name+'/',url),prefix+item.name+'/'));
    else if(item.isFile()&&item.name.endsWith('.md'))files.push(prefix+item.name);
  }
  return files.sort();
}
let documentPromise;
export function getDocuments() {
  // One frozen content snapshot per static build; preview serves that build.
  return documentPromise ??= readDocuments();
}
async function readDocuments() {
  const release = await readRelease();
  const renderer = await createMarkdownProcessor({syntaxHighlight:'shiki',smartypants:false,shikiConfig:{themes:{light:'github-light',dark:'github-dark'},defaultColor:false}});
  const documents=[];
  for(const file of await collect(contentRoot)) {
    const raw = await readFile(new URL(file,contentRoot),'utf8');
    const {frontmatter:meta,content} = parseFrontmatter(raw);
    if(meta.draft===true)continue;
    if(typeof meta.title!=='string'||!meta.title.trim())throw new Error(`Missing title: ${file}`);
    const slug = file.replace(/\.md$/,'').replace(/(?:^|\/)index$/,'');
    if(slug && !/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(slug))throw new Error(`Unsupported document route: ${file}`);
    const url = slug==='404'?'/docs/404.html':'/docs/'+(slug?slug+'/':'');
    const resolved = normalizeNotices(expandRelease(content,release)).trim()+'\n';
    if(/\/Users\/|file:\/\/|BEGIN PRIVATE KEY|<script\b|\bon(?:click|error|load)\s*=/i.test(resolved))throw new Error(`Unsafe or private documentation content: ${file}`);
    const rendered = await renderer.render(resolved);
    const markdown = `# ${meta.title}\n\n${meta.description?meta.description+'\n\n':''}Canonical page: https://bowerloom.ai${url}\n\n${releaseReference(release)}\n\n${resolved}`;
    const old = legacy.builtRows.find(row=>'/docs/'+row.path.replace(/index\.html$/,'')===url);
    const aliases = missingLegacyAliases(old?.ids??[],rendered.code);
    const group = meta.section ?? knownGroups.find(([,slugs])=>slugs.includes(slug||'index'))?.[0] ?? (slug.includes('/')?slug.split('/')[0].replaceAll('-',' '):'More guides');
    documents.push({file,slug,url,title:meta.title,description:meta.description??'',group,order:Number.isFinite(meta.order)?meta.order:100,
      markdown,body:resolved,html:rendered.code,headings:rendered.metadata.headings,aliases,copy:pairedCopy(markdown),
      contentHash:digest(markdown),markdownUrl:slug==='404'?null:'/docs/'+(slug||'index')+'.md',release:{version:release.version,statusLabel:release.statusLabel,reference:releaseReference(release)},hidden:slug==='404'||meta.compatibility===true});
  }
  const urls=new Set();for(const doc of documents){if(urls.has(doc.url))throw new Error('Duplicate document route.');urls.add(doc.url);}
  for(const old of legacy.sourceRows)if(old.file!=='src/content/docs/404.md'&&!urls.has(old.route))throw new Error(`Missing retained route: ${old.route}`);
  return documents;
}
export function pageTree(documents,currentUrl) {
  const groups = ['Start here','Learn','Guides','Guides: Connections and shared work','Concepts','Reference','Help',...knownGroups.map(([name])=>name),...new Set(documents.map(d=>d.group))];
  return {name:'Bowerloom docs',children:[...new Set(groups)].map(name=>({type:'folder',name,defaultOpen:name!=='Guides: Connections and shared work'||documents.some(d=>d.url===currentUrl&&d.group===name),children:documents.filter(d=>!d.hidden&&d.group===name).sort((a,b)=>a.order-b.order||a.file.localeCompare(b.file)).map(d=>({type:'page',name:d.title,url:d.url}))})).filter(g=>g.children.length)};
}
export function indexMarkdown(documents) {
  return '# Bowerloom documentation\n\n'+documents[0].release.reference+'\n\nReference only. Documentation and copied prompts grant no effect authority.\n\n'+documents.filter(d=>!d.hidden).map(d=>`- [${d.title}](https://bowerloom.ai${d.markdownUrl}): ${d.description}`).join('\n')+'\n';
}
export function searchIndexes(documents) {
  return documents.filter(d=>!d.hidden).flatMap(d=>{
    const {lines,sections}=markdownSections(d.body);
    return [{title:d.title,description:d.description,url:d.url,content:d.markdown},...sections.map((section,index)=>({
      title:d.title+' — '+section.title,url:d.url+'#'+d.headings[index].slug,
      content:lines.slice(section.start,sections[index+1]?.start??lines.length).join('\n'),
    }))];
  });
}
