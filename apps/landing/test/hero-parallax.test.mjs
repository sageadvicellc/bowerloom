import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('hero depth uses transforms on two planes, a scroll timeline, and a reduced-motion gate', async () => {
  const css = await read('src/hero-parallax.css'), app = await read('src/App.tsx');
  assert.match(app, /import "\.\/hero-parallax\.css";/);
  const gated = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.ok(css.indexOf('@media (prefers-reduced-motion: no-preference)') > -1);
  assert.match(gated, /@supports \(animation-timeline: scroll\(\)\)/);
  assert.match(gated, /\.homepage-banner > img \{[^}]*animation: hero-depth-far linear both;[^}]*animation-timeline: scroll\(root block\);[^}]*animation-range: 0 100vh;/);
  assert.match(gated, /\.hero-copy \{[^}]*animation: hero-depth-near linear both;[^}]*animation-timeline: scroll\(root block\);[^}]*animation-range: 0 150vh;/);
  const frames = [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)].map(match => match[1]);
  assert.equal(frames.length, 2);
  for (const body of frames) {
    assert.doesNotMatch(body, /top|left|margin|height|width|opacity|scale|rotate/);
    assert.match(body, /translate3d\(0, 0, 0\)/);
  }
  // Depth stays small: art lags by at most a fifth of the scroll, copy leads by at most a tenth.
  const far = Number(css.match(/hero-depth-far \{[\s\S]*?translate3d\(0, ([\d.]+)vh, 0\); \}\n\}/)[1]);
  const near = Number(css.match(/hero-depth-near \{[\s\S]*?translate3d\(0, -([\d.]+)vh, 0\); \}\n\}/)[1]);
  assert.ok(far > 0 && far <= 20, `far ${far}`); assert.ok(near > 0 && near <= 10, `near ${near}`);
  // Per pixel scrolled: the art range is 100vh and the copy range is 150vh.
  assert.ok(Math.abs(far / 100 - .18) < 1e-9); assert.ok(Math.abs(near / 150 - .05) < 1e-9);
  const banner = await read('src/homepage-banner.css');
  assert.match(banner, /linear-gradient\(to bottom, transparent 84%, var\(--ui-bg\) 100%\)/);
  assert.doesNotMatch(banner, /banner-replay/);
});
