// Read rendered element attributes, not escaped code, comments or script text.
const decode = value => value.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|(amp|quot|apos|lt|gt));/gi, (whole,numeric,named)=>{
  if(numeric){const n=numeric[0].toLowerCase()==='x'?parseInt(numeric.slice(1),16):Number(numeric);return n>0&&n<=0x10ffff?String.fromCodePoint(n):whole;}
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[named.toLowerCase()];
});
export function htmlIds(html) {
  const text=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const ids=[];
  for(const tag of text.matchAll(/<[a-z][\w:-]*\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    for(const attr of tag[1].matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if(attr[1].toLowerCase()==='id')ids.push(decode(attr[2]??attr[3]??attr[4]??''));
    }
  }
  return ids;
}
export function duplicateHtmlIds(html) {
  const seen=new Set(),duplicates=new Set();
  for(const id of htmlIds(html)){if(seen.has(id))duplicates.add(id);seen.add(id);}
  return [...duplicates];
}
export function missingLegacyAliases(oldIds,html) {
  const present=new Set(htmlIds(html));
  return [...new Set(oldIds)].filter(id=>!id.startsWith('starlight')&&id!=='theme-icons'&&!present.has(id));
}
