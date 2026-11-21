# rudel

Compatibility alias for the [Opaline CLI](https://www.npmjs.com/package/opaline):
`rudel` runs exactly what `opaline` runs.

**Retired.** Opaline's cloud has shut down, and this CLI no longer uploads
anything. Opaline is now a free Mac app that keeps your Claude Code and Codex
sessions on your Mac: [opaline.evren.so](https://opaline.evren.so).

## Remove what earlier versions set up

If you ever ran the Opaline CLI on a computer, run this once there:

```bash
npx opaline@latest   # or: rudel@latest, the same thing
```

Use `@latest`: a plain `npx opaline` may reuse an older cached copy. The
command makes no network requests, and it removes:

- Opaline's automatic-upload hooks from `~/.claude/settings.json`, from the
  project settings of the folders you set up, and from Codex's `notify`
  setting in `~/.codex/config.toml` (a notify command Opaline wrapped is put
  back);
- MCP servers that point at Opaline's cloud (`opaline.so/api/mcp`) from Claude
  Code and Codex;
- the saved sign-in and the upload state in the CLI's folder (`~/.rudel`, or
  `OPALINE_CONFIG_DIR`/`RUDEL_CONFIG_DIR` if you set one).

It leaves everything else alone: your own hooks, other MCP servers, the
Opaline Mac app's plugin and its data in `~/.opaline/server`. Files it cannot
parse are left untouched and named in its output. It keeps `~/.rudel/logs`,
the list of folders you set up (`~/.rudel/auto-upload.json`) and
`~/.rudel/runtime`, the copy that automatic uploads ran. That copy is now this
retired version, so a hook it missed cleans up the next time it runs instead
of uploading. Delete `~/.rudel` yourself once you no longer need any of it.

Every command (`upload`, `login`, `update`, the `hooks` handlers) now does
only this cleanup. Hook handlers print nothing and always succeed.

## License

Copyright (c) 2026 Opaline Labs, Inc. Licensed under [MIT](LICENSE).
