---
name: log-change
description: Brings the log up to date with changes already made to the wiki, by hand or by another tool. Use when the person edited the notes themselves and wants the log to catch up. It reads the commit history, adds log lines, and makes one commit.
---

# Log a change

The log is `log.md`. It holds one line for each change, so anyone can see what happened and when. The other skills add their own log line when they change a page. This skill covers changes made some other way.

This skill changes the log. It makes one commit.

## Before you start

Check that the wiki folder holds a `.git` folder at its root. Then run this command in the wiki folder.

```bash
git status --porcelain
```

- If there is no `.git` folder at the root, or `git status --porcelain` fails, the folder is not a git repository. Change nothing. Tell the person what you found, and say that the folder needs to become a git repository first. The log cannot be built without history.
- If the command prints anything, the working tree is not empty. Stop. This skill records changes that are already committed. Tell the person which files are waiting, and ask them to commit those changes or set them aside.

Then read `AGENTS.md` at the root of the wiki for the log format. If it disagrees with this skill, `AGENTS.md` wins.

## Steps

1. **Find the last logged day.** Read the bottom of `log.md`. Note the date of the last line.
2. **Read the history.** List the recent commits with their dates and messages.

   ```bash
   git log --format="%ad %s" --date=short -n 50
   ```

3. **Pick the commits that are not logged.** These are the commits dated after the last logged day, or the commits whose change has no log line. Skip a commit that only touched `log.md`. If you cannot tell where to start, ask the person for a start date.
4. **Check what each commit changed**, when its message is not clear.

   ```bash
   git log -1 --stat --format="%s" <commit>
   ```

5. **Write the log lines.** One line for each change that deserves one, oldest first, at the bottom of `log.md`. Use the format that `AGENTS.md` gives. Say what changed in plain words. Do not put commit ids in the log.
6. **Do not rewrite old lines.** Only add lines at the bottom.

If there is nothing to record, say so. Change nothing and make no commit.

## Finish with one commit

Stage only the log. Then make one commit. Write `<date>` as `YYYY-MM-DD`. The message holds only letters, digits, spaces, and hyphens after the colon, on one line. It reaches git through a quoted heredoc, so nothing in it runs.

```bash
git add -- log.md
git commit -F - <<'MSG'
log: record changes up to <date>
MSG
```

Never skip a check or amend. If the commit fails, leave the file as it is and tell the person what went wrong.

## Tell the person

Say how many lines you added, and the commit message.
