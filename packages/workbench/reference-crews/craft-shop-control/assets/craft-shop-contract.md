# Craft-shop browser contract

The alpha demo is one self-contained HTML file. It uses synthetic jobs and needs no external resource or marketplace connection.

The trusted browser test uses the following interface. The application must preserve these identifiers when it changes its appearance.

| Element | Contract |
| --- | --- |
| Job form | `form#job-form` |
| Title input | `input#job-title`, with a visible label and required value |
| Add control | A submit button inside `#job-form` |
| Jobs container | `#jobs` |
| Job row | An element inside `#jobs` with a stable `data-job-id` |
| Visible title | `.job-title` inside each row |
| Stage control | `select.job-stage` inside each row |
| Stage values | `queued`, `in-progress`, and `done` |
| Export control | `button#export-jobs` |

A new job starts at `queued`. Its identifier remains stable after a stage change and page reload. The application stores jobs in localStorage.

The export button downloads `trellis-jobs.json`. The file contains one JSON object with `version: 1` and a `jobs` array.

Each exported job has exactly `id`, `title`, and `stage`. The identifier and title are strings. The stage uses one of the three declared values.

The trusted test adds a unique synthetic title through the form. It changes that row to `in-progress`, reloads the page, and downloads the export.

The test compares the visible row and downloaded record. It requires the same identifier, exact title, and changed stage in both places.

A passing test requires all four behaviors and successful process cleanup. Application text or model claims cannot supply the result.

This contract tests one browser session and origin. It does not prove durability after a browser restart or access from another machine.
