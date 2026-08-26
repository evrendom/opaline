CREATE TABLE "ingest_rate_limit_counter" (
	"limiter_key" text PRIMARY KEY NOT NULL,
	"api_key_id" text,
	"user_id" text,
	"request_window_started_at" timestamp with time zone NOT NULL,
	"request_count" bigint NOT NULL,
	"byte_window_started_at" timestamp with time zone NOT NULL,
	"byte_count" bigint NOT NULL,
	"last_request_allowed" boolean NOT NULL,
	"last_byte_allowed" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_rate_limit_counter_api_key_id_unique" UNIQUE("api_key_id"),
	CONSTRAINT "ingest_rate_limit_counter_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "ingest_rate_limit_counter_api_key_id_apikey_id_fk"
		FOREIGN KEY ("api_key_id") REFERENCES "apikey"("id") ON DELETE CASCADE,
	CONSTRAINT "ingest_rate_limit_counter_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
	CONSTRAINT "ingest_rate_limit_counter_subject_check"
		CHECK (
			("api_key_id" IS NOT NULL AND "user_id" IS NULL)
			OR ("api_key_id" IS NULL AND "user_id" IS NOT NULL)
		),
	CONSTRAINT "ingest_rate_limit_counter_value_check"
		CHECK ("request_count" >= 0 AND "byte_count" >= 0),
	CONSTRAINT "ingest_rate_limit_counter_decision_check"
		CHECK ("last_byte_allowed" = false OR "last_request_allowed" = true)
);
