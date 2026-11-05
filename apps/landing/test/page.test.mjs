import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { installAvailable, installCommand, readerRelease, releasesUrl, repositoryUrl, docsPath } from '../src/release.ts';
import { loadPage } from './render-helpers.mjs';
import { hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions, installView, destinations } from '../src/content.ts';
import { screenshotSlots } from '../src/screenshots.ts';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const release = JSON.parse(await read('../../release/beta.json'));
const sources = async () => {
  const names = (await readdir(new URL('../src/', import.meta.url))).filter(name => /\.(tsx?|css)$/.test(name));
  return Promise.all(names.map(async name => [name, await read('src/' + name)]));
};

test('the hero carries the revised 0.8 message: a tag, the sewing headline, and one sentence that matches the README', () => {
  assert.equal(hero.Eyebrow, 'Open beta · macOS');
  assert.equal(hero.H1, 'Sew a harness that you can use anywhere');
  assert.equal(hero.Body, 'Set up your skills, agents, tools, rules, and context once. Bowerloom tucks them into Claude Code and Codex.');
  assert.equal(hero['Results lead'], 'Each part is marked:');
  assert.deepEqual(hero.Results, ['Exact', 'Translated', 'Weakened', 'Absent']);
  assert.equal(hero['Primary CTA'], 'Get the app (beta)');
  assert.equal(hero['Secondary link'], 'Install the command line');
  assert.equal(hero.Note, 'Free and open source under the MIT license. For macOS.');
});

test('the open beta label carries no version number', () => {
  assert.equal(readerRelease.label, 'Open beta');
  assert.doesNotMatch(JSON.stringify(readerRelease), /\d+\.\d+\.\d+/);
});

test('the download button goes to the releases page and names no asset', () => {
  assert.equal(releasesUrl, 'https://github.com/sageadvicellc/bowerloom/releases');
  assert.equal(releasesUrl, `${release.urls.repository}/releases`);
  assert.equal(repositoryUrl, release.urls.repository);
});

test('the page structure follows the approved outline', () => {
  assert.equal(whatItDoes.heading, 'Keep one definition. Install it everywhere.');
  assert.deepEqual(whatItDoes.features.map(feature => feature.title), ['See what each engine can carry']);
  assert.deepEqual(howItWorks.steps.map(step => step.title), ['Gather what you already have', 'Preview what each engine can carry', 'Approve the plan, then watch for drift', 'Go back to a save point']);
  assert.match(howItWorks.steps[3].body, /^In the app, each save keeps a save point/);
  for (const step of howItWorks.steps) assert.ok(step.title.split(/\s+/).length >= 3 && step.title.split(/\s+/).length <= 8, `${step.title}: a short, clear phrase`);
  assert.equal(howItWorks.boundary, 'Setup does not start workers, grant runtime access, or authorize connected actions.');
  assert.equal(app.heading, 'The app (beta)');
  assert.deepEqual(app.features.map(feature => feature.title), ['Builder', 'Save points', 'Notes keeper']);
  assert.equal(commandLine.commands.length, 4);
  assert.ok(commandLine.commands.includes('bowerloom harness install --engine claude-code --engine codex'));
  assert.equal(commandLine.note, 'No harness command runs an engine or a model.');
  assert.equal(engines.heading, 'Two engines now. Three in preview.');
  assert.equal(install.heading, 'Make yourself at home');
  assert.equal(install.appSteps.length, 5);
  assert.equal(questions.length, 6);
});

test('the engines section says engines and the preview switch is exact', () => {
  assert.match(engines.body, /OpenCode, Pi, and DeepSeek Harness are preview engines\./);
  assert.match(engines.body, /`BOWERLOOM_PREVIEW_ENGINES=1`/);
  assert.deepEqual(engines.supported, ['Claude Code', 'Codex']);
  assert.deepEqual(engines.preview, ['OpenCode', 'Pi', 'DeepSeek Harness']);
});

test('the install command always shows, and the note about npm shows only until the release record says the package is published', () => {
  const before = installView(false);
  assert.equal(before.command, release.npm.installCommand);
  assert.equal(before.pending, true);
  assert.match(before.pendingNote, /not on npm yet/);
  assert.doesNotMatch(JSON.stringify(before), /arrives when the beta publishes/);
  const after = installView(true);
  assert.equal(after.command, release.npm.installCommand);
  assert.equal(after.pending, false);
  assert.equal(after.pendingNote, null);
  assert.equal(installCommand, release.npm.installCommand);
  assert.match(after.text, /Do not use `npm update -g`\./);
  assert.equal(installView().pending, !installAvailable);
  assert.equal(installAvailable, release.npm.published && release.state === 'published');
});

test('the stated requirements match the release record', () => {
  assert.equal(release.requirements.node, '>=24.11.0 <25');
  assert.equal(release.requirements.npm, '11');
  assert.match(installView(true).text, /Node 24\.11 or a later 24\.x, and npm 11/);
  assert.match(installView(false).text, /Node 24\.11 or a later 24\.x, and npm 11/);
});

test('the app install steps match the approved order', () => {
  assert.match(install.appIntro, /Apple did not sign or notarize the app/);
  assert.match(install.appSteps[0], /Applications/);
  assert.match(install.appSteps[3], /Open Anyway/);
  assert.equal(install.appUpdate, 'The app does not update itself yet. When a new build is out, download it.');
});

test('the old 0.7 pages, anchors, and words are gone', async () => {
  for (const name of ['LabsWorkflow.tsx', 'TutorialBuilder.tsx', 'labs-roles.ts', 'tutorial.ts', 'labs.css', 'tutorial.css', 'Workshop.tsx', 'StaticWorkshop.tsx', 'CinematicWorld.tsx',
    'AnimationSplash.tsx', 'CinematicIntro.tsx', 'cinematic-config.ts', 'cinematic-scrub.ts', 'fullpage-media.ts', 'fullpage-scroll.ts', 'intro-controller.ts', 'intro-media.ts', 'splash-playback.ts', 'intro.css']) {
    await assert.rejects(read('src/' + name), name);
  }
  for (const [name, text] of await sources()) {
    assert.doesNotMatch(text, /href="#(?:build|recipe)"|selector: "#(?:build|recipe)"|CoreOffers|LabsWorkflow|TutorialBuilder|labs-roles|Knowledge officer|Brand review|Tech lead\b/, name);
  }
  const text = JSON.stringify({ hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions });
  assert.doesNotMatch(text, /\b(?:Relay|Roots|Vines|Workbench|Sagespec|Labs workflow|tutorial)\b/i);
});

// The owner's name stays out of this public file: the set holds the sha256 of each lowercased name, one word or two words joined by one space.
// It is kept apart from the client-name set in the desktop and docs tests, which guards a different list.
const OWNER_NAME_HASHES = new Set([
  'b5679ea7383b47df1553f6c89e6d73d26aab70e5ea2b4344fed5c66553ef4a67',
  '0bf4c90a3e7e57c697947017f622b24a5563af0ae973914ba9ebdcb903fa3ebd',
]);
const sha256 = text => createHash('sha256').update(text).digest('hex');
/** The word positions where a listed name starts: a word, or a pair of words in a row. */
const ownerNames = (text, hashes = OWNER_NAME_HASHES) => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const found = [];
  for (let i = 0; i < words.length; i++) {
    if (hashes.has(sha256(words[i]))) found.push(i);
    if (i + 1 < words.length && hashes.has(sha256(`${words[i]} ${words[i + 1]}`))) found.push(i);
  }
  return found;
};

test('the owner-name check finds a listed word and a listed pair, and passes other text', () => {
  const stand = new Set([sha256('example'), sha256('example co')]);
  assert.deepEqual(ownerNames('Made by EXAMPLE Co, not by anyone else.', stand), [2, 2]);
  assert.deepEqual(ownerNames('Made by Example, with a sample.', stand), [2]);
  assert.deepEqual(ownerNames('Bowerloom installs into Claude Code and Codex.', stand), []);
  assert.deepEqual(ownerNames('', stand), []);
});

test('no page source, copy, or image text names a person', async () => {
  for (const [name, text] of await sources()) assert.deepEqual(ownerNames(text), [], name);
  assert.deepEqual(ownerNames(JSON.stringify({ hero, whatItDoes, howItWorks, app, commandLine, engines, install, questions, screenshotSlots })), []);
  assert.deepEqual(ownerNames(await read('public/panel-units/manifest.json')), [], 'public/panel-units/manifest.json');
});

test('every navigation link and hero link points at a section that exists', async () => {
  const sections = await read('src/Sections.tsx');
  const app = await read('src/App.tsx');
  const nav = await read('src/SiteNavigation.tsx');
  const heroSource = await read('src/Hero.tsx');
  const ids = new Set([...(sections + app + heroSource).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const targets = [...(nav + app + sections).matchAll(/href="#([^"]+)"/g), ...heroSource.matchAll(/'#([a-z-]+)'/g)].map(match => match[1]);
  assert.ok(targets.includes('install-cli'), 'the hero command line link goes to the install command');
  assert.ok(targets.length >= 5);
  for (const target of targets) assert.ok(ids.has(target), `#${target} has a section`);
});

test('every screenshot slot is used once, has one image per theme, and says what its screen shows', async () => {
  const sections = (await read('src/Sections.tsx')) + (await read('src/Hero.tsx'));
  const uses = id => sections.split(`<ScreenshotSlot slot="${id}"`).length - 1;
  assert.equal(new Set(screenshotSlots.map(slot => slot.id)).size, screenshotSlots.length);
  assert.ok(screenshotSlots.length >= 4);
  for (const slot of screenshotSlots) {
    assert.ok(slot.caption.length > 20 && slot.capture.length > 20, slot.id);
    assert.ok(slot.alt.length > 60 && slot.alt !== slot.caption, `${slot.id}: the alt text says what the picture shows`);
    assert.ok(Number.isInteger(slot.width) && Number.isInteger(slot.height) && slot.width / slot.height > 1.4 && slot.width / slot.height < 1.7, `${slot.id}: a size that suits a 16:10 slot`);
    assert.equal(uses(slot.id), 1, slot.id);
  }
  assert.equal((sections.match(/<ScreenshotSlot /g) ?? []).length, screenshotSlots.length);
  assert.doesNotMatch(sections, /<img /, 'Sections use the slot component, not images');
  const slotSource = await read('src/ScreenshotSlot.tsx');
  assert.match(slotSource, /data-screenshot-slot/);
  assert.match(slotSource, /loading=\{priority \? 'eager' : 'lazy'\}/, 'every shot loads late except the one marked priority');
  assert.match(await read('src/Hero.tsx'), /<ScreenshotSlot slot="builder-graph" priority \/>/, 'only the hero shot is a priority');
  assert.equal((sections.match(/ priority\b/g) ?? []).length, 1);
  assert.match(slotSource, /width=\{item\.width\} height=\{item\.height\}/);
  assert.match(slotSource, /alt=\{item\.alt\}/);
  assert.doesNotMatch(slotSource + await read('src/page.css'), /Screenshot to come|screenshot-frame/, 'the placeholder is gone');
});

/** Width and height of a WebP file, read from its header (lossy, lossless, and extended files). */
function webpSize(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const bits = bytes.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  if (kind === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  throw new Error(`Unknown WebP chunk ${kind}`);
}

test('every screenshot has a light and a dark WebP file under 300 KB, at the size the slot says', async () => {
  for (const slot of screenshotSlots) {
    for (const theme of ['light', 'dark']) {
      const bytes = await readFile(new URL(`../public/shots/${slot.id}-${theme}.webp`, import.meta.url));
      assert.ok(bytes.byteLength < 300 * 1024, `${slot.id}-${theme} is ${bytes.byteLength} bytes`);
      assert.deepEqual(webpSize(bytes), { width: slot.width, height: slot.height }, `${slot.id}-${theme}`);
    }
  }
});

test('the footer and links name no removed page', () => {
  assert.equal(destinations.license, `${release.urls.repository}/blob/main/LICENSE`);
  assert.equal(docsPath, '/docs/');
});

test('new motion follows the principles: no looping, only transform and opacity, a reduced-motion path', async () => {
  const css = await read('src/page.css');
  assert.doesNotMatch(css, /animation-iteration-count:\s*infinite|infinite/);
  assert.doesNotMatch(css, /transition(?:-property)?:[^;]*\b(?:width|height|top|left|margin|padding|all)\b/);
  assert.doesNotMatch(css, /transition:[^;]*\b(?:ease|ease-in-out)\s*[;,]/);
  if (/transition|animation/.test(css)) assert.match(css, /prefers-reduced-motion: reduce/);
});

const links = html => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() }));

test('the page renders: both buttons go to the right place, and the command line link goes to the install command', async () => {
  const page = await loadPage();
  try {
    const heroLinks = links(renderToStaticMarkup(createElement(page.hero.default)));
    assert.equal(heroLinks.find(link => link.text.startsWith(hero['Primary CTA']))?.href, releasesUrl);
    assert.equal(heroLinks.find(link => link.text === hero['Secondary link'])?.href, '#install-cli');
    const install = available => renderToStaticMarkup(createElement(page.sections.InstallSection, { available }));
    for (const available of [false, true]) {
      const app = links(install(available)).find(link => link.text.startsWith('Get the app (beta)'));
      assert.equal(app?.href, releasesUrl);
    }
  } finally { await page.close(); }
});

test('the hero shows the tag, the sewing headline, one sentence, the engine tags, the result chips, and the Builder screenshot', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.hero.default));
    assert.match(html, /<p class="release-tag">[\s\S]*?Open beta · macOS<\/p>/, 'the label is a tag that adds the platform');
    assert.ok(!html.includes('class="eyebrow"'));
    assert.match(html, /<h1 id="hero-title">Sew a harness that you can use anywhere<\/h1>/);
    assert.ok(html.includes(`<p class="hero-description">${hero.Body}</p>`));
    assert.equal((html.match(/class="release-tag-sparkle"/g) ?? []).length, 1, 'at most one sparkle');
    for (const name of engines.supported) assert.ok(html.includes(`<li>${name}</li>`), name);
    for (const name of hero.Results) assert.ok(html.includes(`data-result="${name.toLowerCase()}">${name}</li>`), name);
    assert.ok(html.includes('data-screenshot-slot="builder-graph"'), 'the Builder graph sits in the hero');
    assert.match(html, /<span class="hero-results-lead">Each part is marked:<\/span>/, 'a lead-in comes before the result chips');
    assert.ok(html.indexOf('class="homepage-banner"') < html.indexOf('id="hero-title"'), 'the image leads the header');
  } finally { await page.close(); }
});

test('the install section shows the command with a copy button, with the app first, whether or not npm has the package', async () => {
  const page = await loadPage();
  try {
    const render = (name, props = {}) => renderToStaticMarkup(createElement(page.sections[name], props));
    const text = html => html.replace(/<[^>]+>/g, '');
    const codeText = html => html.match(/<code>([\s\S]*?)<\/code>/)[1].replace(/<[^>]+>/g, '');
    for (const available of [false, true]) {
      const html = render('InstallSection', { available });
      assert.ok(text(html).includes(release.npm.installCommand), `command shown, available=${available}`);
      assert.equal(codeText(html.slice(html.indexOf('<pre'))), release.npm.installCommand, 'wrapping markup adds no characters to the copied command');
      assert.match(html, /<button type="button" class="copy-button"[^>]*>[\s\S]*?Copy[\s\S]*?<\/button>/);
      const status = html.match(/<p class="copy-status"[^>]*>([\s\S]*?)<\/p>/);
      assert.ok(status[0].includes('role="status"') && status[0].includes('aria-live="polite"'));
      assert.equal(status[1], '', 'the live region is empty at first, so nothing is announced on load');
      const note = html.match(/<p class="copy-note">([\s\S]*?)<\/p>/);
      assert.equal(note?.[1] ?? null, available ? null : installView(false).pendingNote, 'the npm note is plain text in the slot, and only until the package is published');
      assert.ok(html.indexOf('class="copy-note"') < 0 || html.indexOf('class="copy-note"') < html.indexOf('class="copy-status"'));
      assert.ok(!html.includes('pending-note'), 'no separate note, so no dead gap');
      assert.ok(html.includes('aria-label="Install command"'));
      assert.ok(html.indexOf('id="install-app"') < html.indexOf('id="install-cli"'), 'the app download stays the primary path');
      assert.ok(!html.includes('arrives when the beta publishes'));
      assert.equal(html.includes('not on npm yet'), !available, 'the npm note shows only until the package is published');
    }
    const commandLineHtml = render('CommandLineSection');
    assert.equal(codeText(commandLineHtml.slice(commandLineHtml.indexOf('<pre'))), commandLine.commands.join('\n'));
  } finally { await page.close(); }
});

test('the features section is one engine item with its screenshot, the steps are one list, and the engines follow the app features', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.sections.WhatItDoes));
    assert.ok(html.includes('See what each engine can carry'));
    assert.ok(!html.includes('journey'), 'the three-step strip is gone, so the steps live only in How it works');
    assert.ok(html.includes('data-screenshot-slot="fidelity-preview"'), 'the install review sits with the engine feature it shows');
    const how = renderToStaticMarkup(createElement(page.sections.HowItWorks));
    assert.equal((how.match(/<li>/g) ?? []).length, 4);
    assert.ok(how.includes('Go back to a save point') && how.includes('In the app, each save keeps a save point'));
    const engineHtml = renderToStaticMarkup(createElement(page.sections.EnginesSection));
    assert.ok(engineHtml.indexOf('class="engine-lead"') > -1 && engineHtml.indexOf('class="engine-lead"') < engineHtml.indexOf('class="engine-list"'), 'a lead-in line sits over the engine tags');
    const app = await read('src/App.tsx');
    assert.ok(app.indexOf('<AppSection />') < app.indexOf('<EnginesSection />') && app.indexOf('<EnginesSection />') < app.indexOf('<CommandLineSection />'), 'engines follow the app features');
  } finally { await page.close(); }
});

test('a screenshot slot shows both themes\' images with a size, late loading, and alt text, and keeps its caption', async () => {
  const page = await loadPage();
  try {
    const html = renderToStaticMarkup(createElement(page.hero.default));
    const slot = screenshotSlots.find(entry => entry.id === 'builder-graph');
    const images = [...html.matchAll(/<img [^>]*>/g)].map(match => match[0]).filter(tag => tag.includes('data-shot-theme'));
    assert.equal(images.length, 2, 'one image for each theme');
    for (const theme of ['light', 'dark']) {
      const image = images.find(tag => tag.includes(`data-shot-theme="${theme}"`));
      assert.ok(image, theme);
      assert.ok(image.includes(`src="/shots/${slot.id}-${theme}.webp"`), theme);
      assert.ok(image.includes(`width="${slot.width}"`) && image.includes(`height="${slot.height}"`), theme);
      assert.ok(image.includes('loading="eager"') && /fetchPriority="high"/.test(image), `${theme}: the hero shot loads at once with high priority`);
      assert.ok(image.includes('alt="'), theme);
    }
    assert.match(html, new RegExp(`<span id="[^"]+" class="screenshot-caption-text">${slot.caption.replaceAll("'", "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\/span>`));
    assert.doesNotMatch(html, /Screenshot to come|aria-hidden="true">Screenshot/);
  } finally { await page.close(); }
});

test('a new command resets the copy state to idle when the controller is made', async () => {
  const source = await read('src/Sections.tsx');
  const effect = source.slice(source.indexOf('useEffect(() => {\n    // A new command'), source.indexOf('}, [command]);'));
  assert.ok(effect.indexOf("setState('idle')") > -1 && effect.indexOf("setState('idle')") < effect.indexOf('createCopyController('), 'the state resets before the new controller starts');
  assert.match(effect, /return \(\) => \{ run\.dispose\(\);/, 'the old controller is disposed');
});
