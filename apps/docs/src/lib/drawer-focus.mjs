// Fumadocs' mobile aside supplies its close button but no Escape/focus scope.
export function attachDrawerFocus(drawer,doc,onClose) {
  const previous=doc.activeElement;
  const attributes=['role','aria-modal','aria-label'].map(name=>[name,drawer.getAttribute(name)]);
  drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','Documentation navigation');
  const controls=()=>[...drawer.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(x=>!x.disabled&&x.tabIndex>=0&&x.getClientRects().length);
  const searching=()=>Boolean(doc.querySelector('.docs-search-dialog[data-state="open"]'));
  const focusFirst=()=>controls()[0]?.focus();
  const keydown=event=>{
    if(searching()||event.defaultPrevented)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const items=controls(),first=items[0],last=items.at(-1);
    if(!first){event.preventDefault();return;}
    if(!drawer.contains(doc.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
    else if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
  };
  const focusin=event=>{if(!searching()&&!drawer.contains(event.target))focusFirst();};
  doc.addEventListener('keydown',keydown,true);doc.addEventListener('focusin',focusin);
  (drawer.querySelector('button[aria-label="Close Sidebar"]')??controls()[0])?.focus();
  return ()=>{
    doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('focusin',focusin);
    for(const [name,value]of attributes){if(value===null)drawer.removeAttribute(name);else drawer.setAttribute(name,value);}
    if(previous?.isConnected&&!searching())previous.focus();
  };
}
