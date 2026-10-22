import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';

// A tiny hand-made tar writer, so a test can build entries that tar.create refuses to write
// (links, devices, absolute paths, and a bad checksum).
const octal=(value,width)=>Buffer.from(value.toString(8).padStart(width-1,'0')+'\0');
function header({path,type='0',mode=0o644,size=0,linkpath=''}) {
 const h=Buffer.alloc(512);
 h.write(path,0,100,'utf8');octal(mode,8).copy(h,100);octal(0,8).copy(h,108);octal(0,8).copy(h,116);octal(size,12).copy(h,124);octal(0,12).copy(h,136);
 h.fill(0x20,148,156);h.write(type,156,1,'ascii');h.write(linkpath,157,100,'utf8');h.write('ustar\0',257,6,'ascii');h.write('00',263,2,'ascii');
 let sum=0;for(const byte of h)sum+=byte;
 h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
 return h;
}
// entries: [{path, data?, mode?, type?, linkpath?}]. type is a tar type flag: 0 file, 1 hard link, 2 symbolic link, 3 character device, 5 folder.
export function tarBytes(entries,{corruptChecksum=false}={}) {
 const parts=[];
 for(const entry of entries) {
  const data=entry.data===undefined?Buffer.alloc(0):Buffer.from(entry.data),type=entry.type??'0';
  const h=header({path:entry.path,type,mode:entry.mode??(type==='5'?0o755:0o644),size:type==='0'?data.length:0,linkpath:entry.linkpath??''});
  if(corruptChecksum)h.write('9999999\0',148,8,'ascii');
  parts.push(h);
  if(type==='0'&&data.length){parts.push(data);const pad=(512-data.length%512)%512;if(pad)parts.push(Buffer.alloc(pad));}
 }
 parts.push(Buffer.alloc(1024));
 return gzipSync(Buffer.concat(parts));
}
export const integrityOf=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
export function cachePath(npmCache,integrity) {
 const hex=Buffer.from(integrity.slice('sha512-'.length),'base64').toString('hex');
 return join(npmCache,'content-v2','sha512',hex.slice(0,2),hex.slice(2,4),hex.slice(4));
}
// Put bytes in a cache folder at the path npm uses, and return the integrity value.
export function putInCache(npmCache,bytes,integrity=integrityOf(bytes)) {
 const file=cachePath(npmCache,integrity);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);return integrity;
}
// A small package tarball whose first folder is `first` (npm tarballs use package/, others differ).
export function packageTarball(name,version,{first='package',extra=[],deps}={}) {
 return tarBytes([
  {path:first+'/',type:'5'},
  {path:first+'/package.json',data:JSON.stringify({name,version,main:'index.js',...(deps?{dependencies:deps}:{})})},
  {path:first+'/index.js',data:`module.exports='${name}';\n`},
  ...extra.map(e=>({...e,path:first+'/'+e.path})),
 ]);
}
// A synthetic lock: `paths` maps a lock path to {version, first?, extra?, license?}. Tarballs go into npmCache.
export function syntheticClosure(npmCache,paths) {
 const packages={};
 for(const [path,spec] of Object.entries(paths)) {
  const name=path.slice(path.lastIndexOf('node_modules/')+'node_modules/'.length);
  const bytes=packageTarball(name,spec.version,{first:spec.first,extra:spec.extra,deps:spec.deps});
  packages[path]={version:spec.version,resolved:`https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${spec.version}.tgz`,integrity:putInCache(npmCache,bytes),license:spec.license??'MIT',...(spec.deps?{dependencies:spec.deps}:{})};
 }
 return packages;
}
export const lockOf=packages=>({name:'synthetic',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'synthetic',version:'1.0.0'},...packages}});
