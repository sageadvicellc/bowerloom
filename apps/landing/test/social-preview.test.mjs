import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import config, * as metadataModule from '../vite.config.ts';
import { hero } from '../src/content.ts';

const TAGLINE = 'Define your skills, agents, tools, rules, and context once. Bowerloom installs them into Claude Code and Codex.';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const preview = async () => JSON.parse(await read('../../../release/social-preview.json'));
const meta = html => new Map([...html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)].map(match => [match[1], match[2]]));

test('the preview record uses the landing message and the home card', async () => {
  const social = await preview();
  assert.equal(social.title, `Bowerloom · ${hero.H1}`);
  assert.equal(social.description, TAGLINE);
  assert.equal(social.siteName, 'Bowerloom');
  assert.equal(social.type, 'website');
  assert.equal(social.image.url, 'https://bowerloom.ai/social/bowerloom-home.png');
  assert.equal(social.image.width, 1200);
  assert.equal(social.image.height, 630);
  assert.equal(social.image.type, 'image/png');
  assert.ok(social.image.alt.includes(hero.H1), 'the home card alt text names the headline it shows');
});

test('the docs card has its own title, description, and image', async () => {
  const { docs } = await preview();
  assert.equal(docs.title, 'Bowerloom docs · Build with your agent');
  assert.equal(docs.description, 'Guides for the command line and the desktop app.');
  assert.equal(docs.image.url, 'https://bowerloom.ai/social/bowerloom-docs.png');
  assert.deepEqual([docs.image.width, docs.image.height, docs.image.type], [1200, 630, 'image/png']);
  assert.match(docs.image.alt, /^Bowerloom docs\. Build with your agent\./);
  const design = await read('../design/social-preview-docs.html');
  assert.ok(design.includes('<h1>Build with your agent</h1>') && design.includes(`<p class="description">${docs.description}</p>`), 'the docs card shows the words its record names');
});

test('the home card design shows the landing headline', async () => {
  const design = await read('../design/social-preview.html');
  assert.ok(design.includes(`<h1>${hero.H1}</h1>`));
});

test('the docs home page uses the same tagline as the preview', async () => {
  const index = await read('../../docs/src/content/docs/index.md');
  assert.equal(index.match(/^description:\s*"([^"]*)"\s*$/m)?.[1], TAGLINE);
});

test('landing HTML contains complete social metadata before JavaScript runs', async () => {
  const social = await preview();
  const plugin = config.plugins.flat().find(plugin => plugin.name === 'shared-release-metadata');
  const html = await plugin.transformIndexHtml(await read('../index.html'));
  const tags = meta(html);
  for (const [name, value] of Object.entries({
    'og:title': social.title, 'og:description': social.description,
    'og:site_name': social.siteName, 'og:type': social.type,
    'og:image': social.image.url, 'og:image:secure_url': social.image.url,
    'og:image:width': String(social.image.width), 'og:image:height': String(social.image.height),
    'og:image:type': social.image.type, 'og:image:alt': social.image.alt,
    'twitter:card': 'summary_large_image', 'twitter:title': social.title,
    'twitter:description': social.description, 'twitter:image': social.image.url,
    'twitter:image:alt': social.image.alt,
  })) assert.equal(tags.get(name), value, name);
  assert.equal(tags.get('og:url'), 'https://bowerloom.ai');
  assert.doesNotMatch(html, /%(?:RELEASE_|SOCIAL_)[A-Z_]+%/);
});

test('metadata substitution escapes attribute content and leaves unknown tokens intact', () => {
  assert.equal(typeof metadataModule.renderMetadata, 'function');
  assert.equal(metadataModule.renderMetadata('<meta content="%SOCIAL_TITLE%">%SOCIAL_UNKNOWN% %OTHER_TITLE%', {
    SOCIAL_TITLE: 'A "quote" & <tag> \'single\'',
  }), '<meta content="A &quot;quote&quot; &amp; &lt;tag&gt; \'single\'">%SOCIAL_UNKNOWN% %OTHER_TITLE%');
});

test('docs uses the docs card without changing its page identity or index policy', async () => {
  const layout = await read('../../docs/src/components/Layout.astro');
  assert.match(layout, /import social from ['"]\.\.\/\.\.\/\.\.\/\.\.\/release\/social-preview\.json['"]/);
  for (const [name, field] of Object.entries({
    'og:title': 'title', 'og:description': 'description', 'og:site_name': 'siteName', 'og:type': 'type',
    'og:image': 'image.url', 'og:image:secure_url': 'image.url',
    'og:image:width': 'image.width', 'og:image:height': 'image.height',
    'og:image:type': 'image.type', 'og:image:alt': 'image.alt',
    'twitter:title': 'title', 'twitter:description': 'description',
    'twitter:image': 'image.url', 'twitter:image:alt': 'image.alt',
  })) assert.ok(layout.includes(`="${name}" content={card.${field}}`), name);
  assert.match(layout, /const card=\{\.\.\.social\.docs,siteName:social\.siteName,type:social\.type\};/);
  assert.match(layout, /name="twitter:card" content="summary_large_image"/);
  assert.match(layout, /<title>\{title\} · Bowerloom docs<\/title>/);
  assert.match(layout, /name="description" content=\{description\}/);
  assert.match(layout, /name="robots" content="noindex, nofollow"/);
  assert.match(layout, /rel="canonical" href=\{'https:\/\/bowerloom.ai'\+url\}/);
  assert.doesNotMatch(layout, /property="og:url"/);
});
