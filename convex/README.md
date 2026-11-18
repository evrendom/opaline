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
best first. Chats uploaded for an analysis (`opaline import --analysis`) are
`analysisSessions` rows, one per analysis, source and session, at most 200 per
analysis (`sessions:link` checks the count in the same transaction). The API uses only OpenAI vectors with this store; a model change
leaves older vectors unmatched until they are embedded again.

## Drafts and append-only saves

The API's `find` and `read` calls build an analysis with `draft: true`. A
draft is returned only by `analyses:get` (the API checks that its author is
asking, for find/read/save) and `analyses:latestOpen` (no longer called
by the API: a find or read without an analysis id starts a new draft; it
can be removed with the next Convex deploy); `analyses:recent`,
`analyses:updatedBy` and the vector-match lookup leave drafts out, and the API
treats them as not found everywhere else. `analyses:save` publishes a draft
(sets `draft: false` and `status: "finished"`) in the same transaction that
writes its findings. Saving is append-only: `analyses:save`, `steps:create`
and `queries:create` refuse a finished analysis with `analysisSaved`
ConvexError data, so a saved analysis never changes. A revision is a new
analysis whose `updates` names the earlier one (`by_workspace_updates`), with
its per-finding `changes` (each naming the step it covers; the API checks
that every finding has exactly one before saving). Analyses recorded before drafts have no `draft` or
`changes` field and read as not drafts with no changes, so they keep their
visibility; no migration is needed.

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
with a query that read its sessions and returned text from them, or whose
step's finding sits on a result naming one of its sessions, and removes the
result of every other query that only counted its sessions (ADR 0001 as
amended); nothing is redacted line by line. The API classifies each query
when it records it: `counts` is true only when the result returned nothing
but numbers and ids, and `redaction` holds the arguments and step label to
keep once the result is removed (without arguments that may carry
transcript text). `deletion:removeOwnerEvidence` follows the owner's
`queryOwners` rows (one per member whose sessions a query read, whether or
not its result names any of them, as grouped finds do not). For a query
without `counts` (queries recorded before it included), or with a finding on
its step and one of the owner's sessions in its `querySessions`, it marks the
analysis deleting, so all of them are hidden and refuse writes at once; for
any other query it deletes the query's `queryOutputs` row and the owner's
`querySessions` rows, sets `removed`, and applies its `redaction` (the query
stays, so it can be rerun, and the analysis stays). Then `deletion:sweep`
deletes the marked analyses with their children. Both stop at half a
transaction and continue on the next call. The purge's follow-up pass runs
the same again and catches analyses that read the owner's sessions while the first pass ran. `analyses:save` writes findings, clarification steps and
the analysis in one transaction, so a refused save writes nothing.
`deletion:markReadingOwner` is the rule before the amendment (every analysis
that read the owner's sessions is marked deleting), kept unchanged for an
API deployed before `removeOwnerEvidence`; remove it once no such API runs.

Deleting an analysis deletes its `analysisSessions` rows; deleting an account
also runs `deletion:sessionsByOwner`, which removes that member's chats from
other members' analyses and keeps the analyses.

`analyses:setShared` shares or unshares an analysis and advances its
`visibilityRevision` in the same transaction (`analyses:update` advances it
too when it sets `shared`). The API copies visibility to its finding impact
rows in ClickHouse with that revision, and the rows keep the highest
revision's visibility, so writes landing out of order cannot leave an
unshared analysis readable.

A daily cron (03:00 UTC) expires results older than 90 days, or a year in
shared or pinned analyses, mirroring the service's read-time check. It scans
only queries that still hold a result, 32 per transaction, and repeats a page
it could not finish; expired results have left the index by then.

A second daily cron at the same time (`retention:expireDraftsDaily`) deletes
drafts started more than 7 days ago, with all their children, through
`by_draft_created` and the same bounded deletion as `deletion:byAuthor`; it
reschedules itself until none is left. Saved analyses never match. The API
treats an older draft as gone before the cron reaches it. Account and
workspace purges delete drafts like any other analysis.

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
`ANALYSIS_LOG_WORKSPACES` (the team's workspace ids, or `*` for every workspace;
nobody else is captured or sees history). Capture into Convex starts only once
`convex` is declared in `ANALYSIS_LOG_PURGE_BACKENDS`.
Account and workspace purges clean the deployment whenever `CONVEX_URL` is
set, even with capture off, and fail (the durable job retries) while `convex`
is declared without `CONVEX_URL`, or the signing key is invalid. A purge runs
under one 60-second deadline, HTTP requests included, and the durable purge
job retries what is left.

To ship changed functions, schema or crons to an existing deployment, deploy
Convex before the API that depends on them (new fields are optional, so the
running API keeps working against the new functions):

```sh
CONVEX_DEPLOY_KEY='<the deployment key>' bun run convex:deploy --codegen disable
```

No CI job deploys Convex; this is a manual step. Convex builds new indexes
during the push, and the cron schedule comes from `crons.ts`.

To decommission the deployment, stop capture (unset `ANALYSIS_LOG_STORE`),
wait until no purge job or follow-up is pending, delete or export the
deployment's data, and only then remove `convex` from
`ANALYSIS_LOG_PURGE_BACKENDS` and unset `CONVEX_URL` and the key. Removing the
declaration while the deployment still holds analyses lets purges skip them.

To rotate, create a new pair and set both sides.
Run `bun run test:analysis-convex` from the root with `CONVEX_URL` and
`ANALYSIS_LOG_SIGNING_KEY` exported. Use only developer data until the ADR's
region, DPA and subprocessor review are done.
