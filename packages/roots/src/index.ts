import { createHash } from 'node:crypto';
import type { SourcePin, SourceDocument, CorpusPin, SyntheticCorpus, SourceGrant, KeywordQuery,
  QuotedHit, QuotedResult, RootsController, RootsDependencies } from './types.js';
export type * from './types.js';
export const ROOTS_LIMITS = Object.freeze({ sources: 64, sourceBytes: 32768, corpusBytes: 1024 * 1024,
  sourceTerms: 4096, corpusTerms: 32768, grants: 1024, principals: 64,
  queryBytes: 256, queryTerms: 16, termCodePoints: 64, hits: 5, excerptBytes: 512, responseBytes: 16384 });
export class RootsError extends Error { constructor(readonly code: string) { super(code); this.name = 'RootsError'; } }
function require(value: unknown, code: string): asserts value { if (!value) throw new RootsError(code); }
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  require(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_SHAPE');
  require([null,Object.prototype].includes(Object.getPrototypeOf(value)), 'INVALID_SHAPE');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
  require(keys.every(k => typeof k === 'string' && [...required,...optional].includes(k))
    && required.every(k => Object.hasOwn(fields,k))
    && Object.values(fields).every(d => Object.hasOwn(d,'value') && d.enumerable), 'INVALID_SHAPE');
  return Object.fromEntries(Object.entries(fields).map(([key,field]) => [key,field.value]));
}
function array(value: unknown, max: number, min = 0): unknown[] {
  require(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'INVALID_ARRAY');
  const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value,'length')?.value;
  require(Number.isSafeInteger(length) && length >= min && length <= max
    && Reflect.ownKeys(value).length === length + 1, 'ARRAY_LIMIT');
  const out: unknown[] = [];
  for (let i=0;i<length;i++) { const entry = descriptors[String(i)]; require(entry && Object.hasOwn(entry,'value') && entry.enumerable, 'INVALID_ARRAY'); out.push(entry.value); }
  return out;
}
function identifier(value: unknown): string {
  require(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,63}$/.test(value)
    && !['__proto__','constructor','prototype'].includes(value), 'INVALID_ID'); return value;
}
function text(value: unknown, max: number): string {
  require(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max
    && Buffer.from(value).toString('utf8') === value, 'TEXT_LIMIT'); return value;
}
function timestamp(value: unknown): number {
  require(Number.isSafeInteger(value) && (value as number) >= 0, 'INVALID_TIME'); return value as number;
}
function digest(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function digestPin(value: unknown): string { require(typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value), 'INVALID_DIGEST'); return value; }
function pin(value: unknown): SourcePin {
  const v = record(value,['sourceId','revision','digest']);
  return Object.freeze({sourceId:identifier(v.sourceId),revision:identifier(v.revision),digest:digestPin(v.digest)});
}
function corpusPin(value: unknown): CorpusPin {
  const v = record(value,['corpusId','revision','digest']);
  return Object.freeze({corpusId:identifier(v.corpusId),revision:identifier(v.revision),digest:digestPin(v.digest)});
}
const compare = (a: string,b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: SourcePin,b: SourcePin): boolean => a.sourceId===b.sourceId && a.revision===b.revision && a.digest===b.digest;
function document(value: unknown): SourceDocument {
  const v = record(value,['sourceId','revision','digest','text']);
  const source = pin({sourceId:v.sourceId,revision:v.revision,digest:v.digest}), content = text(v.text,ROOTS_LIMITS.sourceBytes);
  require(digest(content) === source.digest,'STALE_SOURCE_PIN'); return Object.freeze({...source,text:content});
}
/** Called by the trusted controller, never a query credential or path loader. */
export function pinSyntheticSource(sourceId: string, revision: string, content: string): SourceDocument {
  const body = text(content,ROOTS_LIMITS.sourceBytes);
  return document({sourceId,revision,text:body,digest:digest(body)});
}
function documents(value: unknown): SourceDocument[] {
  const sources = array(value,ROOTS_LIMITS.sources,1).map(document).sort((a,b)=>compare(a.sourceId,b.sourceId));
  require(new Set(sources.map(s=>s.sourceId)).size===sources.length,'DUPLICATE_SOURCE');
  require(sources.reduce((sum,s)=>sum+Buffer.byteLength(s.text),0)<=ROOTS_LIMITS.corpusBytes,'CORPUS_LIMIT'); return sources;
}
function manifestDigest(corpusId: string,revision: string,sources: readonly SourceDocument[]): string {
  return digest(JSON.stringify({format:'trellis/synthetic-corpus/v0.7-alpha',classification:'synthetic',corpusId,revision,
    sources:sources.map(({sourceId,revision,digest})=>({sourceId,revision,digest}))}));
}
export function pinSyntheticCorpus(corpusId: string, revision: string, input: readonly SourceDocument[]): SyntheticCorpus {
  const id=identifier(corpusId),version=identifier(revision),sources=documents(input);
  return Object.freeze({format:'trellis/synthetic-corpus/v0.7-alpha',classification:'synthetic',corpusId:id,revision:version,
    digest:manifestDigest(id,version,sources),sources:Object.freeze(sources)});
}
interface IndexedDocument { source: SourceDocument; terms: Map<string,{count:number;first:number}> }
function tokens(body: string): {term:string;first:number}[] {
  const result: {term:string;first:number}[]=[];
  for(const match of body.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) {
    const term=match[0].normalize('NFKC').toLowerCase();
    result.push({term,first:match.index});
  }
  return result;
}
function indexSource(source: SourceDocument): IndexedDocument {
  const terms = new Map<string,{count:number;first:number}>();
  for(const token of tokens(source.text)) {
    if([...token.term].length>ROOTS_LIMITS.termCodePoints)continue;
    const old=terms.get(token.term);
    if(old)old.count=Math.min(old.count+1,8);else terms.set(token.term,{count:1,first:token.first});
    require(terms.size<=ROOTS_LIMITS.sourceTerms,'SOURCE_TERM_LIMIT');
  }
  return {source,terms};
}
function queryRequest(value: unknown): {corpus:CorpusPin;terms:string[];sources:SourcePin[]|null;limit:number} {
  const v=record(value,['format','corpus','text'],['sources','limit']);require(v.format==='trellis/keyword-query/v0.7-alpha','QUERY_FORMAT');
  const terms=[...new Set(tokens(text(v.text,ROOTS_LIMITS.queryBytes)).map(t=>t.term))].sort(compare);
  require(terms.length>0&&terms.length<=ROOTS_LIMITS.queryTerms&&terms.every(t=>[...t].length<=ROOTS_LIMITS.termCodePoints),'QUERY_TERM_LIMIT');
  const sources=Object.hasOwn(v,'sources')?array(v.sources,ROOTS_LIMITS.sources,1).map(pin):null;
  if(sources)require(new Set(sources.map(s=>s.sourceId)).size===sources.length,'DUPLICATE_SOURCE');
  const limit=Object.hasOwn(v,'limit')?v.limit:ROOTS_LIMITS.hits;
  require(Number.isSafeInteger(limit)&&(limit as number)>0&&(limit as number)<=ROOTS_LIMITS.hits,'HIT_LIMIT');
  return {corpus:corpusPin(v.corpus),terms,sources,limit:limit as number};
}
function excerpt(body: string,start: number): QuotedHit['excerpt'] {
  let bytes=0,end=start;
  for(const character of body.slice(start)) { const size=Buffer.byteLength(character);if(bytes+size>ROOTS_LIMITS.excerptBytes)break;bytes+=size;end+=character.length; }
  return Object.freeze({text:body.slice(start,end),startUtf16:start,endUtf16:end});
}
/** Register immutable controller-supplied text; this service imports no file, database, model or network loader. */
export function registerSyntheticCorpus(input: SyntheticCorpus, initialGrants: readonly SourceGrant[], dependencies: RootsDependencies): RootsController {
  const raw=record(input,['format','classification','corpusId','revision','digest','sources']);
  require(raw.format==='trellis/synthetic-corpus/v0.7-alpha'&&raw.classification==='synthetic','CORPUS_FORMAT');
  const sources=documents(raw.sources),id=identifier(raw.corpusId),revision=identifier(raw.revision);
  require(digestPin(raw.digest)===manifestDigest(id,revision,sources),'STALE_CORPUS_PIN');
  const registeredPin=Object.freeze({corpusId:id,revision,digest:raw.digest as string});
  const indexed=new Map(sources.map(source=>[source.sourceId,indexSource(source)]));
  require([...indexed.values()].reduce((n,d)=>n+d.terms.size,0)<=ROOTS_LIMITS.corpusTerms,'CORPUS_TERM_LIMIT');
  require(dependencies?.identity&&typeof dependencies.identity.authenticate==='function','IDENTITY_REQUIRED');
  const identity=dependencies.identity,clock=dependencies.now??Date.now;
  let lastTime=0,generation=0,grants=new Map<string,Map<string,SourceGrant>>();
  const now=()=>{let value:unknown;try{value=clock();}catch{throw new RootsError('CLOCK_UNAVAILABLE');}
    const at=timestamp(value);require(at>=lastTime,'CLOCK_BACKWARDS');lastTime=at;return at;};
  const replaceGrants=(value:readonly SourceGrant[]):void=>{
    const at=now(),next=new Map<string,Map<string,SourceGrant>>();
    for(const entry of array(value,ROOTS_LIMITS.grants)) {
      const v=record(entry,['subject','source','expiresAtMs']),subject=identifier(v.subject),source=pin(v.source),expiresAtMs=timestamp(v.expiresAtMs);
      require(expiresAtMs>at,'GRANT_EXPIRED');const registered=indexed.get(source.sourceId);
      require(registered&&same(source,registered.source),'STALE_GRANT_PIN');
      const existing=next.get(subject)??new Map<string,SourceGrant>();require(!existing.has(source.sourceId),'DUPLICATE_GRANT');
      existing.set(source.sourceId,Object.freeze({subject,source,expiresAtMs}));next.set(subject,existing);
      require(next.size<=ROOTS_LIMITS.principals,'PRINCIPAL_LIMIT');
    }
    require(generation<Number.MAX_SAFE_INTEGER,'GRANT_VERSION_LIMIT');grants=next;generation++;
  };
  replaceGrants(initialGrants);
  const reader=Object.freeze({async query(value:KeywordQuery,credential:unknown):Promise<QuotedResult>{
    const request=queryRequest(value);let authenticated:unknown;
    try{authenticated=await identity.authenticate(credential);}catch{throw new RootsError('UNAUTHENTICATED');}
    const principal=record(authenticated,['subject','proofRef','expiresAtMs']),subject=identifier(principal.subject);
    require(typeof principal.proofRef==='string'&&principal.proofRef.length>0&&principal.proofRef.length<=512,'UNAUTHENTICATED');
    const expires=timestamp(principal.expiresAtMs),at=now();require(expires>at,'UNAUTHENTICATED');
    const version=generation,allowed=new Map([...(grants.get(subject)??[])].filter(([,g])=>g.expiresAtMs>at));
    require(allowed.size>0,'SOURCE_UNAVAILABLE');
    require(request.corpus.corpusId===registeredPin.corpusId&&request.corpus.revision===registeredPin.revision&&request.corpus.digest===registeredPin.digest,'STALE_CORPUS_PIN');
    if(request.sources)for(const wanted of request.sources){const granted=allowed.get(wanted.sourceId);
      require(granted,'SOURCE_UNAVAILABLE');require(same(granted.source,wanted),'STALE_SOURCE_PIN');}
    const selected=request.sources?.map(s=>s.sourceId)??[...allowed.keys()];
    const hits:QuotedHit[]=[];
    for(const sourceId of selected){const entry=indexed.get(sourceId)!;
      const matching=request.terms.filter(t=>entry.terms.has(t));if(!matching.length)continue;
      const score=matching.length*1000+matching.reduce((sum,t)=>sum+entry.terms.get(t)!.count,0);
      const first=Math.min(...matching.map(t=>entry.terms.get(t)!.first));
      hits.push(Object.freeze({source:pin({sourceId,revision:entry.source.revision,digest:entry.source.digest}),score,
        matchedTerms:Object.freeze(matching),excerpt:excerpt(entry.source.text,first)}));
    }
    hits.sort((a,b)=>b.score-a.score||compare(a.source.sourceId,b.source.sourceId));
    const selectedHits=hits.slice(0,request.limit);
    const result=():QuotedResult=>({format:'trellis/quoted-sources/v0.7-alpha',kind:'untrusted-source-quotes',corpus:registeredPin,
      scoreVersion:'keyword-coverage-v1',hits:selectedHits,truncated:selectedHits.length<hits.length});
    while(Buffer.byteLength(JSON.stringify(result()))>ROOTS_LIMITS.responseBytes){require(selectedHits.length>0,'RESPONSE_LIMIT');selectedHits.pop();}
    const finished=now();require(expires>finished,'UNAUTHENTICATED');require(version===generation,'ACCESS_CHANGED');
    require(selected.every(sourceId=>allowed.get(sourceId)!.expiresAtMs>finished),'SOURCE_UNAVAILABLE');
    Object.freeze(selectedHits);return Object.freeze(result());
  }});
  return Object.freeze({pin:registeredPin,reader,replaceGrants});
}
