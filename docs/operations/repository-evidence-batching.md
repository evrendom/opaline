# Repository evidence batching

The `repository_evidence_v1` contract is unchanged, including its 4,096-object
limit, multipart upload IDs, part URLs, completion ETags, and response shapes.

## Postgres

- Pending object upserts, upload references, multipart intent registration,
  upload-ID attachment, and intent release use statements of at most 1,000 rows.
- Pending upserts return the existing generation key and availability atomically;
  conflicting lengths fail even when a concurrent init created the row.
- Known-object lookup, reused-object share locks, ownership checks, and object
  publication use set-based queries, not one query per object.
- Commit locks generations in object-ID order and checks that the keys still
  match the verified objects before publishing availability.
- Resume bulk-registers missing generations and restores their upload references
  if stale pending rows were removed after expiration.
- Index preparation parses the one verified manifest locally. It does not issue
  an object-by-object database query.

## R2 and deletion

Creation, verification, resume inspection, and cleanup run in windows of 32
objects. Every window settles before an error triggers cleanup. Hash, size, and
metadata verification remain mandatory. Successfully completed multipart uploads
release their intents in bulk without redundant `AbortMultipartUpload` calls;
deduplicated but uncompleted uploads are still aborted first.

An entire creation phase is fenced and its intents committed **before** any R2
uploads are created. IDs are attached in bulk, including successful creations in
a partially failed window. A crash before attachment leaves durable null-ID
intents for discovery by the sweeper. Null-ID intents cannot identify receipt
ownership from R2's multipart listing. While a generation still has an object
row and active multipart uploads, cleanup defers these intents rather than
aborting another receipt's uploads. Deferred intents remain durable until their
own IDs are attached or the generation is removed; once removed, its key cannot
be reacquired and all remaining multipart uploads are garbage. This conservative
fallback can retain an unidentified orphan on a shared generation until that
generation is removed. The final publication transaction checks
the purge tombstone again. The existing second purge pass closes the in-flight
write race, and generation keys prevent cleanup from deleting reacquired data.

Creation has one 60-second deadline, starting before intent registration, passed
through to the S3 client's abort signal. Later windows cannot start after it.
This bounds in-flight creation below the purge follow-up grace period even if
the process crashes before the bulk upload-ID attachment.

Resume preserves live multipart IDs, but renews the plan immediately when HEAD
finds no completed object and ListParts for its upload ID returns NoSuchUpload.
Other responses and errors do not trigger renewal. Aborted or revoked uploads
therefore recover without waiting for receipt expiry, regardless of multipart
listing pagination.

Small objects still use real multipart upload IDs. Single-PUT URLs are reusable
until expiry, unlike part URLs revoked by completion/abort. A drop-in switch
would permit overwriting verified available content or recreating deleted keys
after the final purge pass. The current storage interface has no batch-create
method or single-use PUT capability, so the safe optimization is concurrent
multipart creation and avoiding abort calls for already completed uploads.

## Regression

`apps/api/src/__tests__/repository-evidence-batching.integration.ts` exercises
1,001 and 4,096 objects against real Postgres with the existing in-memory R2
fixture. The Postgres debug hook counts actual statements, including BEGIN and
COMMIT. The 1,001-object case adds 20 ms to each statement dispatch; this is a
deterministic latency budget experiment, not a measurement of production R2.
Both cases assert bounded statement counts, first upload, missing/reused splits,
rows, normal/expired resume, new generation keys, commits, and duplicate receipts.
