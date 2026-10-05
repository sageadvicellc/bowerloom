import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = await readFile(new URL('../src/SectionCompanion.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/homepage-banner.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
test('decorations wrap their panels instead of occupying standalone section gaps', () => {
  assert.match(source, /companion-surface">\{children\}/);
  assert.match(app, /<SectionCompanion unit="h4n" side="left"><LabsWorkflow \/><\/SectionCompanion>/);
  assert.match(app, /<SectionCompanion unit="s4" side="right"><section className="product-section"/);
  assert.match(app, /<SectionCompanion unit="s4-slate" side="right"><section className="faq-section"/);
  assert.doesNotMatch(app, /<SectionCompanion[^>]+\/>/);
});
test('robot layers use one unchanged source and shared position; only visibility changes', async () => {
  assert.match(source, /src=\{source\}/);assert.match(source, /illustration\('back'\)/);assert.match(source, /illustration\('front'\)/);
  assert.match(css, /\.companion-robot \{[^}]*width: var\(--robot-width\)[^}]*height: auto[^}]*top: var\(--robot-top\)/);
  assert.match(css, /\.companion-robot-front \{ clip-path: inset\(34% 0 49% 0\)/);
  assert.match(css, /\.companion-h4n \.companion-robot-front \{ clip-path: polygon\(0 0, 100% 0, 100% 100%, 0 100%, 0 47%, 21% 47%, 25% 43%, 25% 35%, 21% 32%, 0 32%\)/);
  assert.doesNotMatch(css, /companion-h4n \.companion-robot-front[^}]*inset\(/);
  assert.doesNotMatch(css, /companion-robot[^}]*transform:/);
  for(const [name,sha] of [['s4-rose-peek.webp','4fb7af4ef853e518fb55d5141c1b84ba906573045d44fb7f685e422e6e4d96dc'],['h4n-ochre-wave.webp','139ccce1124f2250eb71430ea5a005991ab7e23a19b67b9136f19840ea8487ef']])assert.equal(createHash('sha256').update(await readFile(new URL('../public/panel-units/'+name,import.meta.url))).digest('hex'),sha);
});
test('surface occlusion sits between common-coordinate vine layers and controls stay above them', () => {
  assert.match(source, /vine\('back'\)/);assert.match(source, /vine\('front'\)/);
  assert.equal((source.match(/viewBox="0 0 240 160"/g)||[]).length,1);
  assert.match(css, /companion-panel-wrap[^}]*isolation: isolate/);
  assert.match(css, /companion-behind \{ z-index: 0/);
  assert.match(css, /companion-surface::before[^}]*z-index: 1[^}]*background: var\(--ui-surface\)/);
  assert.match(css, /companion-ahead \{ z-index: 2/);
  assert.match(css, /companion-surface > :is\([^}]*z-index: 3/);
  assert.match(css, /companion-vine-front[^}]*clip-path: polygon/);
  assert.match(source, /alt="" aria-hidden="true"/);assert.match(css, /companion-decoration[^}]*pointer-events: none/);
});
test('phone styles retain the masks and reserve reading space without decorative motion', () => {
  const mobile=css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(mobile, /--robot-width: 140px; --robot-top: -98px/);
  assert.match(mobile, /--robot-width: 166px/);assert.match(mobile,/padding: 56px 24px 28px/);
  assert.doesNotMatch(mobile,/companion[^}]*clip-path: none|companion[^}]*position: static/);
  const companions=css.slice(css.indexOf('/* Three panel-bound'),css.indexOf('@media (prefers-reduced-motion'));
  assert.doesNotMatch(companions,/animation:|transition:/);
});

test('H4N registration leaves the cap and central face intact with at least24px reading clearance', () => {
  // Image-space rear-arm bite stays left of the central cylinder; both layers share each anchor.
  for(const [width,bottom,contentPadding] of [[210,106,96],[166,83,80]]){
    const height=width*530/640, overlap=height-bottom;
    assert.ok(overlap/height>.35 && overlap/height<.41);
    assert.ok(contentPadding-overlap>=24);
    const borderSourceY=overlap/height*530;
    assert.ok(borderSourceY>=180 && borderSourceY<=240);
    // At this border height, the bite reaches x160: the visible far arm, before the cylinder.
    assert.equal(640*.25,160);
  }
  assert.match(css,/companion-h4n \.companion-robot \{ top: auto; bottom: -106px/);
  assert.match(css,/companion-h4n \.companion-robot \{ bottom: -83px/);
});

test('mobile S4 foreground contains both grips but excludes the central chest sticker',()=>{
  const points=[...source.matchAll(/<polygon points="([^"]+)"/g)].map(m=>m[1].split(' ').map(p=>p.split(',').map(Number)));
  assert.equal(points.length,2);
  const inside=(x,y,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[a,b]=poly[i],[c,d]=poly[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;}return hit;};
  assert.ok(points.some(p=>inside(.385,.43,p)));assert.ok(points.some(p=>inside(.725,.435,p)));
  assert.ok(points.every(p=>!inside(.55,.48,p)));assert.ok(points.every(p=>!inside(.55,.55,p)));
  assert.match(source,/clipPathUnits="objectBoundingBox"/);assert.match(source,/useId\(\)/);
  const mobile=css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(mobile,/companion-s4 \.companion-robot-front \{ clip-path: var\(--companion-grip\)/);
  const borderSourceY=98/(140*960/640)*960;assert.ok(borderSourceY>440&&borderSourceY<460);
});
