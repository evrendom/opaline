# Local context source

`@rudel/local-context-source` inventories a Git worktree and explicitly named
local context roots for Opaline. It emits a versioned manifest plus sorted,
content-addressed UTF-8 blobs that can be persisted as a private local spool.

Lifecycle hooks use the selective `session-evidence` profile to capture
effective instructions and configuration, Git state, and changed paths while
leaving unrelated clean tracked source as Git object references.

The default `delta` policy represents clean tracked files with the Git blob OID
and HEAD commit instead of copying their bodies. Dirty tracked, untracked,
ignored, and non-repository text is filtered with `@rudel/secret-filter` before
hashing or entering a blob. A parent capture can supply known blob IDs so an
unchanged sanitized body becomes a `reused` reference rather than another
upload candidate.

Filesystem content and Git pathspec exclusions share one credential-path policy.
This excludes `.env.example`, `.env.sample`, and `.env.template` too: even
conventionally safe templates can contain secrets in uncommitted edits.
Patches are bounded and secret-filtered; a truncated,
binary, or redacted patch is marked non-reconstructable instead of claiming it
can reproduce the original bytes.

Broad traversal never follows symlinks and excludes VCS internals, dependency
trees, build output, and caches.

Registered Git submodules are inventoried as one non-followed gitlink entry with
their index object ID and outer worktree status. Their checked-out contents are
collected only when the submodule is captured as its own repository root or is
supplied to the library as a separate authorized root.

Untracked nested Git repositories and linked worktrees identified by a `.git`
marker are traversal boundaries within the repository root. The outer scan
retains the directory entry plus a VCS exclusion record without listing
descendants. Collect a nested repository independently when its contents are
needed.
An explicitly authorized outside context root is already its own consent
boundary, so nested plugin packages remain discoverable there while their
`.git` internals stay excluded.

Collection is bounded per file, per root, and in aggregate. Binary, oversized,
high-risk credential paths, filter failures, and cap exhaustion remain in the
inventory with explicit omission reasons whenever their path was discovered.
Very large files can also omit hashes once the hash budget is exhausted.

The manifest records the non-atomic scan interval and compares initial and final
Git HEAD/status fingerprints. A mismatch marks the capture partial with a
`concurrent-change` reason. This check cannot detect every possible same-status
worktree rewrite, so consumers should treat the consistency evidence as a
diagnostic rather than a filesystem snapshot guarantee.

`manifest.contextIndex` gives each authorized root an explicit presence and
coverage result for `AGENTS.md`, `CLAUDE.md`, plans, hooks, MCP configuration,
and package manifests. `absent` is emitted only after a complete scan;
permission failures, explicit exclusions, limits, and unavailable roots remain
distinct unknown states. Indexed resources separately report readable,
Git-object-only, denied, truncated, or unavailable content access.

Skill definitions are grouped by their definition-directory name and retain all
matching paths. Discovery does not claim runtime eligibility, advertisement, or
loading. `assessContextSkillUse` can join separately collected transcript
evidence: an observed name is `observed-used`, a missing name is
`no-observed-use` only for a complete evidence scope, and missing or partial
evidence stays `unknown`.

Secret filtering covers the known patterns in `@rudel/secret-filter`; it is not
proof that arbitrary sensitive prose is absent. Credential-shaped paths are
therefore metadata-only, and the manifest keeps
`transport.requiresAdditionalReview` set to `true`. Inventory paths, root
paths, object IDs, sizes, and timestamps remain structural manifest metadata;
filenames and configured root paths are not safe places to store secrets.
