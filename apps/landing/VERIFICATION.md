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
- Hidden/offscreen suspension is implemented with visibilitychange and IntersectionObserver. A bounded renderer-statistics sample is recorded below; full CPU/GPU profiling was not recorded.
- The 3D chunk is lazy-loaded and about 240 KiB gzip. Vite reports its 700 KiB raw chunk warning. The reduced-motion path does not load this chunk.
- React Three Fiber's internal use of Three.Clock produces an upstream deprecation warning with Three 0.183.2. Explicit percentage shadows avoid the deprecated soft shadow mode.
- Documentation URLs target the active integration branch. The recipe docs and skill are supplied by the parallel recipe work before integration. Public branch/release URLs require reconciliation before launch.
- No recipe execution, account connection, publishing, merge, paid service, or deployment occurs from this page.

## Evidence

### Measured rendering budget

Local Chrome, viewport 1280 × 720, October 2. The visible development-only `?diagnostics=1` panel skipped two priming frames and sampled 120 frames. Sampling then stopped. Renderer statistics describe the preceding completed main render. Three 0.183.2 resets these counters after the shadow pass, so shadow-pass cost is not included. Shadow cost and full GPU profiling remain unmeasured; these counters do not represent total frame cost. No metric is transmitted or persisted by the application.

| Metric | Measured | Budget |
| --- | ---: | ---: |
| Lazy scene JavaScript (gzip) | 231.63 KiB (237,185 bytes) | ≤300 KiB |
| Maximum main-render draw calls | 191 | ≤250 |
| Maximum main-render triangles | 11,380 | ≤50,000 |
| DPR | 1.5 | ≤1.5 |
| Canvas backing dimensions | 1341 × 904 | — |
| Canvas backing pixels | 1,212,264 | ≤2,000,000 |
| Sampled frame interval, mean | 8.33 ms | observation only |
| Sampled frame interval, p95 | 9.30 ms | observation only |

The exact gzip byte count uses Python gzip at level 6 over the production scene chunk; Vite separately reports approximately 240 kB gzip. Production JavaScript was checked for the diagnostics panel and sampling text, which are absent.

All bounded metrics passed in this viewport. Timing is specific to this local run and does not establish performance across devices. The loop reported `always` while animated and `demand` after Pause, read from actual R3F state. Static-map mode reported zero canvas elements. Reduced motion shares that same canvas-free branch; OS preference emulation remains untested.

Screenshots: `rendering-budget.jpg`, `rendering-paused.jpg`, and `rendering-static.jpg` in the campaign evidence directory below.

Local preview: http://127.0.0.1:4174/

Browser screenshots are recorded outside the source tree in the campaign evidence directory:

- work/campaign/alpha/landing/desktop-workshop.jpg
- work/campaign/alpha/landing/desktop-recipe-keyboard.jpg
- work/campaign/alpha/landing/mobile-map.jpg
- work/campaign/alpha/landing/mobile-setup.jpg

The lead independently reviews the artifact before integration.
