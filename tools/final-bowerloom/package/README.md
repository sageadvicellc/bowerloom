# bowerloom

Bowerloom is now Latebrake.

This package keeps the old commands working. It has no code of its own. Each old command runs the matching command of the
`latebrake` package.

## Install the new name

```
npm install -g latebrake
```

## What the old commands do

- `bowerloom` runs `latebrake`. In a terminal it prints one line on stderr that says the name changed. It prints nothing
  when you use `--json`, when its output goes to a pipe, or when it runs as `bowerloom context guard`.
- `bowerloom-mcp` runs `latebrake-mcp`. It never prints a notice, because its output is the MCP stream.
- `bowerloom-guard` runs `latebrake-guard`. It never prints a notice. If `latebrake` cannot load, it blocks the tool call.

The old commands keep working until 1.0.

## Docs

Run `latebrake --help`. The docs ship with `latebrake`.

## License

MIT
