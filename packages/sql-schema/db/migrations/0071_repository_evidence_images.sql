-- Sessions' images: evidence objects of kind image (raw screenshot and pasted
-- image bytes) and each capture's image rows, staged with the capture and
-- published to rudel.session_images with its index row. Online-safe: the kind
-- check is swapped NOT VALID under a short lock wait (no scan while ACCESS
-- EXCLUSIVE is held); `bun run migrate` validates it afterwards under SHARE
-- UPDATE EXCLUSIVE (src/post-migrate.ts). Every existing row satisfies the
-- wider list.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "repository_evidence_capture" ADD COLUMN "images" jsonb;--> statement-breakpoint
ALTER TABLE "repository_evidence_object"
	DROP CONSTRAINT "repository_evidence_object_kind_check",
	ADD CONSTRAINT "repository_evidence_object_kind_check"
		CHECK ("repository_evidence_object"."kind" IN ('context-manifest', 'source-blob', 'git-diff', 'transcript-chunk', 'ci-metadata', 'ci-log', 'image')) NOT VALID;
