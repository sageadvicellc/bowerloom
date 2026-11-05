---
title: "Share a harness"
description: "Export a harness to one file, and import a file from someone else, in the app or with two commands."
section: "Guides"
order: 6.8
---

A harness bundle is one file that carries a harness from one computer to another. You make it with Export and read it with Import. Both work in the [desktop app](/docs/app/) and with `bowerloom harness export` and `bowerloom harness import`. Both show a plan first. Nothing is written until you approve the exact plan.

## What the file holds

The file is plain text (JSON). It holds the files of the `.bowerloom` folder of the harness: agents, skills, tools, rules, instructions, and scripts. It records a size and a checksum for each file. A checksum is a short code that changes when the file changes, so Bowerloom can tell that a file was changed or damaged.

The file never holds:

- A secret value that Bowerloom can find. A tool can name a value, such as `${GITHUB_TOKEN}`, or an entry of the macOS Keychain, which is where macOS keeps passwords. The file holds the name only. Bowerloom refuses a file where it finds what looks like a secret value, with `BUNDLE_SECRET_FOUND`, on export and on import. The check cannot find every form of a secret, so do not put a secret in a harness.
- The path of a notes folder. By default the file holds the kind and the name of a notes source and no folder.
- The `knowledge.json` file, which holds those paths.
- The home path of the computer that exported it. Text inside a file can still hold such a path, and Export asks you to read those paths.

An import installs nothing and runs nothing. Run `bowerloom harness install` afterward to see that plan.

## Export

In the app, open a harness in the Builder and press **Export** in the header. A sheet opens. A sheet is a panel on top of the screen. It shows what the file would hold. Choose where to save. The file holds the saved harness, so changes you have not saved are not in it. The sheet asks for a tick only when the files hold a path from this computer. A place inside the `.bowerloom` folder of the harness is refused, because a file there would break the harness. Choose a place outside the harness folder.

::visual{id="app-export-sheet"}

On the command line, run the command in the folder:

```sh
bowerloom harness export --output harness.json
```

This prints the plan and writes nothing. A revision is the number of a plan. Run the command again with it:

::visual{id="cli-harness-export"}

```sh
bowerloom harness export --output harness.json --approve <revision>
```

- `--output <file>` is the new file. Bowerloom does not replace a file that exists. Add `--replace` to replace it. Bowerloom then replaces only the file it saw when it made the plan.
- When the plan lists text that holds a path from this computer, add `--acknowledge <hash>`. A hash is a long code that the plan prints. Read the paths first, because they stay in the file as written.
- `--json` prints the plan as JSON.

## Import

A file from another person is data, and it can start programs on your computer once you install. Read what runs before you import.

Do not edit a bundle by hand. Most edits show as a damaged file. The run permission of a file does not, because the checksum does not cover it. Read the list of files that can run.

In the app, press **Import from a file**. It sits in the Folders block of Harnesses, or in the empty state when you have no harness. The steps are File, Folder, Review, and Done. Choose the file, then pick the folder that gets the harness. Review shows what the file holds. Tick the boxes, then press **Import**. The app keeps a save point before and after, so **Go back** works.

On the command line, run the command in the folder that gets the harness:

```sh
bowerloom harness import harness.json
```

This prints the plan and writes nothing. Run it again with the flags the plan asks for:

::visual{id="cli-harness-import"}

```sh
bowerloom harness import harness.json --acknowledge <hash> --approve <revision>
```

- `--acknowledge <hash>` says that you read what the plan listed. Without it the import is refused with `IMPORT_NEEDS_ACKNOWLEDGEMENT`. It is needed when the file holds tools or files that can run, values a tool reads from this computer, or paths from another computer.
- `--approve <revision>` approves the exact plan.
- `--link <name>=<folder>` links a notes name in the file to a folder on this computer. The folder must be inside the harness folder or inside your home folder. It cannot be your home folder itself, and it cannot be a hidden folder or inside one.
- `--leave <name>` leaves a notes name out. A name that you do not link is left out.
- `--json` prints the plan as JSON.

## Read what runs

Before you tick the boxes, read the whole review. For each tool it shows:

- The command, every argument, every environment variable, every header, and the address. A header is a line of text sent with a web request. Each is shown whole and never cut. A tool whose command or arguments are too long to show whole is refused.
- Whether the tool starts a program on your computer or connects to a web address. A host is the computer at that address.
- Whether the tool downloads code when it starts, starts with admin rights, or runs a command line.
- The names of the engine settings the tool carries that the review does not list, such as a timeout. The line reads "Carries engine settings that are not listed here:" and then the names. A name is shown, not its value. The tick covers them too.

An environment variable is a named value that a program reads when it starts. A value can change how a program starts. `NODE_OPTIONS` and `LD_PRELOAD` are two examples. Read each one.

The app marks a variable that can change how a program starts. Two marks are possible. "This makes the program load extra code." is for names such as `NODE_OPTIONS` and `LD_PRELOAD`. "This sends the program's traffic through another host." is for the proxy names `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY`. The names match in any letter case. The command line does not mark each name. It prints one line under the tools instead: "An environment value can change how a program starts or where its traffic goes. Read each one."

The review also lists the files that can run: hooks, scripts, files with the run permission, files that start as programs, and files that hold the bytes of a program. The list is a guide. A text file can still hold commands.

## The values it reads

A tool can read a value from your computer, written `${NAME}`. The file does not hold the value. The review lists each name and where it goes: the tool, and the field that carries it. The fields that need a tick are the command, an argument, a header, and the address. A value in a header or an address goes to the host the file names.

Bowerloom does not check that these values exist on this computer. Check each one. Be sure you trust the host that gets it.

## Limits

- The file is at most 48 MiB. A MiB is about one million bytes. A larger file is refused with `BUNDLE_TOO_LARGE`.
- The file holds at most 4,096 files, 1 MiB each and 32 MiB in all.
- A command, an argument, a header, or an address is at most 4,000 characters. A tool has at most 64 arguments, variables, or headers. A file past either limit is refused with `BUNDLE_INVALID`, on export and on import.
- A path has at most 16 folders and 1,024 characters.
- A file can list at most 200 notes names.

## Where an import can go

An import writes only into a folder with no harness, or with an empty one. A folder with no harness gets an empty one in the same plan, so one approval covers both. A folder with parts or settings in its harness is refused with `IMPORT_FOLDER_HAS_HARNESS`. The refusal names them. Import into a new folder, or into one whose harness is empty. Import does not merge into a harness.

The command line keeps no save points, so a command line import has no Go back. To undo an import into a new folder, remove its `.bowerloom` folder. The app keeps save points.

## If it is refused

[Errors](/docs/reference/errors/#harness-refusals) lists every `BUNDLE_*`, `IMPORT_*`, and `EXPORT_*` code of the command line, with its next step. The app can also show these codes, with these words:

- `EXPORT_NO_DEFINITION`: the folder has no harness yet. Make a harness first with **New harness from a folder**.
- `EXPORT_TARGET_IN_HARNESS`: the place to save is inside the `.bowerloom` folder of the harness. A file there would break the harness. Choose a place outside the `.bowerloom` folder.
- `NOT_THE_PLAN_SHOWN`: the plan changed. Plan again, then approve it.
- `SAVE_EXECUTABLE_UNACKNOWLEDGED`: tick that you read the files that can run, then import.
- `SAVE_NO_DEFINITION`: choose the folder again, then plan the import again.
- `SAVE_STALE`: the folder changed since the plan. Plan the import again.
- `SAVE_RECOVERY_REQUIRED`: finish the stopped change first, then import.
- `QUIT_BEGUN`: Bowerloom was closing, so nothing was written. Open Bowerloom again, then share again.
