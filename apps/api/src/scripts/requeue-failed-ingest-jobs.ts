import { parseArgs } from "node:util";
import type postgres from "postgres";
import { sqlClient } from "../db.js";
import {
	R2_INGEST_DEPENDENCY_UNAVAILABLE,
	R2_INGEST_TRANSIENT_ERROR_CODES,
} from "../services/r2-ingest-processing-error.js";

interface FailedIngestJob {
	expiresAt: Date | string;
	failedAt: Date | string;
	jobId: string;
	lastErrorCode: string;
	workspaceId: string;
	userId: string;
}

export async function requeueFailedIngestJobs(options: {
	cutoff: Date;
	database: postgres.Sql;
	execute: boolean;
	from: Date;
	limit: number;
	now: Date;
	to: Date;
	workspaceId?: string;
	userId?: string;
	includeLegacy?: boolean;
}) {
	for (const date of [options.from, options.to, options.cutoff, options.now]) {
		if (!Number.isFinite(date.getTime()))
			throw new Error("Invalid requeue timestamp");
	}
	if (options.from >= options.to) throw new Error("--from must precede --to");
	if (options.cutoff > options.now)
		throw new Error("--cutoff must not be in the future");
	if (
		!Number.isSafeInteger(options.limit) ||
		options.limit < 1 ||
		options.limit > 1_000
	) {
		throw new Error("--limit must be an integer between 1 and 1000");
	}
	const select = `SELECT id AS "jobId", expires_at AS "expiresAt",
		failed_at AS "failedAt", last_error_code AS "lastErrorCode",
		organization_id AS "workspaceId", user_id AS "userId"
		FROM ingest_job
		WHERE status = 'failed'
			AND failed_at >= $1 AND failed_at < $2
			AND updated_at <= $3
			AND expires_at > $4
			AND expires_at > clock_timestamp()
			AND objects_deleted_at IS NULL
			AND last_error_code = ANY($5::text[])
			AND ($7::text IS NULL OR organization_id = $7)
			AND ($8::text IS NULL OR user_id = $8)
		ORDER BY failed_at, id
		LIMIT $6`;
	const parameters = [
		options.from.toISOString(),
		options.to.toISOString(),
		options.cutoff.toISOString(),
		options.now.toISOString(),
		R2_INGEST_TRANSIENT_ERROR_CODES.filter(
			(code) => options.includeLegacy || code !== "R2_INGEST_TRANSIENT_FAILURE",
		),
		options.limit,
		options.workspaceId ?? null,
		options.userId ?? null,
	];
	const jobs = options.execute
		? await options.database.begin(async (transaction) => {
				const candidates = await transaction.unsafe<FailedIngestJob[]>(
					`${select} FOR UPDATE SKIP LOCKED`,
					parameters,
				);
				if (candidates.length > 0) {
					await transaction.unsafe(
						`UPDATE ingest_job
						 SET status = 'pending', attempts = 0, available_at = $1,
							failed_at = NULL, lease_token = NULL, lease_expires_at = NULL,
							last_error_code = $2,
							last_error_message = 'Requeued after transient dependency failure',
							updated_at = $1
						 WHERE id = ANY($3::text[])`,
						[
							options.now.toISOString(),
							R2_INGEST_DEPENDENCY_UNAVAILABLE,
							candidates.map((job) => job.jobId),
						],
					);
				}
				return candidates;
			})
		: await options.database.unsafe<FailedIngestJob[]>(select, parameters);
	return {
		cutoff: options.cutoff.toISOString(),
		from: options.from.toISOString(),
		to: options.to.toISOString(),
		mode: options.execute ? "execute" : "preview",
		count: jobs.length,
		limit: options.limit,
		jobs,
		legacyUnclassifiedCount: jobs.filter(
			(job) => job.lastErrorCode === "R2_INGEST_TRANSIENT_FAILURE",
		).length,
		legacyNote:
			"Legacy TRANSIENT_FAILURE records do not retain the underlying error; they may include non-ClickHouse operational failures.",
	};
}

async function main(): Promise<void> {
	try {
		const { values } = parseArgs({
			args: Bun.argv.slice(2),
			options: {
				from: { type: "string" },
				to: { type: "string" },
				cutoff: { type: "string" },
				execute: { default: false, type: "boolean" },
				limit: { default: "100", type: "string" },
				workspace: { type: "string" },
				user: { type: "string" },
				"include-legacy": { default: false, type: "boolean" },
			},
			strict: true,
		});
		if (values.execute && !values.cutoff) {
			throw new Error(
				"Execution requires the exact --cutoff value printed by a prior preview.",
			);
		}
		const now = new Date();
		const result = await requeueFailedIngestJobs({
			cutoff: values.cutoff ? parseTimestamp(values.cutoff, "--cutoff") : now,
			database: sqlClient,
			execute: values.execute,
			from: parseTimestamp(values.from, "--from"),
			limit: Number(values.limit),
			now,
			to: parseTimestamp(values.to, "--to"),
			workspaceId: values.workspace,
			userId: values.user,
			includeLegacy: values["include-legacy"],
		});
		console.log(JSON.stringify(result, null, 2));
	} finally {
		await sqlClient.end();
	}
}

function parseTimestamp(value: string | undefined, flag: string): Date {
	if (
		!value ||
		!/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
		!Number.isFinite(Date.parse(value))
	) {
		throw new Error(
			`${flag} requires an ISO timestamp with an explicit timezone.`,
		);
	}
	return new Date(value);
}

if (import.meta.main) await main();
