import { createHash } from 'node:crypto';
import { RecipeError } from './types.js';
import type { GitHubPort, Pull, RecipeSpec, RemoteFile, WriteReceipt } from './types.js';
import { branch, clone, fail, path, sha, specCopy } from './validation.js';
import {blobSha,expectedWriteTree,treeSha} from './git-tree.js';
import type {TreeEntry} from './git-tree.js';
/** REST-only adapter: one sealed repository, fixed API host, no redirects, no retry. */
export class GitHubConnection implements GitHubPort {
  readonly owner: string; readonly repo: string; readonly #spec: RecipeSpec;
  constructor(spec: RecipeSpec, readonly token: () => Promise<string>, readonly transport: typeof fetch = fetch, readonly stopSignal?: AbortSignal) {
    this.#spec = specCopy(spec); this.owner = spec.github.owner; this.repo = spec.github.repo;
  }
  #branch(v: string, writing = false): string {
    if (!branch(v) || (writing ? !v.startsWith(this.#spec.github.branchPrefix + '/') : v !== this.#spec.github.baseBranch && !v.startsWith(this.#spec.github.branchPrefix + '/'))) fail('BRANCH_SCOPE');
    return v.split('/').map(encodeURIComponent).join('/');
  }
  async #request(method: string, route: string, body?: unknown): Promise<any> {
    const token = await this.token(); if (typeof token !== 'string' || !token || token.length > 16384 || /[\r\n]/.test(token)) fail('CREDENTIAL_UNAVAILABLE');
    const abort = AbortSignal.any([AbortSignal.timeout(15000),...(this.stopSignal?[this.stopSignal]:[])]);
    if(abort.aborted)throw new RecipeError(method === 'GET' ? 'GITHUB_READ_UNAVAILABLE' : 'GITHUB_WRITE_UNKNOWN');
    let response: Response;
    try { response = await this.transport(`https://api.github.com/repos/${this.owner}/${this.repo}/${route}`, {
      method, redirect: 'error', signal: abort,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }); } catch { throw new RecipeError(method === 'GET' ? 'GITHUB_READ_UNAVAILABLE' : 'GITHUB_WRITE_UNKNOWN'); }
    if (response.status === 404 && method === 'GET') { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new RecipeError(method === 'GET' ? 'GITHUB_READ_REFUSED' : 'GITHUB_WRITE_UNKNOWN'); }
    const reader = response.body?.getReader(); if (!reader) fail('GITHUB_RESPONSE');
    const pieces: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 512 * 1024) fail('GITHUB_RESPONSE_LIMIT'); pieces.push(part.value); } }
    finally { await reader.cancel().catch(()=>{}); }
    try { return clone(JSON.parse(Buffer.concat(pieces).toString('utf8'))); } catch { return fail('GITHUB_RESPONSE'); }
  }
  async ref(value: string): Promise<string | null> {
    const row = await this.#request('GET',`git/ref/heads/${this.#branch(value)}`);
    if (row === null) return null;
    if (row.ref !== `refs/heads/${value}` || row.object?.type !== 'commit' || !sha(row.object.sha)) fail('GITHUB_REF'); return row.object.sha;
  }
  async #commit(value:string):Promise<{sha:string;tree:{sha:string};parents:{sha:string}[];message:string}>{
    if(!sha(value))fail('GITHUB_COMMIT');const row=await this.#request('GET',`git/commits/${value}`);
    if(!row||row.sha!==value||!sha(row.tree?.sha)||!Array.isArray(row.parents)||row.parents.some((p:any)=>!sha(p.sha))||typeof row.message!=='string')fail('GITHUB_COMMIT');
    return row;
  }
  async #tree(value:string):Promise<TreeEntry[]>{
    const row=await this.#request('GET',`git/trees/${value}`);
    if(!row||row.sha!==value||row.truncated||!Array.isArray(row.tree))fail('GITHUB_TREE');
    const entries=row.tree.map((e:any)=>({path:e.path,mode:e.mode,type:e.type,sha:e.sha})) as TreeEntry[];
    if(treeSha(entries)!==value)fail('GITHUB_TREE_HASH');return entries;
  }
  async verifyWrite(value:string,p:string,content:string,expectedParent:string,message:string):Promise<WriteReceipt|null>{
    this.#branch(value,true);if(p!==this.#spec.github.draftPath||!sha(expectedParent)||Buffer.byteLength(content)>131072)fail('PATH_SCOPE');
    const head=await this.ref(value);if(!head)return null;
    const commit=await this.#commit(head);
    if(commit.parents.length!==1||commit.parents[0]!.sha!==expectedParent||commit.message!==message)fail('WRITE_COMMIT_DRIFT');
    const parent=await this.#commit(expectedParent),blob=blobSha(content);
    const tree=await expectedWriteTree(parent.tree.sha,p.split('/'),blob,t=>this.#tree(t));
    if(commit.tree.sha!==tree)fail('WRITE_TREE_DRIFT');
    // Immutable commit proof plus a final live-ref check; no mutable content-only adoption.
    if(await this.ref(value)!==head)fail('HEAD_DRIFT');
    return{head,parent:expectedParent,tree,blob};
  }
  async file(value: string, ref: string): Promise<RemoteFile | null> {
    if (!path(value) || (value !== this.#spec.github.draftPath && !value.startsWith(this.#spec.github.evidencePrefix + '/'))) fail('PATH_SCOPE');
    const commit = sha(ref) ? ref : await this.ref(ref); if (!commit) return null;
    let treeId = commit; const segments = value.split('/'); let blob: string | null = null;
    for (let i = 0; i < segments.length; i++) {
      const tree = await this.#request('GET',`git/trees/${treeId}`);
      if (!tree || tree.truncated || !Array.isArray(tree.tree)) fail('GITHUB_TREE');
      const entries = tree.tree.filter((entry: any) => entry.path === segments[i]); if (!entries.length) return null;
      if (entries.length !== 1 || !sha(entries[0].sha)) fail('GITHUB_TREE'); const entry = entries[0];
      if (i < segments.length - 1) { if (entry.mode !== '040000' || entry.type !== 'tree') fail('GITHUB_SPECIAL_PATH'); treeId = entry.sha; }
      else { if (!['100644','100755'].includes(entry.mode) || entry.type !== 'blob') fail('GITHUB_SPECIAL_PATH'); blob = entry.sha; }
    }
    const row = await this.#request('GET',`contents/${value.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`);
    if (row === null) return null;
    if (row.type !== 'file' || row.path !== value || row.encoding !== 'base64' || !sha(row.sha) || typeof row.content !== 'string'
      || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > 131072) fail('GITHUB_FILE');
    const data = Buffer.from(row.content.replace(/\n/g,''),'base64');
    const gitSha = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    if (data.length !== row.size || !Buffer.from(data.toString('utf8')).equals(data) || row.sha !== blob || gitSha !== blob) fail('GITHUB_FILE');
    return { sha: row.sha, content: data.toString('utf8') };
  }
  #pull(row: any): Pull {
    if (!row || !Number.isSafeInteger(row.number) || row.number < 1 || typeof row.draft !== 'boolean' || !['open','closed'].includes(row.state)
      || row.head?.repo?.full_name !== `${this.owner}/${this.repo}` || row.base?.repo?.full_name !== `${this.owner}/${this.repo}`
      || !sha(row.head?.sha) || !sha(row.base?.sha) || typeof row.title !== 'string' || typeof row.body !== 'string' || row.html_url !== `https://github.com/${this.owner}/${this.repo}/pull/${row.number}`) fail('GITHUB_PULL');
    this.#branch(row.head.ref,true); if (row.base.ref !== this.#spec.github.baseBranch) fail('GITHUB_PULL');
    return { number: row.number, draft: row.draft, state: row.state, head: row.head.ref, headSha:row.head.sha, base: row.base.ref, baseSha:row.base.sha, title: row.title, body: row.body, url: row.html_url };
  }
  async pull(value: string): Promise<Pull | null> {
    this.#branch(value,true);
    const rows = await this.#request('GET',`pulls?state=all&head=${encodeURIComponent(`${this.owner}:${value}`)}&per_page=2`);
    if (!Array.isArray(rows) || rows.length > 1) fail('PULL_AMBIGUOUS'); return rows.length ? this.#pull(rows[0]) : null;
  }
  async createBranch(value: string, commit: string): Promise<void> { this.#branch(value,true); if (!sha(commit)) fail('GITHUB_REF'); await this.#request('POST','git/refs',{ref:`refs/heads/${value}`,sha:commit}); }
  async writeFile(value: string, p: string, content: string, previousSha: string | null, expectedHead: string, message: string): Promise<void> {
    this.#branch(value,true); if (p !== this.#spec.github.draftPath || Buffer.byteLength(content) > 131072 || (previousSha !== null && !sha(previousSha))) fail('PATH_SCOPE');
    if (!sha(expectedHead) || await this.ref(value) !== expectedHead || (await this.file(p,expectedHead))?.sha !== (previousSha ?? undefined)) fail('HEAD_DRIFT');
    const parent = await this.#commit(expectedHead);
    const blob = await this.#request('POST','git/blobs',{content:Buffer.from(content).toString('base64'),encoding:'base64'}); if (!sha(blob?.sha)) fail('GITHUB_BLOB');
    const tree = await this.#request('POST','git/trees',{base_tree:parent.tree.sha,tree:[{path:p,mode:'100644',type:'blob',sha:blob.sha}]}); if (!sha(tree?.sha)) fail('GITHUB_TREE');
    const commit = await this.#request('POST','git/commits',{message,tree:tree.sha,parents:[expectedHead]}); if (!sha(commit?.sha)) fail('GITHUB_COMMIT');
    // Refuse divergent changes, but do not claim an exact CAS: a concurrent rewind can remain fast-forwardable.
    // verifyWrite separately proves the resulting commit's parent and complete single-path tree.
    await this.#request('PATCH',`git/refs/heads/${this.#branch(value,true)}`,{sha:commit.sha,force:false});
  }
  async createPull(value: string, base: string, title: string, body: string, expectedHead:string): Promise<void> {
    this.#branch(value,true); if (base !== this.#spec.github.baseBranch) fail('BRANCH_SCOPE');
    if(!sha(expectedHead)||await this.ref(value)!==expectedHead)fail('HEAD_DRIFT');
    await this.#request('POST','pulls',{ head:value,base,title,body,draft:true,maintainer_can_modify:false });
  }
  async updatePull(number: number, title: string, body: string, value:string, expectedHead:string): Promise<void> {
    this.#branch(value,true);
    if (!Number.isSafeInteger(number) || number < 1) fail('GITHUB_PULL');
    const current = this.#pull(await this.#request('GET',`pulls/${number}`));
    if (!current.draft || current.state !== 'open') fail('DRAFT_ONLY');
    if(current.head!==value||!sha(expectedHead)||current.headSha!==expectedHead||await this.ref(value)!==expectedHead)fail('HEAD_DRIFT');
    await this.#request('PATCH',`pulls/${number}`,{title,body});
  }
}
