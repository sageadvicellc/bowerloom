import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,chmodSync,writeFileSync,readFileSync,readdirSync,mkdirSync,linkSync,symlinkSync,rmSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {importHarnessConfig,planHarnessProjection} from '../../../dist/packages/harness-portability/src/index.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const code=value=>error=>error?.code===value;
const neutral=(effort='high',models={})=>({format:'bowerloom/harness-preferences/v1beta1',preferences:{reasoningEffort:effort},nativeModels:models,executionAuthorized:false});
function fixture(t,harness,text){const dir=realpathSync(mkdtempSync(join(tmpdir(),'bowerloom-harness-')));chmodSync(dir,0o700);t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,harness==='codex'?'config.toml':'settings.json');writeFileSync(file,text,{mode:0o600});return{dir,input:{harness,file,synthetic:true}};}
for(const harness of ['codex','claude'])test(harness+' harmless import round trip preserves all original bytes and reports every nonmapped setting',async t=>{
 const source=readFileSync(new URL('./fixtures/'+(harness==='codex'?'codex.toml':'claude.json'),import.meta.url),'utf8');
 const {dir,input}=fixture(t,harness,source),before=readdirSync(dir),imported=await importHarnessConfig(input);
 assert.equal(imported.neutral.preferences.reasoningEffort,'high');assert.equal(imported.executionAuthorized,false);assert.equal(imported.report.importedCredentials,false);assert.equal(imported.report.runtimePortabilityVerified,false);
 assert.equal(imported.report.mapped.length,2);assert.ok(imported.report.unsupported.length>=2);assert.equal(imported.source.sha256,hash(source));
 const planned=await planHarnessProjection({...input,neutral:imported.neutral});assert.equal(planned.status,'unchanged');assert.equal(planned.proposedText,source);assert.equal(planned.edits.length,0);assert.equal(planned.writesAuthorized,false);
 assert.deepEqual(planned,await planHarnessProjection({...input,neutral:imported.neutral}));assert.deepEqual(readdirSync(dir),before);assert.equal(readFileSync(input.file,'utf8'),source);
 assert.ok(!JSON.stringify(imported.neutral).includes(input.file));assert.ok(!JSON.stringify(imported.neutral).includes('read-only'));
});
test('Codex projection inserts root preferences before table, preserving Unicode comments, CRLF and unrelated values',async t=>{
 const source='# café comment\r\nweb_search = "disabled"\r\n[features]\r\nother = false\r\n';
 const {input}=fixture(t,'codex',source),plan=await planHarnessProjection({...input,neutral:neutral('medium',{'codex':'o3'})});
 assert.equal(plan.status,'review-required');assert.equal(plan.edits.length,1);const edit=plan.edits[0],bytes=Buffer.from(source);
 assert.equal(Buffer.concat([bytes.subarray(0,edit.startByte),Buffer.from(edit.replacement),bytes.subarray(edit.endByte)]).toString(),plan.proposedText);
 assert.ok(plan.proposedText.indexOf('model = "o3"')<plan.proposedText.indexOf('[features]'));assert.ok(plan.proposedText.includes('# café comment\r\n'));assert.ok(plan.proposedText.endsWith('[features]\r\nother = false\r\n'));
 assert.equal(readFileSync(input.file,'utf8'),source);writeFileSync(input.file,plan.proposedText);const imported=await importHarnessConfig(input);assert.equal(imported.neutral.preferences.reasoningEffort,'medium');assert.equal(imported.neutral.nativeModels.codex,'o3');
});
test('Claude projection adds missing fields without rewriting existing formatting and makes no model substitution',async t=>{
 const source='{\n\t"unrelated_demo_flag" : false\n}\n', {input}=fixture(t,'claude',source);
 const plan=await planHarnessProjection({...input,neutral:neutral('xhigh',{codex:'gpt-6.1-sol'})});assert.equal(plan.status,'review-required');assert.equal(JSON.parse(plan.proposedText).effortLevel,'xhigh');assert.equal(JSON.parse(plan.proposedText).model,undefined);assert.ok(plan.proposedText.startsWith(source.slice(0,source.lastIndexOf('}'))));
 assert.deepEqual(plan.report.unsupported.find(x=>x.field==='nativeModels.codex'),{field:'nativeModels.codex',code:'NO_AUTOMATIC_MODEL_EQUIVALENCE'});
 assert.equal(readFileSync(input.file,'utf8'),source);
});
test('differing existing values block every edit and bind a changed source or requested preference to a new revision',async t=>{
 const {input}=fixture(t,'codex','model_reasoning_effort = "low"\n'),plan=await planHarnessProjection({...input,neutral:neutral('high')});
 assert.equal(plan.status,'blocked');assert.equal(plan.proposedText,null);assert.equal(plan.proposedSha256,null);assert.deepEqual(plan.edits,[]);assert.equal(plan.report.conflicts[0].code,'EXISTING_VALUE_DIFFERS');
 assert.notEqual(plan.revision,(await planHarnessProjection({...input,neutral:neutral('medium')})).revision);
 writeFileSync(input.file,'model_reasoning_effort = "low" # changed\n');assert.notEqual(plan.revision,(await planHarnessProjection({...input,neutral:neutral('high')})).revision);
});
test('object or dotted-key collisions return a blocked structural conflict instead of proposing duplicates',async t=>{
 for(const [harness,text,models] of [['claude','{"model":{"custom":false}}',{claude:'sonnet'}],['codex','model.other = false\n',{codex:'o3'}]]) {
 const {input}=fixture(t,harness,text),plan=await planHarnessProjection({...input,neutral:neutral('high',models)});
 assert.equal(plan.status,'blocked');assert.equal(plan.proposedText,null);assert.equal(plan.report.conflicts[0].code,'STRUCTURAL_FIELD_CONFLICT');
 }
});
test('secret fields, private endpoints, opaque values, nested arrays and sensitive comments never leak values',async t=>{
 for(const [harness,text] of [
  ['claude','{"model":"sonnet","env":{"TOKEN":"secret-canary-value"}}'],
  ['claude','{"mcpServers":{"example":{"url":"https://private.example.test/service"}}}'],
  ['claude','{"hooks":[{"env":{"TOKEN":"secret-canary-value"}}]}'],
  ['claude','{"unknown_setting":"secret-canary-value"}'],
  ['codex','model = "gpt-6.1-sol"\n[env]\nTOKEN = "secret-canary-value"\n'],
  ['codex','# token=secret-canary-value\nmodel = "o3"\n']
 ]){const {input}=fixture(t,harness,text),imported=await importHarnessConfig(input);assert.ok(imported.report.secretReferences.length>0);assert.ok(!JSON.stringify(imported).includes('secret-canary-value'));assert.ok(!JSON.stringify(imported).includes('private.example.test'));
 const projected=await planHarnessProjection({...input,neutral:neutral()});assert.equal(projected.status,'blocked');assert.equal(projected.proposedText,null);assert.ok(!JSON.stringify(projected).includes('secret-canary-value'));}
});
test('duplicate JSON and TOML keys, aliases, invalid grammar and unsafe keys fail closed',async t=>{
 for(const [harness,text] of [
  ['claude','{"model":"opus","model":"sonnet"}'],['claude','{"model":"opus","mo\\u0064el":"sonnet"}'],['claude','{"permissions":{"mode":1,"mode":2}}'],['claude','{"__proto__":{}}'],['claude','{"unknown":1,}'],
  ['codex','model = "o3"\nmodel = "gpt-6.1-sol"'],['codex','a.b = true\n[a]\nb = false'],['codex','[a]\nx = true\n[a]\ny = false'],['codex','model = """multiline"""'],['codex','"model" = "o3"'],['codex','approval_policy = { granular = true }'],['codex','model = "o3"\n__proto__ = false']
 ]){const {input}=fixture(t,harness,text);await assert.rejects(importHarnessConfig(input));}
});
test('unsupported but harmless settings remain reported and unchanged; unsupported model/effort are not imported',async t=>{
 const {input}=fixture(t,'claude','{"model":"secret-canary-value","effortLevel":"max","unrelated_demo_flag":true}'),result=await importHarnessConfig(input);assert.deepEqual(result.neutral.nativeModels,{});assert.deepEqual(result.neutral.preferences,{});assert.equal(result.report.unsupported.length,3);assert.ok(!JSON.stringify(result).includes('secret-canary-value'));
});
test('source replacement alters binding; symlinks, hardlinks, oversize, permissions, UTF8 and live harness paths rejected',async t=>{
 const {dir,input}=fixture(t,'codex','model="o3"\n'),before=await importHarnessConfig(input);renameSync(input.file,join(dir,'saved.toml'));writeFileSync(input.file,'model="o3"\n',{mode:0o600});assert.notEqual(before.revision,(await importHarnessConfig(input)).revision);
 rmSync(input.file);linkSync(join(dir,'saved.toml'),input.file);await assert.rejects(importHarnessConfig(input),code('SOURCE_UNSAFE'));rmSync(input.file);symlinkSync(join(dir,'saved.toml'),input.file);await assert.rejects(importHarnessConfig(input),code('SOURCE_SYMLINK'));rmSync(input.file);
 writeFileSync(input.file,'x'.repeat(65537));await assert.rejects(importHarnessConfig(input),code('SOURCE_UNSAFE'));
 writeFileSync(input.file,Buffer.from([0xc0,0xaf]));await assert.rejects(importHarnessConfig(input),code('SOURCE_UTF8'));
 writeFileSync(input.file,'\uFEFFmodel="o3"');await assert.rejects(importHarnessConfig(input),code('SOURCE_TEXT'));
 writeFileSync(input.file,'model="o3"');chmodSync(input.file,0o666);await assert.rejects(importHarnessConfig(input),code('SOURCE_UNSAFE'));chmodSync(input.file,0o600);
 for(const name of ['.claude.json','auth.json','.credentials.json','managed-settings.json'])await assert.rejects(importHarnessConfig({...input,harness:'claude',file:join(dir,name)}),code('PROTECTED_PATH'));
 const linked=join(dir,'link');symlinkSync(dir,linked);await assert.rejects(importHarnessConfig({...input,file:join(linked,'config.toml')}),code('SOURCE_SYMLINK'));
 for(const name of ['.CoDeX','.CLAUDE','Library','nmaahc-sm'])await assert.rejects(importHarnessConfig({...input,file:join(dir,name,'config.toml')}),code('PROTECTED_PATH'));
});
test('synthetic assertion, unknown fields, getters and unsupported neutral schema are rejected',async t=>{
 const {input}=fixture(t,'claude','{}');await assert.rejects(importHarnessConfig({...input,synthetic:false}),code('SYNTHETIC_INPUT_REQUIRED'));await assert.rejects(importHarnessConfig({...input,importHistory:true}),code('INPUT_FIELDS'));
 const evil={...input};Object.defineProperty(evil,'file',{get(){throw Error('Getter ran');}});await assert.rejects(importHarnessConfig(evil),code('INPUT_FIELDS'));
 await assert.rejects(planHarnessProjection({...input,neutral:{...neutral(),executionAuthorized:true}}),code('NEUTRAL_FORMAT'));
 await assert.rejects(planHarnessProjection({...input,neutral:{...neutral(),nativeModels:{claude:'private-model'}}}),code('NEUTRAL_MODEL'));
});

test('JSON-only escapes and dollar bare keys do not pass as TOML',async t=>{
 const cases=[String.raw`model = "o3\/test"`,String.raw`model = "\ud83d\ude00"`,'$bad = false','[bad$table]\nx = true'];
 for(const text of cases){const {input}=fixture(t,'codex',text);await assert.rejects(importHarnessConfig(input),code('TOML_UNSUPPORTED_SYNTAX'));}
 const {input}=fixture(t,'codex',String.raw`unrelated = "backslash \\ then / slash"`);assert.equal((await importHarnessConfig(input)).report.unsupported.length,1);
});

test('dotted keys define tables that cannot be reopened, but header-created implicit supertables stay legal',async t=>{
 for(const text of ['a.b = 1\n[a]\nc = 2\n','a.b.c = 1\n[a.b]\nd = 2\n','[a]\nb.c = 1\n[a.b]\nd = 2\n','a = 1\n[a.b]\nc = 2\n','[a.b]\nx = 1\n[a]\nb.c = 2\n']) {
   const {input}=fixture(t,'codex',text);
   await assert.rejects(importHarnessConfig(input),code('TOML_DUPLICATE'));
   await assert.rejects(planHarnessProjection({...input,neutral:neutral()}),code('TOML_DUPLICATE'));
   assert.equal(readFileSync(input.file,'utf8'),text);
 }
 for(const text of ['[a.b]\nx = 1\n[a]\nc = 2\n','[a.b.c]\nx = 1\n[a.b]\ny = 2\n[a]\nz = 3\n','a.b = 1\na.c = 2\n','a.b = 1\n[a.c]\nd = 2\n','[a.b.c]\nx = 1\n[a]\nb.d = 2\n']) {
   const {input}=fixture(t,'codex',text),imported=await importHarnessConfig(input),plan=await planHarnessProjection({...input,neutral:imported.neutral});
   assert.equal(plan.status,'unchanged');assert.equal(plan.proposedText,text);assert.deepEqual(plan.edits,[]);
 }
});
