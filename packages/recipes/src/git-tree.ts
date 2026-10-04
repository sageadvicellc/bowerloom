import {createHash} from 'node:crypto';
import {fail,sha} from './validation.js';
export interface TreeEntry {path:string;mode:string;type:'blob'|'tree'|'commit';sha:string}
export const blobSha=(content:string):string=>{const bytes=Buffer.from(content);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
/** Full non-recursive tree bytes, using Git's directory-aware byte ordering. */
export function treeSha(entries:TreeEntry[]):string{
  const seen=new Set<string>();
  for(const e of entries){
    if(typeof e.path!=='string'||!e.path||e.path.includes('/')||e.path.includes('\0')||seen.has(e.path)||!sha(e.sha)
      || !((e.type==='tree'&&e.mode==='040000')||(e.type==='commit'&&e.mode==='160000')||(e.type==='blob'&&['100644','100755','120000'].includes(e.mode))))fail('GITHUB_TREE');
    seen.add(e.path);
  }
  const sorted=[...entries].sort((a,b)=>Buffer.compare(Buffer.from(a.path+(a.type==='tree'?'/':'')),Buffer.from(b.path+(b.type==='tree'?'/':''))));
  const bytes=Buffer.concat(sorted.map(e=>Buffer.concat([Buffer.from(`${e.mode==='040000'?'40000':e.mode} ${e.path}\0`),Buffer.from(e.sha,'hex')])));
  return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
}
/** Rebuild only ancestors of one fixed path. Every other entry is preserved byte-for-byte. */
export async function expectedWriteTree(parentTree:string,parts:string[],blob:string,read:(tree:string)=>Promise<TreeEntry[]>):Promise<string>{
  async function replace(tree:string|null,index:number):Promise<string>{
    const entries=tree===null?[]:await read(tree),name=parts[index]!;
    const old=entries.find(e=>e.path===name);
    if(index===parts.length-1){
      if(old&&(old.type!=='blob'||!['100644','100755'].includes(old.mode)))fail('GITHUB_SPECIAL_PATH');
      return treeSha([...entries.filter(e=>e.path!==name),{path:name,mode:'100644',type:'blob',sha:blob}]);
    }
    if(old&&(old.type!=='tree'||old.mode!=='040000'))fail('GITHUB_SPECIAL_PATH');
    const child=await replace(old?.sha??null,index+1);
    return treeSha([...entries.filter(e=>e.path!==name),{path:name,mode:'040000',type:'tree',sha:child}]);
  }
  return replace(parentTree,0);
}
