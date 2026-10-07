# Analysis reads literal facts, not our interpretations

Agents that analyse sessions (the plugin, the CLI, scheduled jobs) read a deterministic layer we call L1: what the transcripts, usage and GitHub actually recorded, normalized across Claude Code and Codex, and nothing we inferred about it. L1 keeps every fact the raw transcripts carry, so the agent decides at query time what to look for. Interpretations (labels, scores, buckets, archetypes) are retired from L1 and from the analysis interface; named signals come back later only when the analysis log shows the same query recurring in answers people kept.

We chose this because every interpretation we shipped was a guess about what matters, and the bad ones did double damage: they hid the facts underneath and returned confident wrong answers (`has_commit` is any SHA at upload, Codex `used_plan_mode` is always 0, `success_score` is a formula nobody validated). Literal facts can be checked against the exact record that produced them, replayed from raw when the parser improves, and combined in ways nobody planned.

## Considered Options

- Signal catalogue now: name the patterns (denied calls, shell file edits, pushes without a CI check) and expose only those. Rejected for now: we do not yet know which signals are right, and a wrong one is worse than none.
- Raw JSONL or free SQL for the agent: rejected; raw fields differ between agents and versions, and free SQL is not a lookup input.

## Consequences

- Normalizing names across agents is not interpretation: `denial_kind = 'permission-rule'` stays the transcript's literal value under one column name for both agents.
- Every fact records which agent and agent version produced it, so a missing value can be told apart from a version that never emits the field. Unknown is never stored as false or zero.
- The analysis interface stays narrow: a few literal views (`calls`, `runs`, `prompts`) behind `find` with filters and grouping on their columns, a schema reference with each column's meaning and traps, and premade queries in the skill. New facts add columns and enum values, not tools or parameters.
- Facts are added by bumping the transcript-records parser and backfilling from raw transcripts, which are kept for 365 days.
- Retired interpretations are removed in order: stop reading, stop writing, then drop storage. The spec is `docs/l1-literal-schema.md`.
