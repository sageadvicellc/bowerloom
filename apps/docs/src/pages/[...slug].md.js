import {getDocuments} from '../lib/content.mjs';
export const prerender=true;
export async function getStaticPaths(){return (await getDocuments()).filter(page=>page.markdownUrl).map(page=>({params:{slug:page.slug||'index'},props:{page}}));}
export function GET({props}) {return new Response(props.page.markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8'}});}
