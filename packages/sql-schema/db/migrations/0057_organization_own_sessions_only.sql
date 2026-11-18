-- Own sessions only, admins all (ADR 0004): off for every workspace, so
-- every member reads every member's sessions. A constant default makes the
-- column a catalog-only change; the short lock wait keeps a busy organization
-- table from queueing requests behind it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "own_sessions_only" boolean DEFAULT false NOT NULL;
