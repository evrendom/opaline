# Usage-event receipt attestation v3

The receipt checksum is the lowercase SHA-256 hex digest of the UTF-8 bytes of
`JSON.stringify(payload)`, with no whitespace added.

`payload` is an array sorted by the UTF-8 byte order of `eventId`. Each entry is
this positional tuple:

```text
[
  "usage-attestation:v3",
  eventId,
  identityKind,
  usageDate,
  rawModel,
  resolvedModel,
  modelProvider,
  serviceTier,
  inferenceSpeed,
  inferenceGeo,
  contextInputTokens,
  uncachedInputTokens,
  cacheReadInputTokens,
  cacheWrite5mInputTokens,
  cacheWrite1hInputTokens,
  cacheWriteInputTokens,
  recordedCacheWrite5mInputTokens,
  recordedCacheWrite1hInputTokens,
  outputTokens,
  reasoningOutputTokens
]
```

`usageDate` is either the `YYYY-MM-DD` UTC date or JSON `null`. Strings are not
case-normalized. Recorded cache-write values may be JSON `null` (not recorded), distinct from a recorded zero; other token values are nonnegative safe integers. Extraction version is 5; identity version remains 1.

The payload includes every persisted value that can select a published rate.
It deliberately excludes non-pricing extraction metadata: `modelStatus`, line
numbers, duplicate-observation counts, agent/lineage fields, token-source
labels, diagnostics, and quality flags. Changes to those fields do not change
the attestation; changes to identity, either model value, date, pricing
provenance, or any attested token class do.

## Canonical hash primitive

All event and lineage IDs are lowercase SHA-256. For an ordered list of string
parts, hash the UTF-8 bytes of each part followed by one NUL byte (`0x00`),
including after the final part. Identity version `I` supplies the literal
prefixes `usage-event:vI`, `usage-receipt:vI`, `claude-lineage:vI`, and
`codex-lineage:vI`. Extraction-version changes do not change these IDs.

The event envelope is:

```text
sha256NulParts([
  "usage-event:vI",
  source,
  organizationId,
  userId,
  sessionId,
  identityKind,
  identityValue
])
```

`userId` is the authenticated server-side user ID, never a client-supplied
claim. For a personal-workspace upload, `organizationId` is also that user ID.
For an explicitly selected organization it is the server's membership-checked
organization ID. A CLI must use that resolved identity envelope; it must not
trust arbitrary transcript fields for either value.

The per-session receipt ID uses the same envelope without an identity kind or
value:

```text
sha256NulParts([
  "usage-receipt:vI",
  source,
  organizationId,
  userId,
  sessionId
])
```

## Claude derivation

Only assistant records with a provider `message.usage` object are candidates.
The identity kind and value are selected in this order:

1. `message_id` from non-empty `message.id`;
2. `request_id` from non-empty top-level `requestId`;
3. `uuid` from non-empty top-level `uuid`;
4. `record_sha256` from SHA-256 of the trimmed raw JSON-line bytes.

Candidates with the same `(identityKind, identityValue)` merge into one event.
Each token field uses the final/last preferred snapshot, never fieldwise maxima. Main-chain snapshots are preferred over duplicated subagent copies. This handles streaming
partials without adding them. Main-chain metadata is preferred over sidechain
or subagent metadata. A single case-insensitive model remains `rawModel` using
its authored spelling; conflicting models produce an empty `rawModel` and stay
unpriced.

Claude token algebra is:

```text
uncachedInputTokens = usage.input_tokens
cacheReadInputTokens = usage.cache_read_input_tokens ?? 0
nested5m = usage.cache_creation.ephemeral_5m_input_tokens ?? 0
nested1h = usage.cache_creation.ephemeral_1h_input_tokens ?? 0
flatWrite = usage.cache_creation_input_tokens ?? 0
cacheWrite5mInputTokens = nested5m + max(0, flatWrite - nested5m - nested1h)
cacheWrite1hInputTokens = nested1h
outputTokens = usage.output_tokens
reasoningOutputTokens = usage.output_tokens_details.thinking_tokens ?? 0
contextInputTokens = uncachedInputTokens + cacheReadInputTokens
  + cacheWrite5mInputTokens + cacheWrite1hInputTokens
```

The legacy numeric cache TTL values above remain pricing compatibility projections. `recordedCacheWrite5mInputTokens` and `recordedCacheWrite1hInputTokens` preserve only explicitly written nested counters (null when absent); `cacheWriteInputTokens` preserves the written unbucketed total (null when absent). The additive nullable storage columns carry these literal values. A flat total does not become a recorded five-minute TTL counter.

`modelProvider` is empty for native Claude response records because Claude
Code does not emit a separate first-party provider field in this shape.
`inferenceGeo` and `inferenceSpeed` come from `message.usage.inference_geo`
and `message.usage.speed`. Unknown values are quarantined by a quality flag
and do not inherit a published rate.

## Codex derivation

A Codex vector is the ordered tuple `(input_tokens, cached_input_tokens,
output_tokens, reasoning_output_tokens)`, with absent or invalid optional
reasoning treated as zero and diagnosed. For each token-count record with total
vector `T` and last-increment vector `L`, the baseline is `B = T - L`. A
transition is identified by `(B, T)` and emitted once; repeated telemetry for
the same transition does not add tokens. A zero `L` is a no-op. Multiple
outgoing totals from one baseline remain distinct. Missing-last fallback is
only emitted when exactly one compatible known baseline exists and remains
explicitly flagged as unverified.

For `vectorKey(V)`, join the four base-10 integers with `:`. The Codex identity
is:

```text
identityKind = "transition"
identityValue = vectorKey(B) + NUL + vectorKey(T)
```

Codex token algebra for the increment `L` is:

```text
uncachedInputTokens = L.input_tokens - L.cached_input_tokens
cacheReadInputTokens = L.cached_input_tokens
cacheWrite5mInputTokens = null
cacheWrite1hInputTokens = null
cacheWriteInputTokens = null
outputTokens = L.output_tokens
reasoningOutputTokens = L.reasoning_output_tokens
contextInputTokens = T.input_tokens
```

`rawModel` is the most recent non-synthetic `turn_context.payload.model` at
the telemetry line. `modelProvider` comes from
`session_meta.payload.model_provider`, and `serviceTier` comes from the token
count if explicitly recorded, otherwise the configured turn/thread tier with `service_tier_configured` provenance. Analysis prices such an event at the configured tier (the only tier Codex logs); the flag is the explicit price basis and a recorded response tier always wins. Duplicate observations may fill previously missing metadata. When a
later duplicate disagrees, the earliest non-empty model remains authoritative
and the conflict is diagnosed instead of erasing that observation.

## Modern Codex request records

When the transcript contains `token_usage_record`, extraction uses its `payload.usage` vector, one event per literal `response_id`, retaining the final snapshot for duplicates. The identity kind is `response_id`; identity value is the literal response ID. `turn_token_usage` and `thread_token_usage` are cumulative context, not additional billable responses, and token-count telemetry is not added again. Explicit exclusive fork ordinals suppress inherited requests. `cache_write_input_tokens` is recorded if present, otherwise null; no cache TTL split is manufactured. A configured turn/thread tier is flagged `service_tier_configured`.

## Date and checksum delivery

A timestamp is valid only when it is an ISO-8601 date-time carrying `Z` or an
explicit numeric offset. It is converted to UTC; `usageDate` is the first ten
characters of that UTC timestamp. Invalid or absent timestamps produce JSON
`null` and leave the event unpriceable even when its canonical model identity
is known. Claude duplicate metadata follows the main-chain preference above;
Codex uses the transition observation.

After a successful extraction and receipt compare-and-set, the ingest response
returns the server checksum as optional `usageChecksum`. The CLI validates it
as 64 lowercase hexadecimal characters and exposes it on `UploadResult`. Its
absence remains valid for older servers and for the operational extraction
bypass. This response field is the transport for the future independent
client-side checksum comparison; Postgres is not the client interface.

## Accepted truncation disclosure

A JSON line truncated before any usage-bearing key is deliberately nonfatal:
it is reported in diagnostics but does not make `receipt.complete` false. A
line containing usage-bearing keys that is malformed or contradictory is
fatal and produces an incomplete receipt. Therefore `complete` means no known
billable ambiguity was encountered; it does not claim that the transcript
writer had closed the file.
