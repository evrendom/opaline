import { parseArgs } from "node:util";

/**
 * Argument parsing of the L1 operator scripts (`retire:transcript-records`,
 * `backfill:run-index`, `backfill:transcript-search`, `audit:l1`), kept free of database clients so it can
 * be tested. Every script is a preview unless `--execute` is given, and the
 * ones that write must name their scope: `--organization-id <id>`, or
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
