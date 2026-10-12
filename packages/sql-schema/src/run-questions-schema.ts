import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

/**
 * Run questions (CONTEXT.md "Run question"): the catalogue Opaline manages in
 * its internal form. Each row is one wording; rewording retires the row and
 * adds a new one that `replaces` it, so answers (in ClickHouse, keyed by the
 * row id) keep the wording they answered. The catalogue names no workspace or
 * member, so no purge touches it.
 */
export const runQuestion = pgTable(
	"run_question",
	{
		id: text("id").primaryKey(),
		question: text("question").notNull(),
		state: text("state").default("draft").notNull(),
		replaces: text("replaces"),
		/** What a yes and a no look like, where the boundary is subtle; both or neither. */
		criteriaTrue: text("criteria_true"),
		criteriaFalse: text("criteria_false"),
		testedRuns: integer("tested_runs"),
		/** The provider whose test answers the tested precision judges. */
		testedProvider: text("tested_provider"),
		testedPrecision: doublePrecision("tested_precision"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		check(
			"run_question_state_check",
			sql`${table.state} IN ('draft', 'on', 'retired')`,
		),
		check(
			"run_question_criteria_check",
			sql`(${table.criteriaTrue} IS NULL) = (${table.criteriaFalse} IS NULL)`,
		),
		uniqueIndex("run_question_live_wording_idx")
			.on(table.question)
			.where(sql`${table.state} <> 'retired'`),
	],
);

/**
 * Answering work queued by run_questions or a test in the internal form,
 * answered by the run-questions cron with retries. `runs` names the sessions
 * (with their owners in `owner_ids`), so deleting a workspace or the
 * requesting account cascades, and the account purge deletes every job that
 * names the account's sessions.
 */
export const runQuestionJob = pgTable(
	"run_question_job",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestedBy: text("requested_by")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		purpose: text("purpose").notNull(),
		/** The provider that answers the job (e.g. subq, jev, subq:run). */
		provider: text("provider").notNull(),
		questionIds: text("question_ids").array().notNull(),
		runs: jsonb("runs").notNull(),
		ownerIds: text("owner_ids").array().default(sql`'{}'::text[]`).notNull(),
		status: text("status").default("queued").notNull(),
		answersRequested: integer("answers_requested").notNull(),
		costUsd: doublePrecision("cost_usd").default(0).notNull(),
		/** The provider's reported usage of the job's calls, to reconcile its invoices. */
		inputTokens: bigint("input_tokens", { mode: "number" })
			.default(0)
			.notNull(),
		outputTokens: bigint("output_tokens", { mode: "number" })
			.default(0)
			.notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		leaseToken: text("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
			mode: "date",
		}),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
	},
	(table) => [
		check(
			"run_question_job_status_check",
			sql`${table.status} IN ('queued', 'done', 'failed')`,
		),
		check(
			"run_question_job_purpose_check",
			sql`${table.purpose} IN ('analysis', 'test')`,
		),
		index("run_question_job_due_idx")
			.on(table.nextAttemptAt)
			.where(sql`${table.status} = 'queued'`),
		index("run_question_job_organization_idx").on(table.organizationId),
		index("run_question_job_requested_by_idx").on(table.requestedBy),
		index("run_question_job_owner_ids_idx").using("gin", table.ownerIds),
	],
);

/** Answers a workspace may buy per fixed window. */
export const runQuestionQuota = pgTable("run_question_quota", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	windowStartedAt: timestamp("window_started_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	answers: bigint("answers", { mode: "number" }).notNull(),
});
