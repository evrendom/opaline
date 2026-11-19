# Codex writer-source oracle

From an already available, tagged `openai/codex` checkout:

```sh
bun run --cwd packages/api-routes facts:codex-source -- --source /path/to/codex
```

This writes `packages/api-routes/src/session-transcript/transcript-records/codex-source-<version>.json`. Use `--out /tmp/codex-new.json` to inspect a candidate without overwriting the committed snapshot. Keep one pinned snapshot in the repo, currently **rust-v0.162.0**. A future 0.163+ comparison must report added and removed paths before replacing the pin and its source references.

The script reads Rust source and crate manifests, not compiled schemas. No Rust build, package install or network service is needed. Git commands use `GIT_NO_LAZY_FETCH=1` and `GIT_OPTIONAL_LOCKS=0` so a partial checkout cannot fetch missing objects or refresh another worktree. Modified tracked Rust files/manifests are rejected. Cargo.lock is not read by the oracle; the research checkout's changed lockfile does not change the attributed Rust source.

## What it derives

- The serialized `RolloutItemWire`/`RolloutLine` envelope, payloads, serde names, aliases, generics, tagged/untagged enums, flattening, arrays, map keys and nulls.
- The `policy.rs` persistence decision and its source line for each path, including Legacy versus Paginated history. ExecCommandEnd is transient in this tag even though older real rollouts contain it. Conditional Sleep/SubAgentActivity persistence remains explicit in the policy text; field paths do not claim that all enum values occur in every history mode.
- Typed `WorldStateSection` snapshots in core context code; merge-patch nulls may delete a section. Other extension-contributed JSON remains an open `Value`, not a hand-transcribed list of guessed fields.
- Decoded argument schemas for six tools, marked `decoded_arguments`: their outer persisted `arguments` is still a JSON string. These are declared input schemas, not proof that every call carries every argument.

Every path has a `file:line` source, history mode and index into the deduplicated policy decisions. Serialization adapters for custom wire types are explicit and checked against their serializer bodies. Changed adapter signatures and unknown persistence expressions fail generation. Unresolved types, unreviewed custom serializers and recursive expansion limits become `unknown` diagnostics, never fabricated fields. The current remaining unresolved type is the wildcard-imported `UserInput` inside spawn-agent arguments.

`opaque` paths denote JSON `Value`/schema documents: arbitrary descendants are possible, but no particular child or meaning is proved. Container and nullable paths may never appear in a corpus. Therefore neither snapshot path counts nor structural coverage are semantic-verification percentages. The snapshot stays compact JSON; the formatter deliberately leaves this generated artifact untouched.

Parser behaviour, version and raw-byte pointers are unchanged. Only tooling/tests import the snapshot; the production transcript-records import graph does not load it.

## Serialization correction (2026-10-09)

Rechecked all 11 `snapshot_nonemitted_paths` from the independent Sol audit against the tagged writer (not against unpublished Claude source). All 11 were oracle errors, not agent non-emission:

| Old snapshot path family | Correct wire shape / evidence |
| --- | --- |
| `turn_context/.sandbox_policy.{network-access,writable-roots,writable-roots[],exclude-tmpdir-env-var,exclude-slash-tmp}` (5) | Underscore field names; enum `rename_all` changes variants only. `rename_all_fields` or a variant's own `rename_all` changes struct-variant fields. |
| `event_msg/turn_aborted.error.codex_error_info.{ActiveTurnNotSteerable.turn_kind,HttpConnectionFailed.http_status_code,ResponseStreamConnectionFailed.http_status_code,ResponseStreamDisconnected.http_status_code,ResponseTooManyFailedAttempts.http_status_code}` (5) | Snake-case variant keys from the remote `CodexErrorInfoWire` serializer (`codex-rs/protocol/src/codex_error_info.rs:19`); the impl lives outside the in-memory definition's module. The same correction applies under `task_complete`. |
| `session_meta/.thread_source.Feature` (1) | `thread_source` is a string via serde `into = "String"` (`codex-rs/protocol/src/protocol.rs:2868`), not an externally tagged Feature object. |

The old pin's removed-path guard correctly stopped ordinary regeneration because fabricated error paths matched stored-fact wildcard dependencies. The correction was explicitly reviewed against these serializers and regenerated at the same pinned commit; none of the removed shapes is labelled legacy. Ordinary regeneration now runs cleanly with the guard intact. Synthetic tests cover enum/field renaming and string conversion; pin tests cover remote serializer paths. No transcript parser behaviour changed.

## Coverage and semantic evidence

The matrix and review page partition the writer snapshot into primary-mapped paths, deliberately ignored paths (with reasons), explicit context-only paths, pending-review paths and unassigned residue. Context and pending review are not mapped source coverage. The compact residue ledger retains both proposals for all 102 original disagreements, including corrected serialization names and separately labelled structural coverage. They separately report real-census coverage as declared paths, open JSON children, tool-defined argument children, witnessed legacy paths and unknown paths. Open JSON proves a container exists, not a particular child. Tool-defined input children are not mistaken for fields declared by the rollout writer.

Catalog `legacySources` explicitly identifies patterns not supported by the pinned writer. `codex-legacy-paths.json` carries count-only, local observations and the complete observed CLI-version sets. Regenerate both census artifacts, read-only on local transcripts, with:

```sh
bun packages/api-routes/src/scripts/facts-mapping-census.ts
```

Legacy means unsupported by **this pin**, including observed 0.162.0 alpha shapes; it does not mean the field never existed. Every legacy catalog pattern must have a positive versioned witness. An unobserved path is not eligible for a confident legacy label.

Tooling attaches structural `writer_source` references with `supportsMeaning: false`. Only hand-reviewed evidence on catalog entries can support meaning. The reviewed run timing and CLI-version fields have explicit writer definitions; command duration/exit and the poll wait have checked types and assignment/formatting sites; the MCP read-only boolean copies the tool's annotation, not observed side effects. Unreviewed entries remain unreviewed even with source and corpus witnesses. No mapping is verified solely because the field exists.

## Upgrading the pin

1. Supply an already available tagged checkout. Do not change the pinned snapshot first.
2. Generate a candidate with `--out /tmp/codex-new.json`. The CLI compares it with the committed pin, printing added/removed paths, affected stored mappings, catalog-source gaps and residue. Additions are reports, not CI failures; removing any path used by a stored mapping, including one wildcard child, fails before writing the candidate.
3. Review removed dependencies, serialization/persistence changes and legacy version witnesses. Update affected catalog sources and semantic evidence explicitly. Never relabel a removed field as legacy without a real observed version witness.
4. Replace the single pinned snapshot, its import/version assertions and reviewed source references together. Re-run `bun test` and `bun run check-types` in `packages/api-routes`, regenerate/check the matrix and regenerate the review from the desired corpus. The catalog coverage test rejects undocumented missing sources; the partition test guarantees every new writer path is visible as mapped, ignored with a reason, or residue.

The comparison is structural, not a semantic compatibility guarantee for 0.163+. New or renamed types/serializer adapters may require parser-subset changes and new synthetic tests. The one current `unknown` diagnostic is retained for follow-up rather than filled in by inference.
