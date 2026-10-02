# Bowerloom identity and portable parts

Hanna selected Bowerloom on October 2, 2026. Bowerloom replaces Trellis as the current product name.

Hanna reports ownership of `bowerloom.ai` and `bowerloom.dev`. The primary identity uses `bowerloom.ai`. This decision does not establish live hosting or DNS.

The hero reads “Grow your abilities with Bowerloom”. The primary action reads “Build with your agent”.

## Current alpha changes

The landing page, README, tutorial, CLI help, and MCP server display name use Bowerloom. Existing art and historical evidence remain available.

The private root package is named `bowerloom`. Its command names are `bowerloom` and `bowerloom-mcp`. The commands `trellis` and `trellis-mcp` remain aliases.

The new private package is `@bowerloom/portable`. Other workspace package names retain `@sagetrellis` for compatibility. No package publication or registry ownership is claimed.

The repository is now `sageadvicellc/bowerloom`. The separate Workbench repository is `sageadvicellc/bowerloom-workbench`. Both repositories are public at the time of this review.

The integration branch remains `feature/trellis-v1`. Current clone commands use the new repository. Historical evidence retains its original identifiers.

Existing schema identifiers, database names, approval digests, persisted events, and MCP tool names remain unchanged. A display-name change does not migrate stored data.

## Portable source and local installation

A bundle is a versioned collection of selected files. Its source is `.bowerloom/manifest.json` and the files named in that manifest.

The alpha installer supports skills and team definitions for Codex. Select named parts and inspect their dependencies before installation.

Read the [portable package contract](../../packages/portable/README.md) for source limits, file rules, and filesystem assumptions.

Use the existing development checkout with Node 24.11 or later within Node 24 and npm 11. From its root, compile the CLI:

```sh
npm run build
node dist/apps/cli/src/main.js portable validate examples/portable/report-seed
```

Choose a new absolute target under a private directory that you own. Replace `/absolute/private-parent/new-workspace` in this command:

```sh
node dist/apps/cli/src/main.js portable plan examples/portable/report-seed \
  --select editorial --harness codex \
  --target /absolute/private-parent/new-workspace
```

The plan names every selected part, dependency, destination, and source hash. Read the source instructions and the plan before approval.

After approval, repeat the same arguments with `install`. Replace `<exact-plan-revision>` with the reviewed revision:

```sh
node dist/apps/cli/src/main.js portable install examples/portable/report-seed \
  --select editorial --harness codex \
  --target /absolute/private-parent/new-workspace \
  --approve <exact-plan-revision>
```

Installation creates a new workspace. It does not overwrite an existing workspace or change home configuration.

Skills go into `.agents/skills/bowerloom-<id>/`. Team definitions go into `.bowerloom/teams/<id>/` as data. Read `START-HERE.md` before use.

The installation receipt records the approved plan and copied file hashes. The plan and receipt report `executionAuthorized: false`.

Installation approval grants permission to create these files only. It does not approve team execution or future actions by an agent.

Other harness names fail explicitly. Codex skill discovery and task execution need separate acceptance evidence. Portable file installation does not establish cross-harness runtime support.

## Later cutover

Hanna retains the main-merge and publication decisions. The protected preview remains separate from production.

The founder renamed the repositories. Current links and the local Git remote use the new canonical name.

Review external CI and deployment connections before production cutover. The preview uses a source artifact and has no automatic Git integration in this campaign.

Before package publication, establish registry ownership and test installation from a clean environment. Review the compatibility period for old command names.

Before production hosting, bind the intended Vercel project and domains. Test HTTPS, mobile access, redirects, and the deployed source revision.

Before persisted-format changes, define an explicit migration and recovery procedure. Preserve historical hashes and approval records.

These cutover actions remain pending. This engineering change does not merge main, publish a release, or attach a domain.
