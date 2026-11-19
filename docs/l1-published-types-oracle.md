# Claude published-types oracle

The pin is the public `@anthropic-ai/claude-agent-sdk` **0.3.287** package's
`sdk-tools.d.ts`, corresponding to Claude Code **2.1.287**. It is not a local
Claude Code writer-source oracle. No Claude Code source tree is used.

Regenerate offline from the unpacked published package, without installing it:

```sh
bun run --cwd packages/api-routes facts:claude-types -- \
  --source ~/l1-work/npm/sdk/package/sdk-tools.d.ts
```

This writes the compact `claude-types-0.3.287.json` declaration snapshot and
`claude-types-coverage-0.3.287.json` coverage report in `transcript-records/`.
The snapshot records the source SHA-256, declaration file:line, tool/schema,
direction, optionality, type and documentation. The AST expander follows
aliases, union variants, arrays, typed content blocks and maps. Unsupported or
recursive types produce diagnostics instead of invented declarations.

`FileRead`, `FileWrite` and `FileEdit` schema names correspond to `Read`,
`Write` and `Edit` census tool names. Other schema stems are used as names;
the schema union is not itself a transport tool-name enum. MCP inputs remain
explicitly open JSON. Result paths are `user.toolUseResult…`: **they are pooled
across tools in census notation**, so a path witness does not establish that
every tool declaring that path was invoked. Blind spots are declared path/tool
pairs with no matching local path, not a proof that the feature never emits.

The coverage test requires every catalogued Claude tool payload source to
match a declaration or an explicit, justified exception. Tool-result message
envelopes, tool ids/names, permissions, attachments and `wireToolInputs` are
outside `sdk-tools.d.ts`; they are not fabricated from payload types. Local
paths absent from the pin are reported, including post-pin CLI extensions and
tools the public unions omit. Unknown payloads do not silently declare their
children. The report uses the committed, bounded local census and records the
corpus caveat; regeneration does not scan transcript files or retain text.

`published_types` evidence in the catalog is path-scoped. Documentation/type
semantics can support a judged mapping, but verification also requires a local
census or fixture witness and semantic support for every primary source.
Unreviewed sources, open JSON and unrelated SDK declarations never upgrade a
mapping to verified. Pending still means not extracted, even if its meaning is
verified. Parser behavior is unchanged; the extraction plans remain parser 9.
