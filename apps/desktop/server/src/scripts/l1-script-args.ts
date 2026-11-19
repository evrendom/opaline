import { parseArgs } from "node:util";

/**
 * Argument parsing of the L1 operator scripts (`retire:transcript-records`,
 * `backfill:run-index`, `backfill:transcript-search`, `backfill:run-questions`,
 * `audit:l1`, and `run-questions:add`), kept free of database clients so it
 * can be tested. Every backfill is a preview unless `--execute` is given, and
 * the ones that write must name their scope: `--organization-id <id>`, or
 * `--all-organizations` to mean every workspace on purpose.
 */

export interface OrganizationScope {
	readonly organizationId: string | undefined;
}

export function parsePositiveIntegerFlag(
	value: string | undefined,
	fallback: number,
	flag: string,
	max = Number.MAX_SAFE_INTEGER,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error(`${flag} must be a positive integer.`);
	if (parsed > max) throw new Error(`${flag} must be at most ${max}.`);
	return parsed;
}

export function parseNonNegativeIntegerFlag(
	value: string | undefined,
	fallback: number,
	flag: string,
	max = Number.MAX_SAFE_INTEGER,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed))
		throw new Error(`${flag} must be a non-negative integer.`);
	if (parsed > max) throw new Error(`${flag} must be at most ${max}.`);
	return parsed;
}

/** `--organization-id <id>` or `--all-organizations`, exactly one. */
export function parseOrganizationScope(values: {
	readonly "organization-id"?: string;
	readonly "all-organizations"?: boolean;
}): OrganizationScope {
	const organizationId = values["organization-id"]?.trim();
	if (values["organization-id"] !== undefined && !organizationId)
		throw new Error("--organization-id must not be empty.");
	if (organizationId && values["all-organizations"])
		throw new Error(
			"Pass either --organization-id or --all-organizations, not both.",
		);
	if (!organizationId && !values["all-organizations"])
		throw new Error(
			"Name the scope: --organization-id <id> (recommended), or --all-organizations.",
		);
	return { organizationId: organizationId || undefined };
}

export interface RetireTranscriptRecordsArgs extends OrganizationScope {
	readonly execute: boolean;
	readonly maxSessions: number;
	readonly pageSize: number;
	readonly pauseMs: number;
}

export function parseRetireTranscriptRecordsArgs(
	argv: readonly string[],
): RetireTranscriptRecordsArgs {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			"all-organizations": { type: "boolean", default: false },
			execute: { type: "boolean", default: false },
			"max-sessions": { type: "string" },
			"organization-id": { type: "string" },
			"page-size": { type: "string" },
			"pause-ms": { type: "string" },
		},
	});
	return {
		...parseOrganizationScope(values),
		execute: values.execute,
		maxSessions: parsePositiveIntegerFlag(
			values["max-sessions"],
			10_000,
			"--max-sessions",
			1_000_000,
		),
		pageSize: parsePositiveIntegerFlag(
			values["page-size"],
			25,
			"--page-size",
			100,
		),
		pauseMs: parseNonNegativeIntegerFlag(
			values["pause-ms"],
			500,
			"--pause-ms",
			60_000,
		),
	};
}

export interface RunIndexBackfillArgs extends OrganizationScope {
	readonly execute: boolean;
	readonly maxSessions: number;
	/** The `next` value a previous run printed. */
	readonly after: string | undefined;
}

export function parseRunIndexBackfillArgs(
	argv: readonly string[],
): RunIndexBackfillArgs {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			after: { type: "string" },
			"all-organizations": { type: "boolean", default: false },
			execute: { type: "boolean", default: false },
			"max-sessions": { type: "string" },
			"organization-id": { type: "string" },
		},
	});
	if (values.after !== undefined && !values.after.trim())
		throw new Error("--after must not be empty.");
	return {
		...parseOrganizationScope(values),
		execute: values.execute,
		maxSessions: parsePositiveIntegerFlag(
			values["max-sessions"],
			10_000,
			"--max-sessions",
			100_000,
		),
		after: values.after,
	};
}

export interface AuditL1Args extends OrganizationScope {
	readonly json: boolean;
	/** A previous `--json` report to compare with. */
	readonly compare: string | undefined;
}

export function parseAuditL1Args(argv: readonly string[]): AuditL1Args {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			"all-organizations": { type: "boolean", default: false },
			compare: { type: "string" },
			json: { type: "boolean", default: false },
			"organization-id": { type: "string" },
		},
	});
	if (values.compare !== undefined && !values.compare.trim())
		throw new Error("--compare must name a file.");
	return {
		...parseOrganizationScope(values),
		json: values.json,
		compare: values.compare,
	};
}

export interface L1EdgeBackfillArgs extends OrganizationScope {
	readonly execute: boolean;
	readonly maxSessions: number;
	/** The `next` value a previous run printed. */
	readonly after: string | undefined;
}

export function parseL1EdgeBackfillArgs(
	argv: readonly string[],
): L1EdgeBackfillArgs {
	return parseRunIndexBackfillArgs(argv);
}

export interface TranscriptSearchBackfillArgs extends OrganizationScope {
	readonly execute: boolean;
	readonly maxSessions: number;
	/** The `next` value a previous run printed. */
	readonly after: string | undefined;
	/** Indexing passes started per minute at most. */
	readonly sessionsPerMinute: number;
	/** ClickHouse `LoadAverage1` above which the run pauses. */
	readonly maxLoad: number;
}

export function parseTranscriptSearchBackfillArgs(
	argv: readonly string[],
): TranscriptSearchBackfillArgs {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			after: { type: "string" },
			"all-organizations": { type: "boolean", default: false },
			execute: { type: "boolean", default: false },
			"max-load": { type: "string" },
			"max-sessions": { type: "string" },
			"organization-id": { type: "string" },
			"sessions-per-minute": { type: "string" },
		},
	});
	if (values.after !== undefined && !values.after.trim())
		throw new Error("--after must not be empty.");
	return {
		...parseOrganizationScope(values),
		execute: values.execute,
		maxSessions: parsePositiveIntegerFlag(
			values["max-sessions"],
			10_000,
			"--max-sessions",
			100_000,
		),
		after: values.after,
		sessionsPerMinute: parsePositiveIntegerFlag(
			values["sessions-per-minute"],
			30,
			"--sessions-per-minute",
			600,
		),
		maxLoad: parsePositiveIntegerFlag(
			values["max-load"],
			12,
			"--max-load",
			1_000,
		),
	};
}

export interface RunQuestionsBackfillArgs extends OrganizationScope {
	readonly execute: boolean;
	/** Runs that started in the last this many days. */
	readonly days: number;
	readonly maxRuns: number;
	/** The `next` value a previous run printed. */
	readonly after: string | undefined;
	/** Runs queued and answered per minute at most. */
	readonly runsPerMinute: number;
	/** ClickHouse `LoadAverage1` above which the run pauses. */
	readonly maxLoad: number;
	/** Queue the answers and leave them to the run-questions cron, which answers in production. */
	readonly queueOnly: boolean;
}

export function parseRunQuestionsBackfillArgs(
	argv: readonly string[],
): RunQuestionsBackfillArgs {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			after: { type: "string" },
			"all-organizations": { type: "boolean", default: false },
			days: { type: "string" },
			execute: { type: "boolean", default: false },
			"max-load": { type: "string" },
			"max-runs": { type: "string" },
			"organization-id": { type: "string" },
			"runs-per-minute": { type: "string" },
			"queue-only": { type: "boolean", default: false },
		},
	});
	if (values.after !== undefined && !values.after.trim())
		throw new Error("--after must not be empty.");
	if (values["queue-only"] && !values.execute)
		throw new Error("--queue-only queues answers, so it needs --execute.");
	return {
		...parseOrganizationScope(values),
		execute: values.execute,
		queueOnly: values["queue-only"],
		days: parsePositiveIntegerFlag(values.days, 28, "--days", 3_650),
		maxRuns: parsePositiveIntegerFlag(
			values["max-runs"],
			10_000,
			"--max-runs",
			100_000,
		),
		after: values.after,
		runsPerMinute: parsePositiveIntegerFlag(
			values["runs-per-minute"],
			60,
			"--runs-per-minute",
			600,
		),
		maxLoad: parsePositiveIntegerFlag(
			values["max-load"],
			12,
			"--max-load",
			1_000,
		),
	};
}

export interface RunQuestionsAddArgs {
	/** The JSON file of questions to add. */
	readonly file: string;
	/** Turn the questions on, so every run is answered for them. */
	readonly on: boolean;
}

export function parseRunQuestionsAddArgs(
	argv: readonly string[],
): RunQuestionsAddArgs {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			file: { type: "string" },
			on: { type: "boolean", default: false },
		},
	});
	const file = values.file?.trim();
	if (!file) throw new Error("Name the questions: --file <questions.json>.");
	return { file, on: values.on };
}
