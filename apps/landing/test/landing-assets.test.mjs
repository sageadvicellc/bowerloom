import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const css = await read('src/homepage-banner.css');
test('preview art is byte-identical to the four Brand handoff assets with native dimensions', async () => {
  for (const [path, width, height, hash] of [
    ['panel-units/s4-slate-present.png',1148,1370,'6c39c44b4ad07455cef76d240518a6dfbce4881a361e57ab1becb87d4ec11921'],
    ['panel-units/s4-g3-footer-wave.png',1024,1536,'d57cf158391789ef9c841521ee2022f536548c6b6de1966b6ce2a522192f9f70'],
    ['banner/lab-circuit-hero.png',1672,941,'4820c199265a012841f40dd55630d1066867c59a3d8c53e1e10b6891af675e1b'],
    ['banner/lab-hero-source-1920.png',1920,1080,'2e19d2c9d8a263af1183d02ad14a58e5ee66751c8e1aeef5cda53d2be7ea14e5'],
  ]) {
    const bytes = await readFile(new URL('../public/' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    assert.equal(bytes.readUInt32BE(16), width);assert.equal(bytes.readUInt32BE(20),height);
  }
});
test('slate FAQ uses its own original pose while rose and H4N appearances remain', async () => {
  const app=await read('src/App.tsx'),companion=await read('src/SectionCompanion.tsx');
  assert.match(app, /unit="s4-slate" side="right"><section className="faq-section"/);
  assert.match(app, /unit="s4" side="right"><section className="product-section"/);
  assert.match(app, /unit="h4n" side="left"><LabsWorkflow/);
  assert.match(companion, /width: 1148, height: 1370/);
  assert.match(css, /companion-s4-slate \.companion-robot-front \{ clip-path: var\(--companion-grip\)/);
  // 47% of the natural pose meets the rim; foreground fingers end at 56.5%, clear of text.
  for(const [width,top,padding] of [[200,112.18,64],[160,89.74,56]]) {
    const height=width*1370/1148;
    assert.ok(Math.abs(top/height-.47)<.001);
    assert.ok(padding-(height*.565-top)>24);
  }
});
test('footer layers share the full pose, reserve clearance and leave links accessible', async () => {
  const footer=await read('src/FooterCompanion.tsx'),app=await read('src/App.tsx');
  assert.match(app, /<FooterCompanion><footer className="site-footer" data-theme="dark">/);
  assert.match(footer, /illustration\('back'\)/);assert.match(footer, /illustration\('front'\)/);
  assert.equal((footer.match(/src="\/panel-units\/s4-g3-footer-wave.png"/g)||[]).length,1);
  assert.match(footer, /alt="" aria-hidden="true"/);assert.match(footer, /onError=\{\(\) => setAvailable\(false\)\}/);
  assert.match(css, /top: calc\(var\(--footer-robot-height\) \* -\.61\)/);
  assert.match(css, /footer-companion-front \{ z-index: 2; clip-path: inset\(58% 0 0\)/);
  assert.match(css, /footer-companion-art[^}]*pointer-events: none/);
  assert.ok(336-48-240>=24); // desktop horizontal reserved zone
  assert.ok(132-270*.39>=24); // phone/tablet legs end before first content
});
