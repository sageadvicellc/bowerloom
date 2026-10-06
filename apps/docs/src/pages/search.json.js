import {getDocuments,searchIndexes} from '../lib/content.mjs';
import {createSearchAPI} from 'fumadocs-core/search/server';
export const prerender=true;
export async function GET(){
  const docs=await getDocuments();
  const api=createSearchAPI('simple',{indexes:searchIndexes(docs)});
  return new Response(JSON.stringify(await api.export()),{headers:{'Content-Type':'application/json; charset=utf-8'}});
}
