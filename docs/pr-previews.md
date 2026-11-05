# Pull request previews

Each pull request that changes the website gets its own preview address.

- The address is `https://pr-<number>.preview.bowerloom.ai`, where `<number>` is the pull request number.
- It always shows the latest build of the pull request branch.
- A bot comment on the pull request holds the link. It updates on each push.
- Vercel protects the preview. You need a login to the Vercel team to open it.
- The workflow runs when a pull request opens, updates, or reopens, and changes `apps/landing/` or `release/`. It waits up to about 10 minutes for Vercel to finish the build, then points the address at it.
- Vercel starts a build when the latest commit on the branch changes `apps/landing/` or `release/`. If Vercel skips the build, the address keeps pointing at the last build.
- The address is removed when the pull request closes.
- Pull requests from forks get no preview.

The workflow is `.github/workflows/pr-preview.yml`. It needs the `VERCEL_TOKEN` repository secret. Without it, the workflow logs a notice and does nothing.
