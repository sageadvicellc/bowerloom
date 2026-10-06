import {getDocuments} from '../lib/content.mjs';
export const prerender=true;
export async function GET(){return new Response((await getDocuments()).filter(d=>!d.hidden).map(d=>d.markdown).join('\n\n---\n\n'),{headers:{'Content-Type':'text/plain; charset=utf-8'}});}
