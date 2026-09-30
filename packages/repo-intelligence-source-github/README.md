# GitHub repository-intelligence source

`@rudel/repo-intelligence-source-github` is Opaline's bounded, read-only GitHub
REST data source. The client issues only `GET` requests and accepts credentials
through the redacting `createGitHubAuthorization` wrapper. Callers remain
responsible for supplying a token with the minimum permissions required for the
datasets they request.

The source covers repository identity, exact commits,
commit-to-pull-request links, exact pull requests, files, reviews and comments,
checks, commit statuses, Actions runs/jobs/artifacts, and exact Git trees and
blobs. The surface is intentionally limited to evidence needed for
session-linked repository and CI outcomes. Governance, security, deployment,
and repository-wide issue datasets are deferred.

Content collection inventories paths at an exact commit and negotiates bodies
by Git object ID. Identical OIDs are fetched once even when several paths refer
to them. Dependency trees are metadata-only unless an exact related path or OID
is requested. Credential-shaped paths such as `.env`, auth dotfiles, private
keys, and credential JSON remain metadata-only even when explicitly selected;
safe `.env.example`, `.env.sample`, and `.env.template` files remain eligible.
Binary, oversized, capped, permission-gated, and upstream truncated results
remain visible through coverage reasons.

Actions jobs are requested with all rerun attempts instead of GitHub's default
latest-attempt view. Job logs are fetched as bounded text through GitHub's redirecting log
endpoint. A response larger than the caller's cap returns only the bounded
prefix with partial coverage. The transport follows redirects with a fixed hop
limit, rejects HTTPS-to-HTTP downgrades, and strips authorization and GitHub
API-version headers before any cross-origin request. The raw-log transport is
never conditionally cached.

All provider text is sensitive evidence: logs, pull-request and issue bodies,
comments, patches, commit messages, and repository file content can contain
credentials or other secrets. Callers must run Opaline's secret filter before
persisting any provider text. This package does not persist source results.

The transport supports opaque pagination cursors, ETag validation, bounded
response bodies, retry and rate-limit handling, runtime validation, and safe
403/404 unavailable states. Reported transfer bytes are retained successful
response-body bytes (the bounded prefix for a truncated log); they exclude
headers, cached bodies, discarded retry/error bodies, and log bytes beyond the
caller's cap.

Webhook ingestion is deferred. Opaline uses bounded polling and explicit
refresh for session-linked entities.

## Opaline collection lifecycle

The API reserves collection attempts in Postgres before acknowledging session
captures. The daily Vercel maintenance invocation drains five-attempt batches
for up to 260 seconds. Unfinished work remains in the durable collection queue;
it does not depend on a timer running after the HTTP response.

Session-linked observations with no PR, an open PR, incomplete enumeration, or
unfinished CI schedule daily refreshes independently of transport retries.
Refreshes preserve the first observation timestamp and stop after 14 days or
when the observed PR and CI outcomes are terminal. Account deletion cancels
queued/in-flight work and clears personal session attribution transactionally,
while keeping workspace-owned repository facts. Completion checks both account
and workspace deletion fences.

Each collection shares a 256 MiB byte budget across metadata and logs, including
a 16 MiB metadata budget, 20,000 metadata/log items, and 1,000 pages. Metadata
items larger than the chunk limit are omitted rather than retained. Exhausted
budgets produce explicit partial coverage, never definitive zero-result
analytics. The dashboard uses persisted all-pages PR completeness.

Filtered metadata is persisted incrementally in JSON chunks of at most 1 MiB.
The root `github-evidence-metadata/v2` object contains summary and coverage
receipts plus `metadataChunks` references; bulk dataset items live in those
chunks as `{ dataset, scope, items }`. Consumers must read the referenced chunks
when hydrating dataset content. Collection rows persist the same chunk receipts
in `metadata_chunks` so cleanup and workspace purge can find every object.

Every object has a durable intent before PUT. Uncommitted chunks/logs remain
discoverable after interruption, and cleanup preserves chunks referenced by a
committed collection. Workspace deletion snapshots all metadata and log keys
before cascading database rows and retains its scheduled second purge pass.
