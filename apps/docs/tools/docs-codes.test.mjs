// Spec 10 of beta.3, tests D1 to D29: the page "Where your items come from" and the docs that beta.3 made untrue.
// It reads files only. The refusal codes and the format strings come from the source, never from a list typed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';

const docsApp=resolve(import.meta.dirname,'..');
const repo=resolve(docsApp,'../..');
const docs=resolve(docsApp,'src/content/docs');
const read=path=>readFileSync(path,'utf8');
const doc=name=>read(join(docs,name));
const PAGE_FILE=join(docs,'guides/item-sources.md');
const page=()=>read(PAGE_FILE);
const lines=text=>text.split('\n');

// 4.2: the refusal codes new since beta.2, from the REFUSALS block of the CLI.
const CODE_LINE=/^  ([A-Z][A-Z0-9_]+): \{/;
const baseline=new Set(JSON.parse(read(resolve(import.meta.dirname,'beta2-refusal-codes.json'))));
export function newCodes(){
  const all=lines(read(join(repo,'apps/cli/src/human.ts')));
  const start=all.findIndex(l=>l.startsWith('const REFUSALS')),end=all.findIndex(l=>l.startsWith('const GATE_REFUSALS'));
  assert.ok(start>=0&&end>start,'human.ts holds const REFUSALS before const GATE_REFUSALS');
  const out=[];
  for(const l of all.slice(start,end)){const m=CODE_LINE.exec(l);if(m&&!baseline.has(m[1])&&!out.includes(m[1]))out.push(m[1]);}
  return out;
}

// 5.1: the codes the page explains, in their groups. The group names are the bold labels of the page's refusal table.
export const PAGE_GROUPS=[
  ['Store',['STORE_NOT_FOUND','STORE_INVALID','STORE_UNSAFE','STORE_IN_CLOUD_FOLDER','STORE_UNREADABLE','STORE_LOCKED','STORE_STATE_NESTED','STORE_NOT_A_PROJECT','STORE_WRITE_FAILED']],
  ['Store items',['STORE_ITEM_NOT_FOUND','STORE_ITEM_MISSING','STORE_ITEM_NOT_SHAREABLE','STORE_ITEM_GONE_AT_COMMIT','SKILLS_ADD_EXISTS','SKILLS_ADD_SOURCE_CHANGED']],
  ['GitHub and the store remote',['STORE_REMOTE_PRIVATE','STORE_REMOTE_AUTH_FAILED','GITHUB_TOKEN_INVALID','GITHUB_TOKEN_SSO_REQUIRED','GITHUB_RATE_LIMITED','GITHUB_REQUEST_FAILED','GITHUB_REQUEST_BUDGET']],
  ['Project and config',['PROJECT_FOLDER_UNSAFE','PROJECT_UNSAFE','CONFIG_INVALID','CONFIG_UNSAFE','CONFIG_UNREADABLE','CONFIG_LIMIT','CONFIG_DUPLICATE_ID']],
  ['Config items',['CONFIG_ITEM_SELECTED','CONFIG_ITEM_NOT_SELECTED','CONFIG_ITEM_MISSING','CONFIG_WRITE_UNCONFIRMED','TEAM_NOT_SELECTED']],
  ['Lock',['LOCK_MISSING','LOCK_INVALID','LOCK_UNSAFE','LOCK_LIMIT','LOCK_CONFIG_MISSING','LOCK_CONFIG_MISMATCH','LOCK_WRITE_UNCONFIRMED','LOCK_HASH_MISMATCH','LOCK_STORE_NOT_PUSHED','LOCK_COMMIT_UNREACHABLE','LOCK_COMMIT_GONE']],
  ['Install and sync',['SKILLS_OFFLINE','SKILLS_SYNC_CONTENT_MISMATCH','SKILLS_SYNC_INTERRUPTED','STALE_APPROVAL','ITEM_REVIEW_REQUIRED','SLICE_ROOT_MISSING','FOLDER_NOT_ALLOWED','AGENT_TARGET_OCCUPIED']],
  ['Migrate and cache',['MIGRATE_ID_EXISTS','MIGRATE_ITEM_NOT_FOUND','MIGRATE_ITEM_UNSUPPORTED','MIGRATE_RESERVED','MIGRATE_TEAM_MISSING','MIGRATE_LIMIT','CACHE_ENTRY_NOT_FOUND','CACHE_ENTRY_BUSY','CACHE_PRUNE_FAILED']],
];
export const pageCodes=PAGE_GROUPS.flatMap(([,codes])=>codes);

// 3.1: the headings, their anchors, and the subsections.
const H2=[
  ['What this page answers','page-questions'],['Four places an item comes from','four-kinds-of-item'],['The two files','config-and-lock'],
  ['If you work alone','work-alone'],['If you share a project','share-a-project'],['What a teammate does','teammate-steps'],
  ['When the store has no remote','store-has-no-remote'],['A store in a private repository','private-store'],['GitHub request limits','rate-limit'],
  ['Frozen installs and plain apply','frozen-and-plain'],['Change an item','item-changes'],['Merge conflicts in the lock','lock-conflicts'],
  ['Move a project to the store','move-to-store'],['Refusals','item-source-refusals'],['Words used on this page','words'],
];
const H3=[
  ['The sharing model in five lines','What this page answers','sharing-model'],['What to commit','If you share a project','commit-list'],
  ['Before you run','What a teammate does','check-modes'],['Every case of an unpushed store item','When the store has no remote','unpushed-cases'],
];

/** The lines of a Markdown text that sit outside fenced blocks, with their index. */
function outsideFences(text){
  const out=[];let fence=null;
  lines(text).forEach((line,index)=>{
    const m=/^\s*(`{3,}|~{3,})/.exec(line);
    if(m){if(fence===null){fence=m[1][0];return;}if(m[1][0]===fence){fence=null;return;}}
    if(fence===null)out.push({line,index});
  });
  return out;
}
/** The text of a page section: from the anchor line of `id` to the next anchor line of any level. */
function sectionOf(text,id){
  const all=lines(text),start=all.indexOf(`<a id="${id}"></a>`);
  assert.ok(start>=0,`anchor ${id} is on the page`);
  const level=all[start+2]?.startsWith('### ')?3:2;
  let end=all.length;
  for(let i=start+1;i<all.length;i++){
    if(!/^<a id="[^"]+"><\/a>$/.test(all[i]))continue;
    const next=all[i+2]??'';
    if(level===3||next.startsWith('## ')){end=i;break;}
  }
  return all.slice(start,end).join('\n');
}
/** The cells of one Markdown table row, split on pipes that are not escaped. */
function cells(row){
  const parts=[];let cur='';
  for(let i=0;i<row.length;i++){
    if(row[i]==='\\'&&row[i+1]==='|'){cur+='\\|';i++;continue;}
    if(row[i]==='|'){parts.push(cur);cur='';continue;}
    cur+=row[i];
  }
  parts.push(cur);
  return parts.slice(1,-1).map(c=>c.trim());
}
/** The first errors.md row for each code. */
function errorRows(){
  const rows=new Map();
  for(const line of lines(doc('reference/errors.md'))){
    const m=/^\| `([A-Z][A-Z0-9_]+)` \|/.exec(line);
    if(m&&!rows.has(m[1]))rows.set(m[1],cells(line));
  }
  return rows;
}
/** Every .md page under the docs content folder. */
function allPages(dir=docs){
  return readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?allPages(p):name.endsWith('.md')?[p]:[];});
}
const stripInlineCode=line=>line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g,' ');

test('D1. the page exists with the exact front matter of 3.1',()=>{
  const text=page();
  assert.ok(text.startsWith('---\ntitle: "Where your items come from"\ndescription: "See where each skill, prompt, and team comes from, what bowerloom.lock.json records, and what a teammate needs."\nsection: "Guides"\norder: 7.75\n---\n'),'front matter');
});

test('D2. the ## headings are those of 3.1, in order, each under its anchor line and one blank line',()=>{
  const text=page(),body=outsideFences(text),all=lines(text);
  const found=body.filter(({line})=>line.startsWith('## ')).map(({line,index})=>({title:line.slice(3),index}));
  assert.deepEqual(found.map(f=>f.title),H2.map(([t])=>t));
  for(const [i,f] of found.entries()){
    assert.equal(all[f.index-1],'',`${f.title}: one blank line above`);
    assert.equal(all[f.index-2],`<a id="${H2[i][1]}"></a>`,`${f.title}: anchor line`);
  }
});

test('D3. each ### heading of 3.1 sits under its ## parent, with its anchor line and one blank line',()=>{
  const text=page(),all=lines(text),body=outsideFences(text);
  for(const [title,parent,id] of H3){
    const at=body.find(({line})=>line===`### ${title}`);
    assert.ok(at,`### ${title}`);
    assert.equal(all[at.index-1],'',`${title}: one blank line above`);
    assert.equal(all[at.index-2],`<a id="${id}"></a>`,`${title}: anchor line`);
    const above=body.filter(({line,index})=>line.startsWith('## ')&&index<at.index).pop();
    assert.equal(above?.line,`## ${parent}`,`${title} sits under ${parent}`);
  }
});

test('D4. every code of 5.1 appears on the page inside backticks',()=>{
  const text=page();
  const missing=pageCodes.filter(code=>!text.includes(`\`${code}\``));
  assert.deepEqual(missing,[]);
});

test('D5. every new refusal code has a row in errors.md',()=>{
  const codes=newCodes(),text=doc('reference/errors.md');
  assert.ok(codes.length>=94,`${codes.length} codes`);
  assert.ok(codes.includes('LOCK_COMMIT_GONE'));
  const missing=codes.filter(code=>!new RegExp(`^\\| \`${code}\` \\|`,'m').test(text));
  assert.deepEqual(missing,[]);
});

test('D6. the refusal table holds the codes of 5.1 under the eight labels, with the cells of errors.md',()=>{
  const section=sectionOf(page(),'item-source-refusals'),rows=errorRows();
  const groups=[];let label=null;
  for(const line of lines(section)){
    const bold=/^\*\*([^*]+)\*\*$/.exec(line);
    if(bold){label=bold[1];groups.push([label,[]]);continue;}
    const m=/^\| `([A-Z][A-Z0-9_]+)` \|/.exec(line);
    if(!m)continue;
    assert.ok(label!==null,`${m[1]} sits under a label`);
    groups.at(-1)[1].push(m[1]);
    const want=rows.get(m[1]),got=cells(line);
    assert.ok(want,`${m[1]} has an errors.md row`);
    assert.equal(got.length,3,`${m[1]}: three cells`);
    assert.equal(got[1],want[1],`${m[1]}: what it means`);
    assert.equal(got[2],want[2],`${m[1]}: what to do`);
  }
  assert.deepEqual(groups,PAGE_GROUPS);
  assert.match(section,/\(\/docs\/reference\/errors\/\)/);
});

const RELEASE_LABELS=['New commands','Projects and the store','Sharing','Agents and context slices','Install','Changed formats','Known limits'];
function betaThree(){
  const text=doc('releases.md'),start=text.indexOf('\n## 0.7.0-beta.3\n');
  assert.ok(start>=0,'releases.md holds ## 0.7.0-beta.3');
  const end=text.indexOf('\n## ',start+1);
  return text.slice(start,end<0?undefined:end);
}
test('D7. releases.md groups beta.3 under the seven labels, in order, with no Fixes label',()=>{
  const section=betaThree(),found=lines(section).filter(l=>/^\*\*[^*]+\*\*$/.test(l)).map(l=>l.slice(2,-2));
  assert.deepEqual(found,RELEASE_LABELS);
  assert.doesNotMatch(section,/^\*\*Fixes\*\*$/m);
  for(const label of RELEASE_LABELS)assert.match(section,new RegExp(`^\\*\\*${label}\\*\\*\\n\\n- `,'m'),`${label}: a blank line, then the list`);
});

const FORMAT=/bowerloom\/[a-z-]+\/v1(?:alpha|beta)[0-9]+/g;
function sourceFormats(){
  const out=new Set();
  const walk=dir=>{for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())walk(p);else if(/\.(ts|mts|js|mjs)$/.test(name))for(const m of read(p).matchAll(FORMAT))out.add(m[0]);}};
  for(const pkg of readdirSync(join(repo,'packages'))){const src=join(repo,'packages',pkg,'src');try{if(statSync(src).isDirectory())walk(src);}catch{}}
  walk(join(repo,'apps/cli/src'));
  return [...out].sort();
}
test('D8. every format string new since beta.2 appears in the beta.3 release notes',()=>{
  const old=new Set(JSON.parse(read(resolve(import.meta.dirname,'beta2-formats.json')))),section=betaThree();
  const added=sourceFormats().filter(f=>!old.has(f));
  assert.ok(added.length>=37,`${added.length} new formats`);
  assert.deepEqual(added.filter(f=>!section.includes(`\`${f}\``)),[]);
  assert.match(section,/Scripts that read `format` must accept the new names\./);
});

test('D9. the private-store section holds the token promises and names the commands that read it',()=>{
  const section=sectionOf(page(),'private-store');
  for(const phrase of ['api.github.com','never stores','never prints','refuses redirects','Credentials:','--approve'])assert.ok(section.includes(phrase),phrase);
  for(const command of ['apply --frozen','skills sync','use','lock update','store migrate'])assert.ok(section.includes(`\`${command}\``),command);
  assert.ok(section.includes('sync step of `up`'),'sync step of `up`');
});

const BANNED=/\b(can|could|may|might|should|would)\b/i;
test('D10. outside code and the refusal table, the page has no semicolon and none of the banned words',()=>{
  const text=page(),all=lines(text);
  const tableStart=all.indexOf('<a id="item-source-refusals"></a>'),tableEnd=all.indexOf('<a id="words"></a>');
  assert.ok(tableStart>0&&tableEnd>tableStart);
  const front=all.indexOf('---',1);
  const offenders=[];
  for(const {line,index} of outsideFences(text)){
    if(index<=front||(index>=tableStart&&index<tableEnd))continue;
    const prose=stripInlineCode(line);
    if(prose.includes(';')||BANNED.test(prose))offenders.push(`${index+1}: ${line}`);
  }
  assert.deepEqual(offenders,[]);
});

test('D11. the page names neither Fearless nor Advanced Metrics',()=>{
  assert.doesNotMatch(page(),/Fearless|Advanced Metrics/i);
});

test('D12. the project folder line of cli.md names bowerloom.json',()=>{
  const line=lines(doc('cli.md')).find(l=>l.startsWith('These commands work in a project folder.'));
  assert.ok(line?.includes('bowerloom.json'));
});

test('D13. add-skills.md points private stores at the page and drops the old limit sentences',()=>{
  const text=doc('guides/add-skills.md');
  assert.ok(text.includes('without credentials'));
  assert.ok(text.includes('/docs/guides/item-sources/#private-store'));
  const share=text.slice(text.indexOf('\n## Share a project\n'),text.indexOf('\n## ',text.indexOf('\n## Share a project\n')+1));
  assert.ok(share.includes('(/docs/guides/item-sources/)'),'## Share a project links the page');
  assert.ok(!text.includes('Private registries and private repositories are not supported in this beta.'));
  assert.ok(!text.includes('Private registries and private repositories are not supported.'));
});

test('D14. guides/index.md links the page',()=>{assert.ok(doc('guides/index.md').includes('(/docs/guides/item-sources/)'));});

test('D15. check-brand.mjs lists guides/item-sources',()=>{assert.ok(read(resolve(import.meta.dirname,'check-brand.mjs')).includes("'guides/item-sources'"));});

test('D16. the pages of specs 01a and 05 keep their front matter',()=>{
  assert.ok(doc('guides/agents.md').startsWith('---\ntitle: Project agents for Claude Code\ndescription: Put team agents in .claude/agents with bowerloom apply.\nsection: Guides\norder: 7.8\n---\n'));
  assert.ok(doc('guides/context-slices.md').startsWith('---\ntitle: Context slices for agents\ndescription: Give each agent only its part of a knowledge base, and measure the difference.\nsection: Guides\norder: 7.9\n---\n'));
});

test('D17. status.md and cli.md split the Codex sentence',()=>{
  for(const name of ['status.md','cli.md']){
    const text=doc(name);
    assert.ok(text.includes('Codex agents are not projected in this beta. Context slices are projected for Claude Code only.'),name);
    assert.ok(!text.includes('Codex agents and context slices are not projected'),name);
  }
});

test('D18. guides/context-slices.md keeps the guard limits',()=>{
  const text=doc('guides/context-slices.md');
  for(const s of ['What the guard does not stop','not a security boundary','cannot prove answer quality','cannot prove what an agent actually reads','cannot prove that Claude\'s tokenizer agrees'])assert.ok(text.includes(s),s);
  assert.match(text,/^#+ What the guard does not stop$/m);
});

test('D19. guides/agents.md keeps the revise limit',()=>{
  assert.ok(doc('guides/agents.md').includes('`bowerloom revise` refuses while `.bowerloom/teams/first-team/agents` exists. Move the folder out, revise, then move it back.'));
});

test('D20. start.md and releases.md say the tarball carries its dependencies',()=>{
  for(const name of ['start.md','releases.md'])assert.ok(doc(name).includes('The file carries its dependencies, so it installs with no network and no npm cache.'),name);
});

const PUBLIC_PAGES=['cli.md','reference/errors.md','start.md','setup.md','revision.md','harnesses.md','troubleshooting.md','status.md','learn/first-team.md','guides/new-workspace.md','guides/existing-project.md','guides/recover-revision.md'];
test('D21. the public-sources sentence names pinned skills, in the 12 pages and the README',()=>{
  const readme=read(join(repo,'README.md'));
  for(const p of allPages())assert.ok(!read(p).includes('reads skills only from public sources'),relative(docs,p));
  assert.ok(!readme.includes('reads skills only from public sources'));
  for(const name of PUBLIC_PAGES){
    const text=doc(name);
    assert.ok(text.includes('This beta reads pinned skills only from public sources.'),name);
    assert.ok(text.includes('A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains.'),name);
  }
  assert.ok(readme.includes('Pinned skills come from public sources only.'));
});

test('D22. configuration.md commits the new files, and the clone sentences are replaced',()=>{
  const conf=doc('configuration.md'),skills=doc('guides/add-skills.md'),errors=doc('reference/errors.md');
  for(const path of ['bowerloom.json','bowerloom.lock.json','.bowerloom/slices/','.claude/agents/'])assert.match(conf,new RegExp(`^\\| \`${path.replaceAll('.','\\.')}\` \\|`,'m'),path);
  const old='`bowerloom up --team <name>` and `team create` refuse with `PROJECT_BRIEF_INVALID`';
  assert.ok(!conf.includes(old));assert.ok(!skills.includes(old));
  assert.ok(!errors.includes('`bowerloom up --team` and `team create` refuse this way'));
});

test('D23. troubleshooting.md has the teammate and clone entries, each linking the page',()=>{
  const text=doc('troubleshooting.md');
  for(const heading of ['## My teammate cannot install my store items','## A clone refuses PROJECT_UNSAFE or PROJECT_FOLDER_UNSAFE']){
    const start=text.indexOf(`\n${heading}\n`);
    assert.ok(start>=0,heading);
    const end=text.indexOf('\n## ',start+1),section=text.slice(start,end<0?undefined:end);
    assert.ok(section.includes('/docs/guides/item-sources/'),heading);
  }
});

test('D24. errors.md: the request budget and the lock limit rows',()=>{
  const rows=errorRows();
  assert.ok(rows.get('GITHUB_REQUEST_BUDGET').join(' ').includes('--max-github-requests'));
  assert.ok(rows.get('LOCK_LIMIT').join(' ').includes('126 files'));
});

test('D25. cli.md: the help topics, the Store and lock section, sync, and the token paragraph',()=>{
  const text=doc('cli.md'),human=lines(read(join(repo,'apps/cli/src/human.ts')));
  const topics=human.map(l=>/^  ([a-z]+): \[/.exec(l)?.[1]).filter(Boolean);
  assert.ok(topics.length>=15,topics.join(' '));
  const help=lines(text).find(l=>l.includes('These commands have it:'));
  assert.ok(help,'help sentence');
  for(const key of [...topics,'init'])assert.ok(help.includes(`\`${key}\``),key);
  const start=text.indexOf('\n## Store and lock\n');
  assert.ok(start>=0,'## Store and lock');
  assert.ok(text.slice(start,text.indexOf('\n## ',start+1)).includes('(/docs/guides/item-sources/)'));
  assert.ok(start<text.indexOf('\n## Cache\n'),'Store and lock comes before Cache');
  const sync=lines(text).find(l=>l.startsWith('`skills sync` installs the skills that the project selects'));
  assert.ok(sync?.includes('--frozen')&&sync.includes('--max-github-requests'),'skills sync paragraph');
  const token=lines(text).find(l=>l.includes('Six commands read it:'));
  assert.ok(token?.includes('`store migrate`'),'token paragraph');
});

test('D26. What to commit and Before you run name their files and codes',()=>{
  const text=page(),commit=sectionOf(text,'commit-list'),modes=sectionOf(text,'check-modes');
  for(const s of ['bowerloom.json','bowerloom.lock.json','.bowerloom/authoring/receipt.json','.claude/agents'])assert.ok(commit.includes(s),s);
  for(const s of ['PROJECT_FOLDER_UNSAFE','PROJECT_UNSAFE','CONFIG_UNSAFE','LOCK_UNSAFE','umask 022','chmod -R go-w .'])assert.ok(modes.includes(s),s);
});

test('D27. teams-and-files links the page, and create-items names the store',()=>{
  assert.ok(doc('concepts/teams-and-files.md').includes('(/docs/guides/item-sources/)'));
  assert.ok(doc('guides/create-items.md').includes('or inside your store with `--global`'));
});

const FIVE_LINES=[
  'Your store, ~/.bowerloom, stays on your machine. No teammate reads it.',
  'A shared project has bowerloom.lock.json, or sits in a git repository with a remote named origin.',
  'In a shared project, the lock records each store item. A teammate fetches each item you wrote from the GitHub copy of your store.',
  'So push the store to GitHub before you lock an item you wrote, and never rewrite or delete that branch afterward.',
  'Commit bowerloom.json and bowerloom.lock.json. A teammate runs bowerloom apply --frozen.',
];
test('D28. the sharing model in five lines, exactly',()=>{
  const section=sectionOf(page(),'sharing-model');
  const items=lines(section).filter(l=>/^\d+\. /.test(l)).map(l=>l.replace(/^\d+\. /,'').replaceAll('`',''));
  assert.deepEqual(items,FIVE_LINES);
});

test('D29. no docs page and not the README names a private path',()=>{
  const forms=['Sage\\ Advice','~/Sage Advice','/Sage Advice/'];
  for(const p of [...allPages(),join(repo,'README.md')]){
    const text=read(p);
    for(const form of forms)assert.ok(!text.includes(form),`${relative(repo,p)}: ${form}`);
  }
});
