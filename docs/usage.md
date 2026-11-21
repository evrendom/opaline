# CLI guide

The Opaline CLI (`opaline`, `@opalinehq/cli` and `rudel` on npm) is retired.
Opaline's cloud has shut down, so there is nothing left to upload to. Opaline
is now a free Mac app that keeps your Claude Code and Codex sessions on your
Mac: [opaline.evren.so](https://opaline.evren.so). The app reads sessions from
disk and does not need the CLI.

## Remove the CLI from a computer

On each computer where you ran the CLI, run once:

```bash
npx opaline@latest
```

`npx rudel@latest` does the same. Use `@latest`: a plain `npx opaline` may
reuse an older cached copy. A global installation can then be removed with
your package manager, for example `npm uninstall --global opaline`.

The command makes no network requests. It:

1. deletes the saved sign-in first, which stops every earlier version's hooks
   from uploading;
2. removes Opaline's automatic-upload hooks from `~/.claude/settings.json`
   (and `$CLAUDE_CONFIG_DIR/settings.json`), from the project settings of the
   current folder and of every folder listed in the CLI's `auto-upload.json`;
3. removes Opaline from Codex's `notify` setting in `~/.codex/config.toml`
   (and `$CODEX_HOME/config.toml`), putting back the notify command Opaline
   wrapped, if any;
4. removes MCP servers whose URL is Opaline's cloud (`opaline.so/api/mcp`,
   `app.rudel.ai/api/mcp`) from Claude Code's `~/.claude.json` and from the
   Codex config;
5. deletes the CLI's upload state from its folder: `~/.rudel`, or
   `OPALINE_CONFIG_DIR`/`RUDEL_CONFIG_DIR` if you set one, and any other
   folder an installed hook pointed at.

Hooks are recognised by their command: `opaline hooks …`, `rudel hooks …`, or
`'<node>' '<folder>/runtime/cli.js' hooks …`. Your own hooks, other MCP
servers, plugins (including the Opaline Mac app's) and every other setting are
left as they were. A file that cannot be parsed is left untouched and named in
the command's output; remove Opaline's entries from it by hand.

It keeps `logs/`, `auto-upload.json` and `runtime/` in the CLI's folder.
`runtime/cli.js` is the copy automatic uploads ran, now replaced by this
retired version: a hook the command could not reach cleans up when it next
runs instead of uploading. Delete the folder yourself once you no longer need
it.

Every command and every hook handler now runs only this cleanup. Hook
handlers print nothing and exit successfully; in a terminal, the command lists
what it removed.
