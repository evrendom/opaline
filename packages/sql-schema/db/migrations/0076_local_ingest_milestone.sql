CREATE TABLE "local_ingest_milestone" (
	"name" text PRIMARY KEY NOT NULL,
	"reached_at" timestamp with time zone DEFAULT now() NOT NULL
);
