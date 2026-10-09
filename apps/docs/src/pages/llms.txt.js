import {getDocuments,indexMarkdown} from '../lib/content.mjs';
export const prerender=true;
export async function GET(){return new Response(indexMarkdown(await getDocuments()),{headers:{'Content-Type':'text/plain; charset=utf-8'}});}
