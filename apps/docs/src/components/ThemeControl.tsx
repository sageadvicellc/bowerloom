import {useEffect,useRef,useState} from 'react';
import type {ThemePreference} from '../../../landing/src/theme';
import {mountDocsTheme,themeControlLabel} from '../lib/theme-control.mjs';

// Preserve the accepted landing icons and accessible state/next-state wording.
function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return <svg key={preference} className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {preference === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
      : preference === 'dark' ? <path d="M20.4 14.3A8.7 8.7 0 0 1 9.7 3.6a8.8 8.8 0 1 0 10.7 10.7Z" />
      : <><circle cx="12" cy="12" r="5" /><path d="M12 7a5 5 0 0 0 0 10Z" fill="currentColor" stroke="none" /><path d="M12 2v2m0 16v2M2 12h2M4.9 4.9l1.4 1.4m-1.4 12.8 1.4-1.4M20 7v3m-1.5-1.5h3" /></>}
  </svg>;
}

export default function ThemeControl() {
  // Deterministic SSR markup. The head script has already resolved the colors;
  // mount reads saved preference before applying any client-side theme change.
  const [preference,setPreference]=useState<ThemePreference>('system');
  const control=useRef<ReturnType<typeof mountDocsTheme>|null>(null);
  useEffect(()=>{
    const mounted=mountDocsTheme(window,document,setPreference);
    control.current=mounted;
    return ()=>{mounted.dispose();control.current=null;};
  },[]);
  const label=themeControlLabel(preference);
  return <button className="theme-control theme-toggle" id="docs-theme" type="button" data-preference={preference} aria-label={label} title={label} onClick={()=>control.current?.next()}><ThemeIcon preference={preference}/></button>;
}
