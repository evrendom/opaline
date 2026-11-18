# Codex absence review, 0.162.0

Writer checked offline: public Codex `rust-v0.162.0`, commit
`c1382380de69521303b416720a52f42d51af6248`. The pinned source oracle and local
writer were checked for **all 35 Codex `not_found` mappings**, including the
pending session title. The per-mapping bounded search, relevant declarations,
snapshot candidates and conclusion are committed in
`codex-absence-0.162.0.json`. No Rust build or production access is involved.

## Two upgrades

| Fact | Writer proof | Why nearby fields do not substitute |
|---|---|---|
| `runs/compact_trigger` | `codex-rs/rollout/src/policy.rs:98` excludes `ResponseItem::CompactionTrigger`; `history/src/lib.rs:287`, `core/src/compact.rs:69` and `protocol/src/items.rs:509` define persisted checkpoints without the automatic/manual cause. | `core/src/responses_metadata.rs:122` describes outgoing request metadata, not a rollout item. `resume_metadata.turn_attribution.turn_trigger` is a turn trigger, not the compaction cause. |
| `prompts/queue_operation` | `codex-rs/rollout/src/policy.rs:162` excludes `ThreadQueueChanged`; `protocol/src/protocol.rs:4145` only carries a thread id. | `history/src/lib.rs:111` explicitly distinguishes acceptance/delivery order from queued input recording. An ordering counter is not queued/delivered/removed lifecycle data. |

These `not_emitted` proofs concern the literal durable fields in **0.162.0**,
not every historical writer version, unrelated tool text or an interpretation
of the UI. Historical census searches are retained. Judge round 2 separately
proved approved permission prompts non-durable at
`codex-rs/rollout/src/policy.rs:195` (also lines 196 and 199).

## The other 33 remain `not_found`

Absence from a finite schema or this local corpus is not proof that no writer
path, opaque metadata or tool-defined output can ever carry the meaning.
The audit explicitly checks nearby candidates instead of substituting values
of another unit or scope:

- Calls: return-code interpretation, timeout result, background request,
  no-output flag, persisted-output size/path, context-exclusion flag, shell
  edits, git operation, skill attribution, user modification, stale reads,
  search match counts, subagent totals, per-call branch and wire input.
  `CommandExecutionItem`, `ExecCommandArgs` and `FunctionCallOutputItem` were
  checked; outputs remain tool-defined. A requested timeout is not a timeout
  outcome, and a session branch is not a per-call branch.
- Runs: permission/automatic/mode configuration, advisor model, server-tool
  counts, cache-miss reason, stop reason, hook stop/errors/runs/prevention,
  retries and fallback model. Turn/session settings, usage and hook fragments
  were checked. `HookPromptFragment.hook_run_id` alone supplies neither the
  command nor duration. `ModelReroute` is transient but its high-risk routing
  semantics do not by themselves prove absence of every post-refusal fallback
  convention.
- Prompts/session: user-edited path, slash command, cost ledger and title.
  Prompt text is not an explicit edit/command-origin marker; tokens are not
  currency. `state/src/model/thread_metadata.rs:165` stores a title outside
  rollouts, so a missing rollout title is not product-wide non-emission.

The catalog includes the review references, keeps the weaker relations and
does not change parser behavior or reinterpret already stored values.
