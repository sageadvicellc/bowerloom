# Trellis monorepo cutover

Hanna approved a Trellis monorepo and retirement of the dispersed framework repositories on October 1, 2026. The target is `sageadvicellc/trellis`. Sagespec remains a separate product repository.

Retirement means archived repositories with retained history. It does not mean deletion or a visibility change. The team handles migration and feature integration under the approved working order.

## Repositories in scope

| Repository | Replacement | Retirement gate |
|---|---|---|
| sageadvicellc/trellis-crew | Crew module in the monorepo | Accepted code, open-work mapping, tests, and cutover |
| sageadvicellc/trellis-relay | Relay module in the monorepo | Accepted code, open-work mapping, tests, and cutover |
| sageadvicellc/trellis-roots | Roots module in the monorepo | Accepted code, open-work mapping, tests, and cutover |
| sageadvicellc/trellis-vines | Vines module in the monorepo | Accepted code, open-work mapping, tests, and cutover |
| sageadvicellc/trellis-workbench | Workbench module in the monorepo | Accepted code, open-work mapping, tests, and cutover |

The separate historical `sageadvicellc/workbench` repository is outside this retirement list. Unrelated practice and client repositories remain outside it.

## Migration and retirement

1. Refresh the source revisions and open-work inventory.
2. Preserve repository history and recovery copies.
3. Map each open pull request and issue to retained work or a recorded disposition.
4. Review the proposed imports for private material and licensing conflicts.
5. Import accepted code with its source references into the monorepo feature branch.
6. Preserve module boundaries and create the shared build and test process.
7. Test clean installation, cross-module behavior, packaging, and recovery from failed migration.
8. Prepare the assembled feature and cutover evidence for Hanna.
9. Wait for Hanna to merge the approved revision into `main`.
10. Make sure that each replacement is available to its intended users before retirement.
11. Add a migration notice and replacement links to each old repository.
12. Archive each old repository after its cutover gates pass.

The monorepo decision is settled. Remaining architecture choices continue through the specification walkthrough. No repository is archived by this decision record alone.
