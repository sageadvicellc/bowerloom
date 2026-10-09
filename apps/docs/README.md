# Bowerloom documentation preview

This Astro application uses Fumadocs to build static pages for `/docs` in the existing landing project.
The documentation build does not deploy the site or publish the beta.

## Local commands

Use Node 24.11 from the repository root.
Install the dependencies from the separate documentation lockfile.

```sh
npm --prefix apps/docs --workspaces=false ci --ignore-scripts --no-audit --no-fund
npm --prefix apps/docs --workspaces=false test
npm --prefix apps/docs --workspaces=false run build
npm --prefix apps/docs --workspaces=false run check:release
npm --prefix apps/docs --workspaces=false run check:exports
npm --prefix apps/docs --workspaces=false run check:links
npm --prefix apps/docs --workspaces=false run preview -- --port 4321
```

Open `http://127.0.0.1:4321/docs/` after the preview server starts.
Search uses the static `search.json` from the same document snapshot as the pages and Markdown exports.
Restart the development process after Markdown edits because each process retains its first content snapshot.

The root workspace excludes this standalone application.
Keep `--workspaces=false` so that its dependencies and lockfile remain separate from the CLI.
The application pins Astro 7.3.5 and Fumadocs core/UI 16.16.2. The package manifest and lockfile record all dependency versions.
The installation command disables package scripts. The build and preview scripts disable Astro telemetry.
The application uses no server adapter or external search service.

## Landing integration

After both applications build, copy `apps/docs/dist/` into the landing deployment's `docs/` directory.
Preserve `/docs/` routes, `_astro` assets, fonts, Markdown files, `search.json`, `llms.txt`, and `llms-full.txt`.
Serve Markdown as `text/markdown` and the `llms` indexes as plain text.
Return HTTP 404 for missing documentation routes. Do not route missing documentation to the landing application.
The shared deployment owner manages Vercel integration. Do not deploy this directory as the homepage.

## Content and assets

Markdown lives in `src/content/docs`. Page frontmatter defines navigation sections, order, and compatibility pages.
The content loader resolves release sections from `release/beta.json` in memory without rewriting Markdown or the root README.
HTML, search, copied procedures, and Markdown exports use the same resolved snapshot.
`check:release` assesses release expansion. `check:exports` compares the built exports with that snapshot.

Keep tested source and artifact identities beside capability claims. Source tests do not establish installed runtime support.
The approved Newsreader and Manrope fonts retain their OFL notices. Plain wordmarks and robot assets come from the landing site.
The stylesheet uses the Rose Conservatory and After Hours colors.
The header exposes Main site, Docs home, and the theme selector on desktop and mobile.

The planned npm channel remains unavailable until publication. Contributor source instructions remain separate from normal onboarding.
The site includes a noindex directive. Hosting authentication protects the preview because noindex does not control access.

## Acceptance boundaries

Content review, independent technical review, deployed behavior, and packaged-command evidence remain separate acceptance gates.
Documentation tests do not establish native harness qualification, company-service readiness, security acceptance, or beta release approval.
