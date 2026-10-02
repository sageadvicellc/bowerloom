# Landing verification — October 2, 2026

This is a local preview, not a public deployment or release.

## Passed

- Standalone dependency installation with its own package-lock; root lockfile unchanged.
- TypeScript check and Vite production build.
- Desktop visual inspection in the Codex in-app browser at its default 1272 × 716 viewport.
- Mobile visual inspection at 390 × 844. No horizontal document overflow (390 viewport, 382 document content width).
- Main CTA navigates to the real setup section on desktop and mobile.
- Clipboard success feedback appears after copying the setup prompt.
- Evidence selection updates the stage explanation and selected state.
- Review activates with Enter; Draft activates with Space, with the corresponding explanation and pressed state.
- Pause changes to Resume with pressed state; rendering uses demand mode while paused.
- Static-map selection removes the canvas (zero canvas elements) and renders the accessible SVG map.
- Browser console contained no application errors.
- Disk guard passed before installation/build, preserving the 12 GiB reserve. Installation occupies 126 MiB; production output roughly 1.1 MiB.

## Implementation limits

- Reduced-motion preference, initial WebGL construction failure, and context-loss handlers use the same map component verified through the explicit static-map control. OS reduced-motion emulation and forced GPU context loss were not exercised through the available browser UI.
- Clipboard permission denial has a focus/select fallback, but denial was not forced.
- Hidden/offscreen suspension is implemented with visibilitychange and IntersectionObserver; CPU/GPU profiling was not recorded.
- The 3D chunk is lazy-loaded and about 240 KiB gzip. Vite reports its 700 KiB raw chunk warning. The reduced-motion path does not load this chunk.
- React Three Fiber's internal use of Three.Clock produces an upstream deprecation warning with Three 0.183.2. Explicit percentage shadows avoid the deprecated soft shadow mode.
- Documentation URLs target the active integration branch. The recipe docs and skill are supplied by the parallel recipe work before integration. Public branch/release URLs require reconciliation before launch.
- No recipe execution, account connection, publishing, merge, paid service, or deployment occurs from this page.

## Evidence

Local preview: http://127.0.0.1:4174/

Browser screenshots are recorded outside the source tree in the campaign evidence directory:

- work/campaign/alpha/landing/desktop-workshop.jpg
- work/campaign/alpha/landing/desktop-recipe-keyboard.jpg
- work/campaign/alpha/landing/mobile-map.jpg
- work/campaign/alpha/landing/mobile-setup.jpg

The lead independently reviews the artifact before integration.
