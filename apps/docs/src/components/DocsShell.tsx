import {useEffect, useRef, useState, type ReactNode} from 'react';
import {RootProvider} from 'fumadocs-ui/provider/astro';
import {DocsLayout} from 'fumadocs-ui/layouts/docs';
import {DocsPage} from 'fumadocs-ui/layouts/docs/page';
import type {Root} from 'fumadocs-core/page-tree';
import Search from './Search';
import {useSidebar} from 'fumadocs-ui/components/sidebar/base';
import {attachDrawerFocus} from '../lib/drawer-focus.mjs';
import {copyFeedback} from '../lib/copy-feedback.mjs';

type Heading = {depth:number;slug:string;text:string};
type Document = {title:string;description:string;url:string;markdownUrl:string|null;markdown:string;html:string;headings:Heading[];aliases:string[];contentHash:string;copy:{prompt:string|null;procedure:string|null};release:{version:string;statusLabel:string}};
function Copy({text,kind,children}:{text:string;kind:'prompt'|'procedure'|'page Markdown';children:ReactNode}) {
  const [status,setStatus]=useState('');
  return <span className="copy-control"><button type="button" className="docs-button" onClick={async()=>{
    try {await navigator.clipboard.writeText(text);setStatus(copyFeedback(kind,true));}
    catch {setStatus(copyFeedback(kind,false));}
  }}>{children}</button><span className="copy-feedback" role="status">{status}</span></span>;
}
function DrawerKeyboard() {
  const {open,mode,setOpen}=useSidebar();
  useEffect(()=>{
    if(!open||mode!=='drawer')return;
    const drawer=document.getElementById('nd-sidebar-mobile');
    if(drawer)return attachDrawerFocus(drawer,document,()=>setOpen(false));
  },[open,mode,setOpen]);
  return null;
}
export default function DocsShell({tree,page}:{tree:Root;page:Document}) {
  const article=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const controls:HTMLButtonElement[]=[];
    for(const pre of article.current?.querySelectorAll('pre')??[]) {
      const code=pre.querySelector('code');if(!code)continue;
      const button=document.createElement('button');button.type='button';button.className='code-copy';button.textContent='Copy code';button.setAttribute('aria-live','polite');
      button.setAttribute('aria-label','Copy code example');
      button.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent??'');button.textContent='Code copied';}catch{button.textContent='Select code to copy';}};
      const container=document.createElement('div');container.className='code-example';pre.before(container);container.append(pre,button);controls.push(button);
    }
    return ()=>{for(const button of controls){const wrapper=button.parentElement;const pre=wrapper?.querySelector('pre');if(pre&&wrapper)wrapper.replaceWith(pre);}};
  },[page.html]);
  return <RootProvider pathname={page.url} theme={{enabled:false}} search={{SearchDialog:Search}}>
    <DocsLayout tree={tree} nav={{title:'Bowerloom docs',url:'/docs/'}} themeSwitch={{enabled:false}}>
      <DrawerKeyboard/>
      <DocsPage id="main-content" tabIndex={-1} className="bowerloom-doc" toc={page.headings.map(h=>({depth:h.depth,title:h.text,url:'#'+h.slug}))}>
        <header className="article-heading"><h1>{page.title}</h1>{page.description&&<p className="article-description">{page.description}</p>}
          <p className="release-line"><a href="/docs/status/">{page.release.statusLabel}</a><span> · </span><code>{page.release.version}</code></p>
        </header>
        {page.markdownUrl&&<div className="page-actions" aria-label="Use this page with your agent">
          {page.copy.prompt&&<Copy text={page.copy.prompt} kind="prompt">Copy prompt</Copy>}
          {page.copy.procedure&&<Copy text={page.copy.procedure} kind="procedure">Copy procedure</Copy>}
          <Copy text={page.markdown} kind="page Markdown">Copy page Markdown</Copy>
          <a className="docs-button docs-button-link" href={page.markdownUrl}>Open Markdown</a>
        </div>}
        {page.aliases.map(id=><span key={id} id={id} className="legacy-anchor" aria-hidden="true"/>)}
        <div ref={article} className="docs-prose" data-content-sha256={page.contentHash} dangerouslySetInnerHTML={{__html:page.html}}/>
        <aside className="reference-note">These instructions are reference material. Review the exact plan before approving any action.</aside>
      </DocsPage>
    </DocsLayout>
  </RootProvider>;
}
