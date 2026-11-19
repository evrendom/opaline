import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

// Moment observations (apps/desktop/server/src/services/moments/): a model's note about
// one moment of a run, written when a member asks for it. The note is derived
// from the session owner's transcript, so it goes with that member's account
// and with the workspace. One per moment, transcript revision and prompt
// version; readers take the newest.
export const momentObservation = pgTable(
	"moment_observation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The session owner. */
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		agentId: text("agent_id").notNull(),
		turnIdx: integer("turn_idx").notNull(),
		kind: text("kind").notNull(),
		/** The run index revision the span was read at (UInt64 as text). */
		revision: text("revision").notNull(),
		/** When the run started, for patterns' weeks and ranges. */
		runStartedAt: timestamp("run_started_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		spanStart: integer("span_start").notNull(),
		spanEnd: integer("span_end").notNull(),
		layer: text("layer").notNull(),
		whatHappened: text("what_happened").notNull(),
		lesson: text("lesson").notNull(),
		/** [{ record, quote }] */
		evidence: jsonb("evidence").notNull(),
		confidence: real("confidence").notNull(),
		falsePositive: boolean("false_positive").notNull(),
		model: text("model").notNull(),
		promptVersion: integer("prompt_version").notNull(),
		inputTokens: integer("input_tokens").notNull(),
		outputTokens: integer("output_tokens").notNull(),
		/** Who asked for it; null once their account is deleted. */
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("moment_observation_moment_unique").on(
			table.organizationId,
			table.userId,
			table.sessionId,
			table.agentId,
			table.turnIdx,
			table.kind,
			table.revision,
			table.promptVersion,
		),
		index("moment_observation_organization_created_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("moment_observation_organization_run_started_idx").on(
			table.organizationId,
			table.runStartedAt,
		),
		index("moment_observation_user_id_idx").on(table.userId),
	],
);

// A member's vote on whether an observation helped them.
export const momentFeedback = pgTable(
	"moment_feedback",
	{
		observationId: text("observation_id")
			.notNull()
			.references(() => momentObservation.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		useful: boolean("useful").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.observationId, table.userId] }),
		index("moment_feedback_user_id_idx").on(table.userId),
	],
);

// A fix a member recorded against a pattern: the change they made (a
// pointer, a check, a standard, a habit) and the pattern's term profile, so
// later observations that match it count as "after".
export const momentFix = pgTable(
	"moment_fix",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		layer: text("layer").notNull(),
		note: text("note").notNull(),
		/** The pattern's central observation when the fix was recorded. */
		patternObservationId: text("pattern_observation_id").notNull(),
		/** { term: weight } of the pattern's centroid. */
		centroid: jsonb("centroid").notNull(),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("moment_fix_organization_id_idx").on(table.organizationId)],
);

// A workspace's Compass flags: each on or off, with its value
// (`CompassSettings` in @rudel/api-routes). No row means every flag on at its
// default; flags added later start on at their defaults.
export const compassSettings = pgTable("compass_settings", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	settings: jsonb("settings").notNull(),
	updatedBy: text("updated_by").references(() => user.id, {
		onDelete: "set null",
	}),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

// SubQ's answer to "Is the user frustrated?" about the member prompt that
// followed one run (the run it flags), keyed by the prompt's text hash so a
// re-upload never asks again about a prompt it already asked about. Derived
// from the session owner's prompt, so it goes with that member's account and
// with the workspace.
export const promptFrustration = pgTable(
	"prompt_frustration",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		agentId: text("agent_id").notNull(),
		/** The run the prompt reacted to (the prompt starts the next one). */
		turnIdx: integer("turn_idx").notNull(),
		promptSha256: text("prompt_sha256").notNull(),
		/** Probability of yes, 0 to 1. */
		probability: real("probability").notNull(),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [
				table.organizationId,
				table.userId,
				table.sessionId,
				table.agentId,
				table.turnIdx,
				table.promptSha256,
			],
		}),
		index("prompt_frustration_organization_id_created_at_idx").on(
			table.organizationId,
			table.createdAt,
		),
		index("prompt_frustration_user_id_idx").on(table.userId),
	],
);
