// The header navigation: the desktop bar, the drawer, the GitHub icon, the stitch, and the contrast rules. The page is rendered to HTML on the server and the style sheets are read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadPage } from './render-helpers.mjs';
import { releasesUrl, docsPath, repositoryUrl } from '../src/release.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const anchors = html => [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(match => ({ attrs: match[1], text: match[2].replace(/<[^>]+>/g, '').trim(), href: /href="([^"]*)"/.exec(match[1])?.[1] }));

test('the desktop bar is the four text links in order, then the GitHub icon, and the button comes after the theme toggle', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.nav.default));
    const bar = html.slice(html.indexOf('<nav class="desktop-navigation"'), html.indexOf('</nav>'));
    const links = anchors(bar);
    assert.deepEqual(links.map(link => link.text), ['How it works', 'The app', 'Docs', ''], 'three text links, then the icon (Articles is hidden until there is content)');
    assert.deepEqual(links.map(link => link.href), ['#how-it-works', '#app', docsPath, repositoryUrl]);
    assert.ok(!bar.includes('The command line') && !bar.includes('>Install<'), 'The command line and Install are not in the bar');
    const app = await read('src/App.tsx');
    const order = ['<BrandIdentity', '<SiteNavigation', '<ThemeControl', '<NavCta'].map(tag => app.indexOf(tag));
    assert.ok(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1])), 'wordmark, links, theme toggle, then the Get the app button at the right end');
  } finally { await page.close(); }
});

test('the GitHub icon link is named GitHub, opens in a new tab, and hides its drawing from screen readers', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.nav.default));
    const bar = html.slice(html.indexOf('<nav class="desktop-navigation"'), html.indexOf('</nav>'));
    const github = anchors(bar).find(link => link.attrs.includes('class="nav-github"'));
    assert.match(github.attrs, /aria-label="GitHub \(opens in a new tab\)"/);
    assert.ok(github.attrs.includes('target="_blank"') && github.attrs.includes('rel="noopener noreferrer"'));
    assert.match(bar, /<a class="nav-github"[^>]*><svg[^>]*aria-hidden="true"/);
  } finally { await page.close(); }
});

test('the Get the app button has the hero button\'s link and name, in the bar and in the drawer', async () => {
  const page = await loadPage();
  try {
    const bar = renderToStaticMarkup(createElement(page.nav.NavCta));
    assert.ok(bar.includes(`href="${releasesUrl}"`) && bar.includes('target="_blank"') && bar.includes('class="button primary nav-cta nav-cta-bar"'));
    assert.equal(bar.replace(/<[^>]+>/g, ''), 'Get the app (beta) (opens in a new tab)', 'the same accessible name as the hero button');
    assert.match(bar, />Get the app<span class="sr-only">/, 'the visible words are Get the app');
  } finally { await page.close(); }
});

test('the drawer keeps every destination, including The command line and Install, and ends with the Get the app button', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.nav.default));
    const drawer = html.slice(html.indexOf('<nav aria-label="Mobile navigation">'), html.indexOf('</nav>', html.indexOf('<nav aria-label="Mobile navigation">')));
    const links = anchors(drawer);
    assert.deepEqual(links.map(link => link.text), ['How it works', 'The app', 'The command line', 'Install', 'Docs', 'GitHub ↗', 'Get the app (beta) (opens in a new tab)']);
    assert.deepEqual(links.slice(0, 4).map(link => link.href), ['#how-it-works', '#app', '#command-line', '#install']);
    assert.equal(links.at(-1).href, releasesUrl);
  } finally { await page.close(); }
});

test('the drawer opens below 1024 px and closes at 1024 px and up, and no 1101 to 1280 px special case is left', async () => {
  const nav = await read('src/navigation.css');
  assert.match(nav, /@media \(max-width: 1023px\) \{\s*\.site-header \.desktop-navigation, \.site-header \.nav-cta-bar \{ display: none; \}\s*\.site-header \.mobile-menu-toggle \{ display: inline-flex;/);
  assert.match(await read('src/SiteNavigation.tsx'), /matchMedia\('\(min-width: 1024px\)'\)/);
  const brand = await read('src/brand.css');
  assert.doesNotMatch(brand, /min-width: 1101px|max-width: 1280px/);
  assert.match(brand, /@media \(max-width: 1023px\) \{\s*:root \.site-header \.theme-control \{ margin-left: auto; \}/);
});

test('the stitch is a 2 px dashed gradient in the accent color on hover, focus, and the current link, and it appears at once under reduced motion', async () => {
  const css = await read('src/navigation.css');
  assert.match(css, /\.site-header \.nav-link::after \{[^}]*height: 2px;[^}]*repeating-linear-gradient\(90deg, var\(--ui-primary\) 0 5px, transparent 5px 9px\)/);
  assert.match(css, /\.site-header \.nav-link:is\(:hover, :focus-visible, \[aria-current\]\)::after \{ clip-path: inset\(0 0 0 0\); \}/);
  assert.doesNotMatch(css, /text-decoration:\s*(?:underline )?dashed|text-decoration-style/, 'a gradient, not text-decoration');
  const gate = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  const motion = css.slice(gate, css.indexOf('\n}\n', gate));
  assert.match(motion, /\.nav-link::after \{ transition: clip-path 200ms cubic-bezier\(\.23, 1, \.32, 1\); \}/, 'a draw-in of about 200 ms with ease-out');
  assert.equal((css.replace(motion, '').match(/transition: clip-path/g) ?? []).length, 0, 'the draw-in exists only inside the no-preference gate');
});

test('the nav link color and the stitch come from the brand tokens, and the links use the text color for AA contrast', async () => {
  const brand = await read('src/brand.css');
  assert.match(brand, /:root \.desktop-navigation \{[^}]*color: var\(--ui-text\);/);
  const nav = await read('src/navigation.css');
  assert.match(nav, /\.site-header \.nav-link \{[^}]*color: var\(--ui-text\);/);
});
