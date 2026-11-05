# Bowerloom landing page

The page at bowerloom.ai. It is a React and Vite site. It describes Bowerloom 0.8: one harness, installed into Claude Code and Codex.

From the repository root, with Node 24.11:

```sh
npm run dev --workspace apps/landing
npm run typecheck --workspace apps/landing
npm test --workspace apps/landing
npm run build --workspace apps/landing
```

## Copy

`src/content.ts` holds the approved page copy. Change it only with the owner. Inline code sits in backticks.

`src/release.ts` reads `release/beta.json` and never writes it. It exports only what the page needs, and `build/release-fields.ts` drops every other field from the bundle, so the page holds no version, identity, or evidence text. Two rules come from it:

- The label reads "Open beta" with no version number.
- The npm install command shows only when the record says the package is published. Until then, the command line and install sections say the command arrives when the beta publishes.

The download button links to the releases page on GitHub and names no file.

## Screenshots

Six screenshots fill the slots. `src/screenshots.ts` lists each slot: its caption, its alt text, its pixel size, and the screen it shows. `src/ScreenshotSlot.tsx` puts a light and a dark image in the page, and `src/page.css` shows the one that matches the theme. The files are `public/shots/<id>-light.webp` and `<id>-dark.webp`. The alt text says what each picture shows, and the caption stays beside it.

To take them again after a change to a screen, run `npm run shots --prefix apps/landing`. It builds the root packages, runs `apps/desktop/e2e/landing-shots.spec.ts` hidden, and rewrites the files. The app starts the default way on a made-up home, so no real folder, name, or path is on screen. The spec fails if a picture would show this computer's user name, home folder, host name, or temp folder. Read each new picture before you commit it. The command line shot runs the built CLI on the made-up project and draws its real output in a plain terminal frame. Change `apps/desktop/e2e/landing-shots-fixture.ts` to change the project the shots show. Then update the alt text and the size in `src/screenshots.ts` to match, and the test checks the sizes.

## Visual system

The page keeps the existing Rose Conservatory identity: `src/brand.css`, the Projection UI tokens in `src/projection-tokens.css`, the banner art, the robot companions, and the footer companion. `src/page.css` holds the section styles.

Motion follows the motion principles. The hero depth effect, the first-visit splash, and the hover color changes all stop under `prefers-reduced-motion: reduce`. Keyboard actions do not animate.

## Social preview

The landing page and documentation share `release/social-preview.json` and `/social/bowerloom.png`.
Its fixed layout lives in `design/social-preview.html`.

With `playwright-cli` and its Chromium browser installed, run these commands from the repository root:

```sh
node tools/render-social-preview.mjs
npm run build --workspace apps/landing
npm --prefix apps/docs run build
node tools/check-social-preview.mjs
```

The renderer writes a 1200 by 630 pixel PNG.
The final command tests the shared preview tags in the built HTML and compares the exported image with its source.

## Projection UI provenance

`src/projection-tokens.css` is the MIT-licensed fallback token stylesheet from `@hannasage/projection-ui` 0.1.5. Its copyright and license are in `PROJECTION-UI-LICENSE`.
