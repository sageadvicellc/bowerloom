# Articles

Each article is one markdown file here: `<slug>.md`. The slug is lowercase letters, digits, and single hyphens. It becomes the URL `/articles/<slug>/`.

This README is not an article. Only files ending in `.md` other than `README.md` count.

## Front matter

Every file starts with a block between two `---` lines. One `key: value` pair per line. Text may be wrapped in double quotes.

- `title` (required): the headline.
- `description` (required): one or two sentences for search and link previews.
- `date` (required): `YYYY-MM-DD`. An article dated in the future is held back until that day.
- `author` (required): the byline name. The page shows exactly what you write here.
- `updated` (optional): `YYYY-MM-DD`, on or after `date`.
- `draft` (optional): `true` keeps the article out of the build.

Unknown keys, a missing required key, or a bad date fails the build with a message naming the file.

## Body

Markdown after the front matter. Raw HTML is shown as text, never run. Links may be `http`, `https`, or relative. Other schemes are dropped.

Every article page says "Agents helped draft this article." Drafts go through the separate fact-check and approval path before `draft: true` is removed.

## Dates and local preview

A future-dated article appears only after the next build on or after its date. Nothing rebuilds on its own, so run a build that day.

`vite dev` does not serve `/articles/`, the sitemap, or robots.txt. Run `npm run build --workspaces=false`, then `npm run preview --workspaces=false`.

## Link limits

A link target may hold one level of balanced parentheses, such as `https://example.org/wiki/Thing_(idea)`. Deeper nesting is not read as a link. A target with a space is not a link.

A missing `content/articles` folder fails the build. A draft, a future-dated article, or a file that is not `.md` prints a warning with its name.
