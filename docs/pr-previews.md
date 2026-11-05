# Pull request previews

Each pull request that changes the website gets its own preview address.

- The address is `https://pr-<number>.preview.bowerloom.ai`, where `<number>` is the pull request number.
- It always shows the latest build of the pull request branch.
- A bot comment on the pull request holds the link. It updates on each build.
- Vercel protects the preview. You need a login to the Vercel team to open it.
- A build starts when the latest commit on the branch changes `apps/landing/` or `release/`.
- The address is removed when the pull request closes.
- Pull requests from forks get no preview.

The workflow is `.github/workflows/pr-preview.yml`. It needs the `VERCEL_TOKEN` repository secret. Without it, the workflow logs a notice and does nothing.
