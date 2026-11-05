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

test('the banner is 70% of the view height at every width, with the focal points set and no cap, tablet clamp, or phone min()', async () => {
  const banner = await read('src/homepage-banner.css');
  assert.match(banner, /\.homepage-banner \{ height: 70vh; height: 70svh; \}/, 'one rule for every width, with a vh fallback');
  assert.doesNotMatch(banner, /max-height|aspect-ratio|clamp\(|min\(56svh|\(min-width: 761px\)/, 'the old caps are gone');
  assert.match(banner, /\.homepage-banner > img \{[^}]*position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 58%;/, 'desktop focal point');
  assert.match(banner, /@media \(max-width: 760px\) \{\s*\.homepage-banner > img \{ object-position: 55% 62%; \}/, 'phone focal point');
  const heights = [...banner.matchAll(/\.homepage-banner \{[^}]*(?<![-\w])height:/g)];
  assert.equal(heights.length, 1, 'no other rule sets the banner height');
});

test('the parallax reuses the one scroll timeline: the picture box reaches 18vh above the banner so no edge shows, and it exists only without a reduced-motion preference', async () => {
  const css = await read('src/hero-parallax.css');
  const gateAt = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(gateAt > -1);
  const rule = css.match(/\.homepage-banner > img \{([^}]*)\}/)[1];
  assert.ok(css.indexOf(rule) > gateAt, 'the picture rule sits inside the no-preference gate');
  assert.match(rule, /inset: -18vh 0 auto 0;/);
  assert.match(rule, /height: calc\(100% \+ 18vh\);/, 'an explicit height: an absolute picture with height auto keeps its own shape and leaves the banner uncovered');
  // The picture slides down at most 18vh (the first keyframes test), and the box reaches 18vh above, so the travel never exposes the top edge.
  const far = Number(css.match(/hero-depth-far \{[\s\S]*?translate3d\(0, ([\d.]+)vh, 0\); \}\n\}/)[1]);
  assert.ok(far <= 18, `travel ${far}vh stays inside the 18vh the box reaches above`);
  // Nothing outside the gate moves the picture, so under reduced motion it stays still: no animation property and no extended box.
  const outside = css.slice(0, gateAt) + css.slice(css.indexOf('@keyframes hero-depth-far'));
  assert.doesNotMatch(outside.replace(/\/\*[\s\S]*?\*\//g, ''), /homepage-banner > img|animation-timeline|scroll\(/);
  assert.equal((css.match(/animation-timeline: scroll\(root block\)/g) ?? []).length, 2, 'one timeline for the picture and one for the copy, and no second mechanism');
  assert.doesNotMatch(css, /addEventListener|requestAnimationFrame/);
});
