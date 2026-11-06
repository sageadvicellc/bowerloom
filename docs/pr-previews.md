# Pull request previews

Each pull request that changes the website gets its own preview address.

- The address is `https://pr-<number>.preview.bowerloom.ai`, where `<number>` is the pull request number.
- It points at the latest build that Vercel produced for the pull request branch.
- A bot comment on the pull request holds the link. It updates on each push, but only when a build is ready within the time bound below.
- Vercel protects the preview. You need a login to the Vercel team to open it.
- The workflow acts when a pull request opens, updates, or reopens, and the pull request changes `apps/landing/` or `release/`. It polls Vercel for up to about 10 minutes, with a pause of 15 seconds between polls, then points the address at the ready build.
- Vercel starts a build only when the latest commit on the branch changes `apps/landing/` or `release/`. If Vercel skips the build, or it is not ready in time, the address keeps pointing at the last build. If the build fails or is canceled, the workflow stops and logs it.
- The address is removed when the pull request closes, whatever the paths.
- Pull requests from forks get no preview.

The workflow is `.github/workflows/pr-preview.yml`. It needs the `VERCEL_TOKEN` repository secret. Without it, the workflow logs a notice and does nothing.

## Prerequisites

- The domain `preview.bowerloom.ai` and the wildcard `*.preview.bowerloom.ai` are on the Vercel team `sageadvicellc`, and on the project `bowerloom-preview`.
- The DNS records for both names point to Vercel.
- The `VERCEL_TOKEN` repository secret holds a token scoped to the team `sageadvicellc`.

## Accepted risk

Anyone with write access to this repository can change the workflow on a branch. A changed workflow can read `VERCEL_TOKEN` and use the team token. Who owns the token is the owner's choice. The CLI install runs with install scripts off and in a step that holds no secret.

The Vercel CLI runs with `GH_TOKEN` removed from its environment. Its dependencies can still read `VERCEL_TOKEN`, because the CLI needs it. A compromised dependency of the pinned CLI version could therefore use the team token. This risk stays.
