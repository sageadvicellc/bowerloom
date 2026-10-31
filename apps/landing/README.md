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

The real 0.8 screenshots arrive after the launch change lands. Each slot uses one placeholder, `src/ScreenshotSlot.tsx`. `src/screenshots.ts` lists every slot, its caption, and the screen it needs. The frame is `aria-hidden`, so the caption alone carries the meaning for a screen reader. To fill a slot, swap the frame for the image. Keep the caption.

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
