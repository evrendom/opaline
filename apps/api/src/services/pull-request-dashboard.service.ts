import { TupleParam } from "@clickhouse/client-web";
import { ORPCError } from "@orpc/server";
import type {
	CostDashboardInput,
	DashboardMetricData,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { queryClickhouse } from "../clickhouse.js";
import { listDashboardDates } from "./cost-dashboard-data.js";
import { resolveCanonicalPricingModel } from "./usage-event-analytics.service.js";

const FAILED_CONCLUSIONS = ["failure", "startup_failure", "timed_out"] as const;
const MAX_OBSERVATION_ROWS = 100_000;

interface PullRequestObservationRow {
	readonly pull_key: string;
	readonly merged_date: string;
	readonly member_id: string;
	readonly member_label: string;
	readonly member_image: string | null;
	readonly repository_id: string;
	readonly repository_label: string;
	readonly session_id: string;
	readonly session_source: string;
	readonly failed_job_keys: readonly string[];
	readonly ci_coverage_complete: boolean;
}

interface SessionModelRow {
	readonly session_id: string;
	readonly source: string;
	readonly model: string;
}

export interface AttributedPullRequest {
	readonly pullKey: string;
	readonly date: string;
	readonly member: string;
	readonly memberLabel: string;
	readonly memberImage: string | null;
	readonly repository: string;
	readonly repositoryLabel: string;
	readonly model: string;
	readonly failedJobs: readonly string[];
	readonly ciComplete: boolean;
}

export interface PullRequestDashboardMetrics {
	readonly mergedPullRequests: DashboardMetricData | null;
	readonly ciFailuresPerPullRequest: DashboardMetricData | null;
}

/**
 * Merged date always defines the cohort. Member and model are observational
 * session attribution, not the GitHub merger or causal credit. A PR can appear
 * in more than one attribution breakdown while remaining one headline PR.
 */
export async function getPullRequestDashboardMetrics(
	organizationId: string,
	input: CostDashboardInput,
	env: {
		readonly database: postgres.Sql;
		readonly queryClickhouse: typeof queryClickhouse;
	},
): Promise<PullRequestDashboardMetrics> {
	const rows = await env.database.begin(async (transaction) => {
		await transaction.unsafe("SET LOCAL statement_timeout = '20s'");
		return transaction.unsafe<PullRequestObservationRow[]>(
			`WITH latest AS (
		 SELECT DISTINCT ON (organization_id, repository_id, provider, provider_pull_request_id)
		  organization_id, repository_id, provider, provider_pull_request_id, head_sha, merged_at, coverage_complete, ci_coverage_complete
		 FROM github_pull_request_snapshot
		 WHERE organization_id = $1
		 ORDER BY organization_id, repository_id, provider, provider_pull_request_id, observed_at DESC, collection_id DESC
		), scoped_latest AS (
		 SELECT DISTINCT ON (snapshot.organization_id, snapshot.repository_id, snapshot.provider, snapshot.provider_pull_request_id, collection.commit_sha)
		  snapshot.organization_id, snapshot.repository_id, snapshot.provider,
		  snapshot.provider_pull_request_id, snapshot.collection_id,
		  snapshot.ci_coverage_complete, snapshot.observed_at
		 FROM github_pull_request_snapshot snapshot
		 JOIN github_evidence_collection collection ON collection.id = snapshot.collection_id
		 WHERE snapshot.organization_id = $1
		 ORDER BY snapshot.organization_id, snapshot.repository_id, snapshot.provider,
		  snapshot.provider_pull_request_id, collection.commit_sha,
		  snapshot.observed_at DESC, snapshot.collection_id DESC
		), cohort AS (
		 SELECT latest.organization_id, latest.repository_id, latest.provider,
		  latest.provider_pull_request_id, latest.head_sha, latest.merged_at,
		  bool_and(scoped_latest.ci_coverage_complete) AS ci_coverage_complete
		 FROM latest
		 JOIN scoped_latest USING (organization_id, repository_id, provider, provider_pull_request_id)
		 WHERE latest.coverage_complete AND latest.merged_at >= $2::date AND latest.merged_at < ($3::date + interval '1 day')
		 GROUP BY latest.organization_id, latest.repository_id, latest.provider,
		  latest.provider_pull_request_id, latest.head_sha, latest.merged_at
		)
		SELECT concat_ws(':', snapshot.repository_id, snapshot.provider, snapshot.provider_pull_request_id) AS pull_key,
		 to_char(cohort.merged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS merged_date,
		 snapshot.session_user_id AS member_id,
		 coalesce(member.name, member.email, snapshot.session_user_id, 'Unknown') AS member_label,
		 member.image AS member_image,
		 snapshot.repository_id,
		 binding.full_name AS repository_label,
		 snapshot.session_id, snapshot.session_source,
		 coalesce(ci.failed_job_keys, ARRAY[]::text[]) AS failed_job_keys,
		 cohort.ci_coverage_complete
		FROM cohort
		JOIN github_pull_request_snapshot snapshot USING (organization_id, repository_id, provider, provider_pull_request_id)
		JOIN github_evidence_collection collection ON collection.id = snapshot.collection_id
		JOIN github_repository_binding binding ON binding.organization_id = snapshot.organization_id AND binding.repository_id = snapshot.repository_id
		LEFT JOIN "user" member ON member.id = snapshot.session_user_id
		LEFT JOIN LATERAL (
		 SELECT array_agg(DISTINCT concat_ws(':', receipt.workflow_run_id, receipt.run_attempt::text, receipt.job_id))
		   FILTER (WHERE receipt.conclusion = ANY($4::text[])) AS failed_job_keys
		 FROM scoped_latest ci_scope
		 JOIN github_ci_log_receipt receipt ON receipt.collection_id = ci_scope.collection_id
		 WHERE ci_scope.organization_id = cohort.organization_id
		  AND ci_scope.repository_id = cohort.repository_id
		  AND ci_scope.provider = cohort.provider
		  AND ci_scope.provider_pull_request_id = cohort.provider_pull_request_id
		) ci ON true
		WHERE snapshot.coverage_complete AND snapshot.session_id <> ''
		LIMIT ${MAX_OBSERVATION_ROWS + 1}`,
			[organizationId, input.startDate, input.endDate, [...FAILED_CONCLUSIONS]],
		);
	});
	if (rows.length > MAX_OBSERVATION_ROWS) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Choose a shorter date range to view pull request analytics.",
		});
	}
	if (rows.length === 0) {
		const coverage = await env.database.unsafe<Array<{ available: boolean }>>(
			`WITH latest AS (
			 SELECT DISTINCT ON (repository_id, commit_sha, session_id, context_id) status, completed_at, coverage
			 FROM github_evidence_collection WHERE organization_id = $1
			 ORDER BY repository_id, commit_sha, session_id, context_id, attempt_number DESC
			)
			SELECT count(*) > 0 AND coalesce(bool_and(status IN ('complete', 'partial')
			 AND coalesce(coverage->>'pullRequestCoverageComplete' = 'true', false)), false) AS available
			FROM latest WHERE completed_at >= $2::date AND completed_at < ($3::date + interval '1 day')`,
			[organizationId, input.startDate, input.endDate],
		);
		if (!coverage[0]?.available) {
			return { mergedPullRequests: null, ciFailuresPerPullRequest: null };
		}
		return {
			mergedPullRequests: buildPullRequestMetric([], input, false),
			ciFailuresPerPullRequest: null,
		};
	}

	const models = await env.queryClickhouse<SessionModelRow>({
		query: `SELECT source, session_id, model
		 FROM (
		  SELECT source, session_id,
		   if(resolved_model != '', resolved_model,
		    if(raw_model != '', raw_model, 'unknown')) AS model
		  FROM rudel.usage_events FINAL
		  WHERE organization_id = {orgId:String}
		   AND record_kind = 'event' AND is_deleted = 0
		 )
		 WHERE tuple(source, session_id) IN {sessions:Array(Tuple(String, String))}
		 GROUP BY source, session_id, model`,
		query_params: {
			orgId: organizationId,
			sessions: [
				...new Set(
					rows.map((row) => `${row.session_source}\0${row.session_id}`),
				),
			].map((value) => {
				const [source, sessionId] = value.split("\0");
				return new TupleParam([source ?? "", sessionId ?? ""]);
			}),
		},
		clickhouse_settings: {
			max_execution_time: 20,
			max_rows_to_read: "100000000",
			max_bytes_to_read: "10000000000",
			max_result_rows: String(MAX_OBSERVATION_ROWS + 1),
			result_overflow_mode: "throw",
		},
	});
	const modelsBySession = new Map<string, string[]>();
	for (const row of models) {
		const key = `${row.source}\0${row.session_id}`;
		modelsBySession.set(key, [...(modelsBySession.get(key) ?? []), row.model]);
	}
	const attributed = rows.flatMap((row): AttributedPullRequest[] => {
		const sessionModels = modelsBySession.get(
			`${row.session_source}\0${row.session_id}`,
		) ?? ["unknown"];
		return sessionModels.map((model) => ({
			pullKey: row.pull_key,
			date: row.merged_date,
			member: row.member_id,
			memberLabel: row.member_label,
			memberImage: row.member_image,
			repository: row.repository_id,
			repositoryLabel: row.repository_label,
			model,
			failedJobs: row.failed_job_keys,
			ciComplete: row.ci_coverage_complete,
		}));
	});
	const selectedModels = input.models.map(resolveCanonicalPricingModel);
	const matched = attributed.filter(
		(row) =>
			(input.members.length === 0 || input.members.includes(row.member)) &&
			(input.repositories.length === 0 ||
				input.repositories.includes(row.repository)) &&
			(selectedModels.length === 0 ||
				selectedModels.includes(resolveCanonicalPricingModel(row.model))),
	);
	return {
		mergedPullRequests: buildPullRequestMetric(matched, input, false),
		ciFailuresPerPullRequest: matched.every((row) => row.ciComplete)
			? buildPullRequestMetric(matched, input, true)
			: null,
	};
}

export function buildPullRequestMetric(
	rows: readonly AttributedPullRequest[],
	input: CostDashboardInput,
	ratio: boolean,
): DashboardMetricData {
	const dimensions = ["members", "repositories", "models"] as const;
	const idFor = (
		row: AttributedPullRequest,
		dimension: (typeof dimensions)[number],
	) =>
		dimension === "members"
			? row.member
			: dimension === "repositories"
				? row.repository
				: row.model;
	const labels = new Map(
		rows.map((row) => [row.repository, row.repositoryLabel]),
	);
	const memberLabels = new Map(
		rows.map((row) => [row.member, row.memberLabel]),
	);
	const memberImages = new Map(
		rows.map((row) => [row.member, row.memberImage]),
	);
	const breakdowns: DashboardMetricData["breakdowns"] = {
		members: [],
		repositories: [],
		models: [],
		signalTypes: [],
		phrases: [],
		runSignals: [],
		durations: [],
		skillsUsed: [],
	};
	for (const dimension of dimensions) {
		const ids = new Set(rows.map((row) => idFor(row, dimension)));
		breakdowns[dimension] = [...ids]
			.map((id) => {
				const scoped = rows.filter((row) => idFor(row, dimension) === id);
				const denominator = new Set(scoped.map((row) => row.pullKey)).size;
				const numerator = new Set(scoped.flatMap((row) => row.failedJobs)).size;
				return {
					id,
					label:
						dimension === "repositories"
							? (labels.get(id) ?? id)
							: dimension === "members"
								? (memberLabels.get(id) ?? "Unknown")
								: id || "Unknown",
					value:
						ratio && denominator > 0 ? numerator / denominator : denominator,
					incomplete: false,
					image:
						dimension === "members" ? (memberImages.get(id) ?? null) : null,
					...(ratio ? { numerator, denominator } : {}),
				};
			})
			.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
	}
	const chartDimension =
		input.splitBy === "members" ||
		input.splitBy === "repositories" ||
		input.splitBy === "models"
			? input.splitBy
			: "members";
	const seriesEntries =
		input.splitBy === "none" ? [] : breakdowns[chartDimension].slice(0, 7);
	const rowsByDate = new Map<string, AttributedPullRequest[]>();
	for (const row of rows) {
		const dayRows = rowsByDate.get(row.date);
		if (dayRows) dayRows.push(row);
		else rowsByDate.set(row.date, [row]);
	}
	// Densify like every other dashboard series: a day without a merged PR is a
	// measured zero, not a missing point the chart would interpolate across.
	const trend = listDashboardDates(input).map((date) => {
		const dayRows = rowsByDate.get(date) ?? [];
		const denominator = new Set(dayRows.map((row) => row.pullKey)).size;
		const numerator = new Set(dayRows.flatMap((row) => row.failedJobs)).size;
		const values: Record<string, number> = {};
		const numeratorValues: Record<string, number> = {};
		const denominatorValues: Record<string, number> = {};
		for (const [index, entry] of seriesEntries.entries()) {
			const scoped = dayRows.filter(
				(row) => idFor(row, chartDimension) === entry.id,
			);
			const d = new Set(scoped.map((row) => row.pullKey)).size;
			const n = new Set(scoped.flatMap((row) => row.failedJobs)).size;
			values[`series-${index}`] = ratio && d > 0 ? n / d : d;
			numeratorValues[`series-${index}`] = n;
			denominatorValues[`series-${index}`] = d;
		}
		if (input.splitBy === "none") {
			values.total =
				ratio && denominator > 0 ? numerator / denominator : denominator;
			numeratorValues.total = numerator;
			denominatorValues.total = denominator;
		}
		return {
			date,
			total: ratio && denominator > 0 ? numerator / denominator : denominator,
			values,
			...(ratio
				? { numerator, denominator, numeratorValues, denominatorValues }
				: {}),
		};
	});
	const denominator = new Set(rows.map((row) => row.pullKey)).size;
	const numerator = new Set(rows.flatMap((row) => row.failedJobs)).size;
	return {
		total: ratio && denominator > 0 ? numerator / denominator : denominator,
		incomplete: false,
		hasUsage: denominator > 0,
		series:
			input.splitBy === "none"
				? [
						{
							id: "total",
							label: ratio ? "CI failures per PR" : "Merged pull requests",
						},
					]
				: seriesEntries.map((entry, index) => ({
						id: `series-${index}`,
						label: entry.label,
					})),
		trend,
		breakdowns,
		...(ratio ? { numerator, denominator } : {}),
	};
}
