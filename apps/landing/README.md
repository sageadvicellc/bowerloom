# Bowerloom alpha workshop

A standalone React landing page with the selected generated still and a preserved React Three Fiber workshop. It introduces Bowerloom and the Labs recipe; it does not run the recipe or connect accounts.

From this directory, with Node 24.11:

```sh
npm ci --workspaces=false
npm run dev --workspaces=false
npm run typecheck --workspaces=false
npm run build --workspaces=false
npm run preview --workspaces=false
```

Keep this app's lockfile separate from the monorepo root lockfile. No deployment is configured.

## Interaction and fallback checks

The scene-specific checks below apply to the historical workshop at `/?cinematic=0`. The default still and explicit video study are documented further below.

- “Build with your agent” navigates to the setup section.
- Every recipe stage has a keyboard-operable DOM button; stage changes update the explanation and selected scene station.
- Copy the prompt and compare it with the read-only text. If clipboard permissions are unavailable, the text is selected for manual copy.
- The static-map control removes the WebGL canvas. Pause stops the render loop. An offscreen or hidden page suspends animation.
- Reduced motion uses the SVG workshop map without loading the WebGL scene. WebGL construction errors and context loss also fall back to that map.
- Verify layout at 1440 px and 390 px; all navigation, stage, motion, and copy controls have visible keyboard focus.

The historical R3F scene uses procedural geometry, one 1024px shadow map, no textures, no external assets, no postprocessing, and a DPR capped at 1.5. DOM content is independent of the scene.

## Local rendering budget

In the development server, open `/?cinematic=0&diagnostics=1`. The visible local panel reads Three renderer statistics and the actual R3F render-loop mode. It skips two priming frames, samples 120 frames, publishes one result, then stops collecting. There is no telemetry, network call, persisted metric, runtime dependency, or production diagnostics panel.

Acceptance budgets: scene JavaScript ≤300 KiB gzip, tested canvas backing area ≤2 million pixels, DPR ≤1.5, maximum main-render draw calls ≤250, and maximum main-render triangles ≤50,000. Shadow-pass cost and full GPU profiling are unmeasured; the counters do not represent total frame cost. Pause uses demand rendering; static/reduced-motion modes remove the canvas. Frame intervals are supplemental local observations, not a universal FPS promise. See `VERIFICATION.md` for the measured viewport and results.

## Projection UI provenance

`src/projection-tokens.css` is the actual MIT-licensed fallback token stylesheet from `@hannasage/projection-ui` 0.1.5. Its copyright and license are preserved in `PROJECTION-UI-LICENSE`. The compact radius overrides and variable usage follow the consumer mapping in the resume project's `app/lib/apply-visual-palette.ts`. The app consumes the licensed tokens directly; it does not bundle the library's charts or drag-and-drop peers.

Documentation links target `feature/trellis-v1` while alpha work is under review. Reconcile these links with the accepted release branch before a public launch.

## Selected still and animation study

The default page uses Sage Picnic: cream, sage, and blush through Projection UI tokens. Opaque cream panels keep text readable.
Local Lora supplies headings and reading text. Projection mono remains on utility labels, controls, navigation, and commands.
The page contains a compact still hero, product explanation, four recipe stages, recorded proof, setup disclosure, and eight FAQs.
The removed journey disclosure is not part of this version.

The historical R3F workshop remains at `/?cinematic=0`. The default page and `/?cinematic=1` use the selected still without video requests.
The normal still has slight scroll-linked opacity changes. Reduced motion removes this effect.

Open `/?cinematic=1&motion=preview` for the six-clip technical study. This query is explicit because the later generated rooms need art correction.
The study is labeled as artwork under review. It is not accepted creative work or software evidence.
Source videos, prompts, and provider records remain in the private campaign directory. `public/scroll-world/manifest.json` records the served assets and their hashes.

Each clip uses silent H.264, native 1920×1080, 24 frames per second, faststart, and an eight-frame keyframe interval.
The six slowed clips total approximately 60 seconds. Each file stays below 16 MiB and the runtime rejects durations above 15 seconds.
Only the active clip is fetched. Scene changes abort the previous fetch and revoke its object URL.
The runtime limits received bytes even without a content-length header. It requires an MP4 content type and finite duration before use.
The selected opening still remains the default image. Scene-specific posters cover pending loads in the technical study.

Scroll input keeps the newest requested position. The controller waits for each active seek to finish before another seek.
The poster stays visible until a frame callback or a completed seek confirms decoded video data.
A brief dissolve uses the previous clip's final frame. Its opacity follows scroll position in both directions.
This softens generated differences at joins. It does not make their frames identical.
Hidden and offscreen sections stop scheduling seeks. No video autoplays, plays audio, or sends telemetry.

The still-view control cancels the fetch, removes video, and returns to the compact hero.
Phones, coarse pointers, and reduced-motion preferences use the landscape still and request no video.
The recipe and setup links remain available in both presentations. No animation supplies a factual product claim.

Run the controller tests with Node 24 from this directory:

```sh
node --test test/cinematic-scrub.test.mjs
```

The adaptation follows scroll-world 0.8.0 principles. `SCROLL-WORLD-LICENSE` preserves its MIT license.
See `SCROLL-VERIFICATION.md` for technical observations and remaining limits. Public deployment and creative acceptance remain separate decisions.

Utility labels use at least 13px. Navigation, controls, and the setup prompt use 14px.
The prompt uses line height 1.6 and a 440px text area. Its header wraps on small screens.
Small sage text uses `#536344`. Its contrast is 6.150124:1 on cream and 5.692158:1 on the pale panel.
Button backgrounds keep the selected primary color and white labels. Large decorative accents retain the lighter sage.

## Social preview

The landing page and documentation share `release/social-preview.json` and `/social/bowerloom.png`.
The image uses the approved S4-G3 pose, wordmark, and light palette from `src/brand.css`.
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
