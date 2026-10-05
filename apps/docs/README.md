# Bowerloom documentation preview

This isolated Astro Starlight application builds static pages for `/docs` in the existing landing project.
It does not deploy, publish a beta, or modify a runtime package.

## Local commands

From the repository root, install using the separate lockfile:

```sh
npm --prefix apps/docs --workspaces=false ci --ignore-scripts --no-audit --no-fund
npm --prefix apps/docs --workspaces=false run build
npm --prefix apps/docs --workspaces=false run check:links
npm --prefix apps/docs --workspaces=false run preview -- --port 4321
```

Open `http://127.0.0.1:4321/docs/`. Search uses the generated Pagefind index and needs a production build; use preview for its review.

The root workspace list names the CLI, landing, and MCP apps explicitly. It excludes this standalone docs application.
Keep `--workspaces=false`: the docs dependencies and lockfile belong here, not in the root package.
Exact direct versions: Astro7.3.5, Starlight0.42.5, markdown-remark7.3.1. Transitive versions are pinned by package-lock.json.
Install scripts and telemetry are disabled by these commands. No server adapter or external search service is used.

## Landing integration

After both applications build, copy the contents of `apps/docs/dist/` into the landing deployment's `docs/` directory.
Keep that directory before any landing SPA fallback. Preserve `/docs/` trailing slash routing and its `_astro`, `pagefind`, and `fonts` children.
The base and all internal links use `/docs`; do not mount the content at the root.
Root owns shared build configuration and Vercel integration. Do not deploy this directory by itself as the homepage.

## Content and assets

Markdown lives in `src/content/docs`. Sidebar order is explicit in astro.config.mjs.
Keep tested source/artifact identities and fixture limitations beside capability claims. Do not upgrade support claims from a source-only test.
The font is copied unchanged from the existing landing Lora asset. Its OFL license is in `public/fonts/Lora-OFL.txt`.
The site includes a preview noindex directive. Authentication must come from the hosting project's protected preview; noindex is not access control.

## Acceptance still required

Content and engineering review, actual packaged-command replay, deployed mobile/keyboard/search checks, and complete documentation-site acceptance remain separate.
This first shell does not claim live native-harness qualification, company-service readiness, or full beta release acceptance.
