# Analysis log

The Convex store behind `AnalysisStore`
(`apps/api/src/services/analysis-log/types.ts`, ADR 0001). Only Opaline's API
calls it; agents and browsers never do.

## Access

Every public function is built with `apiQuery`, `apiMutation` or `apiAction`
(`functions.ts`), which reject callers whose token was not issued by the API.
The API signs a one-hour ES256 JWT with its private key
(`ANALYSIS_LOG_SIGNING_KEY`) and sends it as the `Authorization` header; Convex
verifies it against the public key in this deployment's `ANALYSIS_LOG_JWKS`
(`auth.config.ts`), including issuer and audience (`identity.ts`). No
credential travels in function arguments, and the deployment holds only the
public key. Retention and the vector-match lookup are internal functions.

Function arguments and results do carry transcript-derived evidence (query
results, findings, answers). Convex's function logs and error reports for this
deployment can include them, so treat the deployment's logs as sensitive data
for access, retention and deletion. The API never logs or persists Convex
error text: the store reports only the failed function and the error class,
and its HTTP client logs nothing.

The API still decides who may see what (`analysis-log.service.ts`); Convex
enforces that queries, steps and embeddings belong to their analysis's
workspace and author, and that record ids are unique.

## Data

Application ids (`a_…`, `s_…`, `q_…`) are indexed fields; Convex ids never
leave this folder. Query arguments and results are JSON strings, so any keys
survive. Results live in `queryOutputs` and the sessions a query read in
`querySessions` (one row each, indexed by owner), apart from their queries, so
listing an analysis reads neither. Embeddings have 1536 dimensions and record
their model; vector search filters by workspace and model (joined in `space`,
since vector filters only test equality) and returns at most 256 matches,
best first. The API uses only OpenAI vectors with this store; a model change
leaves older vectors unmatched until they are embedded again.

## Size limits

Convex reads at most 16 MiB and returns at most 8,192 array elements per
call, and a document holds at most 1 MiB. The API keeps every stored record
far inside that: a find or read result is at most 256 KiB of JSON, query
arguments at most 32 KiB, and an analysis at most 200 queries and 200 steps,
so listing one analysis's queries or steps reads under 7 MiB. `queries:create`
and `steps:create` check and advance the analysis's `queryCount` and
`stepCount` in the same transaction (`limits.ts`), so concurrent writers cannot
pass the ceiling; a full analysis rejects with `analysisFull` ConvexError
data. Everything that
walks data of unbounded size (deletion, owner evidence, retention, recent
analyses, vector matches) stops once a transaction has used half of any limit
(`hasHeadroom` in `functions.ts`) and continues in the next call; the other
half covers the document in hand and its related reads.

## Deletion and retention

`deletion:byAuthor` and `deletion:byWorkspace` each delete until half the
transaction is used and report whether anything remains. An analysis is first
marked deleting, which hides it and blocks writes to it, and is removed once
its children are gone. Every call continues where the last stopped.

Deleting an account also deletes every analysis, of any author or workspace,
that read one of its sessions (ADR 0001); nothing is redacted line by line.
`deletion:markReadingOwner` follows the owner's `queryOwners` rows (one per
member whose sessions a query read, whether or not its result names any of
them, as grouped finds do not) and marks each analysis deleting, so all of them are hidden and refuse writes at once, then
`deletion:sweep` deletes the marked analyses with their children. Both stop at
half a transaction and continue on the next call. The purge's follow-up pass
runs the same again and catches analyses that read the owner's sessions while
the first pass ran. `analyses:save` writes findings, clarification steps and
the analysis in one transaction, so a refused save writes nothing.

A daily cron (03:00 UTC) expires results older than 90 days, or a year in
shared or pinned analyses, mirroring the service's read-time check. It scans
only queries that still hold a result, 32 per transaction, and repeats a page
it could not finish; expired results have left the index by then.

## Deployment

No generated code is needed: functions use the generic builders and typed
references. Use the installed CLI and a cloud deployment (no local backend).

```sh
# Creates the deployment; its first push stops until ANALYSIS_LOG_JWKS is set.
bun run convex:dev --configure new --dev-deployment cloud --once --codegen disable
bun run --cwd apps/api analysis-log:keys   # prints both values; keep the private key secret
bun run convex env set ANALYSIS_LOG_JWKS '<the data: value>'
bun run convex:dev --once --codegen disable
```

Give the API `ANALYSIS_LOG_PURGE_BACKENDS=convex`, `ANALYSIS_LOG_STORE=convex`,
`CONVEX_URL`, `ANALYSIS_LOG_SIGNING_KEY`, `OPENAI_API_KEY` and
`ANALYSIS_LOG_WORKSPACES` (the team's workspace ids; nobody else is captured or
sees history). Capture into Convex starts only once `convex` is declared in
`ANALYSIS_LOG_PURGE_BACKENDS`.
Account and workspace purges clean the deployment whenever `CONVEX_URL` is
set, even with capture off, and fail (the durable job retries) while `convex`
is declared without `CONVEX_URL`, or the signing key is invalid. A purge runs
under one 60-second deadline, HTTP requests included, and the durable purge
job retries what is left.

To decommission the deployment, stop capture (unset `ANALYSIS_LOG_STORE`),
wait until no purge job or follow-up is pending, delete or export the
deployment's data, and only then remove `convex` from
`ANALYSIS_LOG_PURGE_BACKENDS` and unset `CONVEX_URL` and the key. Removing the
declaration while the deployment still holds analyses lets purges skip them.

To rotate, create a new pair and set both sides.
Run `bun run test:analysis-convex` from the root with `CONVEX_URL` and
`ANALYSIS_LOG_SIGNING_KEY` exported. Use only developer data until the ADR's
region, DPA and subprocessor review are done.
