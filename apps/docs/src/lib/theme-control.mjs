import {themePreference,nextThemePreference,resolveTheme,THEME_STORAGE_KEY} from '../../../landing/src/theme.ts';
export {THEME_STORAGE_KEY};
const names={light:'Light (day)',dark:'Dark (night)',system:'System (day and night)'};
export function themeControlLabel(preference) {
  return `Theme: ${names[preference]}. Switch to ${names[nextThemePreference(preference)]}.`;
}
export function mountDocsTheme(host,page,onPreference) {
  const media=host.matchMedia('(prefers-color-scheme: dark)');
  const read=()=>{try{return themePreference(host.localStorage.getItem(THEME_STORAGE_KEY));}catch{return 'system';}};
  let preference=read(),active=true;
  const apply=()=>{
    if(!active)return;
    const resolved=resolveTheme(preference,media.matches);
    page.documentElement.dataset.theme=resolved;
    page.documentElement.classList.toggle('dark',resolved==='dark');
    page.documentElement.style.colorScheme=resolved;
    page.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='dark'?'#27262B':'#F6EEE8');
    page.querySelector('link[rel="icon"]')?.setAttribute('href',`/docs/brand/${resolved==='dark'?'s4-g3-icon-dark.svg':'s4-g3-icon.svg'}`);
    onPreference(preference);
  };
  const sync=event=>{if(event.key===THEME_STORAGE_KEY||event.key===null){preference=read();apply();}};
  media.addEventListener('change',apply);host.addEventListener('storage',sync);apply();
  return {
    next(){if(!active)return;preference=nextThemePreference(preference);apply();try{host.localStorage.setItem(THEME_STORAGE_KEY,preference);}catch{/* Page preference remains usable without storage. */}},
    dispose(){active=false;media.removeEventListener('change',apply);host.removeEventListener('storage',sync);},
  };
}
