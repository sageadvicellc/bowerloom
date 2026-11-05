---
title: "Share a harness"
description: "Export a harness to one file, and import a file from someone else, in the app or with two commands."
section: "Guides"
order: 6.8
---

A harness bundle is one file that carries a harness from one computer to another. You make it with Export and read it with Import. Both work in the [desktop app](/docs/app/) and with `bowerloom harness export` and `bowerloom harness import`. Both show a plan first. Nothing is written until you approve the exact plan.

## What the file holds

The file is plain text (JSON). It holds the files of the `.bowerloom` folder of the harness: agents, skills, tools, rules, instructions, and scripts. It records a size and a checksum for each file, so a changed or damaged file is refused.

The file never holds:

- A secret value. A tool may name a value, such as `${GITHUB_TOKEN}`, or a Keychain entry. The file holds the name only. A file that holds what looks like a secret value is refused with `BUNDLE_SECRET_FOUND`, on export and on import.
- The paths of your notes folders. By default the file holds the kind and the name of a notes source and no folder. A notes folder is never in it.
- The `knowledge.json` file, which holds those paths.
- A path that Bowerloom added, such as your home folder.

An import installs nothing and runs nothing. Run `bowerloom harness install` afterward to see that plan.

## Export

In the app, open a harness in the Builder and press **Export** in the header. The sheet shows what the file would hold. Choose where to save. The file holds the saved harness, so changes you have not saved are not in it. A place inside the `.bowerloom` folder of the harness is refused, because a file there would break the harness.

On the command line, run the command in the folder:

```sh
bowerloom harness export --output harness.json
```

This prints the plan and writes nothing. Run it again with the revision of the plan:

```sh
bowerloom harness export --output harness.json --approve <revision>
```

- `--output <file>` is the new file. Bowerloom does not replace a file that exists. Add `--replace` to replace it, and Bowerloom replaces only the file it saw when it made the plan.
- When the plan lists text that holds a path from this computer, the export needs `--acknowledge <hash>` as well. The plan prints the hash. Read the paths first, because they stay in the file as written.
- `--json` prints the plan as JSON.

## Import

A file from another person is data, and it can start programs on your computer once you install. Read what runs before you import. Do not edit a bundle by hand: an edit shows as a damaged file.

In the app, press **Import from a file**. It sits in the Folders block of Harnesses, or in the empty state when you have no harness. The steps are File, Folder, Review, and Done. Choose the file, then pick the folder that gets the harness. Review shows what the file holds. Tick the boxes, then press **Import**. The app keeps a save point before and after, so **Go back** works.

On the command line, run the command in the folder that gets the harness:

```sh
bowerloom harness import harness.json
```

This prints the plan and writes nothing. Run it again with the flags the plan asks for:

```sh
bowerloom harness import harness.json --acknowledge <hash> --approve <revision>
```

- `--acknowledge <hash>` says that you read what the plan listed. The import is refused with `IMPORT_NEEDS_ACKNOWLEDGEMENT` without it, when the file holds tools or files that can run, values it reads from this computer, or paths from another computer.
- `--approve <revision>` approves the exact plan.
- `--link <name>=<folder>` links a notes name in the file to a folder on this computer. The folder must be a real folder that you own.
- `--leave <name>` leaves a notes name out. A name that you do not link is left out.
- `--json` prints the plan as JSON.

## Read what runs

Before you tick the boxes, read the whole review. For each tool it shows:

- The command, every argument, every environment variable, every header, and the address. Each is shown whole and never cut. A tool whose command or arguments are too long to show whole is refused.
- Whether the tool starts a program on your computer or connects to a web address.
- The files that can run: hooks, scripts, files with the run permission, files that start as programs, and files that hold the bytes of a program. The list is a guide. A text file can still hold commands.

## The values it reads

A tool may read a value from your computer, written `${NAME}`. The file does not hold the value. The review lists each name and where it goes: the tool, and the field that carries it (the command, an argument, an environment variable, a header, or the address). A value in a header or an address goes to the host the file names.

Bowerloom does not check that these values exist on this computer. Check each one, and be sure you trust the host that gets it.

## Limits

- The file is at most 48 MiB. It holds at most 4,096 files, 1 MiB each and 32 MiB in all.
- A command, an argument, a header, or an address is at most 4,000 characters. A tool has at most 64 arguments, variables, or headers. A file past either limit is refused with `BUNDLE_INVALID`, on export and on import.
- A path has at most 16 folders and 1,024 characters.
- A file may name at most 200 notes folders.

## Where an import can go

An import writes only into a folder with no harness, or with an empty one. A folder with no harness gets an empty one in the same plan, so one approval covers both. A folder with parts or settings in its harness is refused with `IMPORT_FOLDER_HAS_HARNESS`, and the refusal names them. Import into a new folder, or into one whose harness is empty. Import does not merge into a harness.

The command line keeps no save points, so a command line import has no Go back. To undo an import into a new folder, remove its `.bowerloom` folder. The app does keep save points.

## If it is refused

[Errors](/docs/reference/errors/#harness-refusals) lists every `BUNDLE_*`, `IMPORT_*`, and `EXPORT_*` code of the command line with its next step. The app adds three of its own:

- `EXPORT_NO_DEFINITION`: the folder has no harness yet. Make one first with **New harness from a folder**.
- `EXPORT_TARGET_IN_HARNESS`: the place to save is inside the harness folder. Choose a place outside it.
- `NOT_THE_FOLDER_SHOWN`: you chose a folder other than the one the screen names. Choose the folder it names.
