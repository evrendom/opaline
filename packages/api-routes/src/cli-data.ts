import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

export const CLI_DATA_LIMITS = {
	queryChars: 20_000,
	planInputSessions: 5_000,
	planSessions: 2_000,
	tableSessions: 200,
	chunkBytes: 1024 * 1024,
	exportBytes: 256 * 1024 * 1024,
	statementSeconds: 60,
	statementMemoryBytes: 512 * 1024 * 1024,
} as const;

export const CLI_DATA_TABLES = [
	"records",
	"runs",
	"calls",
	"git",
	"edges",
	"ci_jobs",
	"setup_files",
	"setup_texts",
	"github_prs",
	"github_pr_commits",
	"github_ci_run_prs",
	"github_ci_runs",
	"github_sha_candidates",
	"github_repositories",
] as const;

export type CliDataTable = (typeof CLI_DATA_TABLES)[number];

export const CLI_DATA_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const PATTERN_ID = /^[a-z]{2}_[0-9a-f]{10}$/u;

const WorkspaceSchema = z.string().trim().min(1).max(200).optional();
const SessionIdSchema = z
	.string()
	.regex(CLI_DATA_SESSION_ID, "not a session id");
const DaySchema = z
	.string()
	.regex(DAY, "must be a UTC day, YYYY-MM-DD")
	.refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00Z`)), {
		message: "must be a real day",
	});

const uniqueSessions = (sessions: readonly string[]) =>
	new Set(sessions).size === sessions.length;

export const DataChunkSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("lines"), text: z.string() }),
	z.object({
		type: z.literal("done"),
		rows: z.number().int().nonnegative(),
		bytes: z.number().int().nonnegative(),
		columns: z.array(z.string()),
		notices: z.array(z.string()),
	}),
]);
export type DataChunk = z.infer<typeof DataChunkSchema>;

export const CliDataSqlInputSchema = z.object({
	workspace: WorkspaceSchema,
	query: z.string().trim().min(1).max(CLI_DATA_LIMITS.queryChars),
	format: z.enum(["jsonl", "csv"]),
});
export type CliDataSqlInput = z.infer<typeof CliDataSqlInputSchema>;

export const CliDataPullPlanInputSchema = z
	.object({
		workspace: WorkspaceSchema,
		repository: z.string().trim().min(1).max(300).optional(),
		from: DaySchema.optional(),
		to: DaySchema.optional(),
		sessions: z
			.array(SessionIdSchema)
			.min(1)
			.max(CLI_DATA_LIMITS.planInputSessions)
			.refine(uniqueSessions, { message: "Session ids must be unique" })
			.optional(),
		pattern: z
			.string()
			.regex(
				PATTERN_ID,
				"takes a pattern id from the patterns tool, e.g. fc_1a2b3c4d5e",
			)
			.optional(),
	})
	.refine(
		(input) =>
			input.repository !== undefined ||
			input.from !== undefined ||
			input.to !== undefined ||
			input.sessions !== undefined ||
			input.pattern !== undefined,
		{
			message: "Name sessions, a repository, from/to or a pattern to pull",
		},
	)
	.refine(
		(input) =>
			input.from === undefined ||
			input.to === undefined ||
			input.from <= input.to,
		{ message: "from is after to", path: ["from"] },
	);
export type CliDataPullPlanInput = z.infer<typeof CliDataPullPlanInputSchema>;

export const CliDataPlanSessionSchema = z.object({
	sessionId: z.string(),
	source: z.string(),
	startedAt: z.string(),
	records: z.number().int().nonnegative(),
	bytes: z.number().int().nonnegative(),
});

export const CliDataPullPlanOutputSchema = z.object({
	workspace: z.object({ id: z.string(), slug: z.string() }),
	scope: z.object({
		repository: z.string().nullable(),
		from: z.string().nullable(),
		to: z.string().nullable(),
	}),
	sessions: z.array(CliDataPlanSessionSchema),
	pattern: z.unknown().nullable(),
	notices: z.array(z.string()),
});
export type CliDataPullPlanOutput = z.infer<typeof CliDataPullPlanOutputSchema>;

export const CliDataPullTableInputSchema = z.object({
	workspace: WorkspaceSchema,
	table: z.enum(CLI_DATA_TABLES),
	sessions: z
		.array(SessionIdSchema)
		.min(1)
		.max(CLI_DATA_LIMITS.tableSessions)
		.refine(uniqueSessions, { message: "Session ids must be unique" }),
});
export type CliDataPullTableInput = z.infer<typeof CliDataPullTableInputSchema>;

export const CLI_DATA_ERROR_CODES = {
	exportTooLarge: "EXPORT_TOO_LARGE",
	pullTooLarge: "PULL_TOO_LARGE",
	patternNotFound: "PATTERN_NOT_FOUND",
	quotaExceeded: "QUOTA_EXCEEDED",
	busy: "BUSY",
} as const;

export const CliDataErrors = {
	[CLI_DATA_ERROR_CODES.exportTooLarge]: {
		status: 413,
		message: "The export is larger than the server sends in one call.",
		data: z.object({ maxBytes: z.number() }),
	},
	[CLI_DATA_ERROR_CODES.pullTooLarge]: {
		status: 413,
		message: "The pull selects more sessions than one pull takes.",
		data: z.object({ sessions: z.number(), maxSessions: z.number() }),
	},
	[CLI_DATA_ERROR_CODES.patternNotFound]: {
		status: 404,
		message: "The pattern has no runs in this scope.",
		data: z.object({
			pattern: z.string(),
			from: z.string(),
			to: z.string(),
		}),
	},
	[CLI_DATA_ERROR_CODES.quotaExceeded]: {
		status: 429,
		message: "The workspace used its SQL quota.",
		data: z.object({ resetsAt: z.string() }),
	},
	[CLI_DATA_ERROR_CODES.busy]: {
		status: 503,
		message: "The analysis service is busy; retry in a moment.",
	},
} as const;

export const cliDataContract = {
	sql: oc
		.input(CliDataSqlInputSchema)
		.output(eventIterator(DataChunkSchema))
		.errors(CliDataErrors),
	pullPlan: oc
		.input(CliDataPullPlanInputSchema)
		.output(CliDataPullPlanOutputSchema)
		.errors(CliDataErrors),
	pullTable: oc
		.input(CliDataPullTableInputSchema)
		.output(eventIterator(DataChunkSchema))
		.errors(CliDataErrors),
};
