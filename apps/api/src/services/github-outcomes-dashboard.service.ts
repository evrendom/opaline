import { ORPCError } from "@orpc/server";
import {
	CI_EVENT_LABELS,
	CI_RUN_CONCLUSIONS,
	type CostDashboardInput,
	type CostDimension,
	type DashboardMetricData,
	PULL_REQUEST_CI,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { queryClickhouse } from "../clickhouse.js";
import {
	buildMetric,
	type CostAggregateRow,
	listDashboardDates,
} from "./cost-dashboard-data.js";
import { buildDurationPeriods } from "./dashboard-duration-periods.js";
import type {
	GitHubReadiness,
	GitHubRepositoryReadiness,
} from "./github-outcomes-readiness.service.js";

interface PullRow {
	repository_id: string;
	number: number;
	author_id: string;
	author_login: string;
	date: string;
	created_at: string;
	merged_at: string;
	attempts: number;
	failed: number;
	seconds: number;
}
interface RunRow {
	repository_id: string;
	date: string;
	conclusion: string;
	event: string;
	workflow_id: string;
	workflow_name: string;
	attempt: string;
	count: number;
	seconds: number[];
}
interface Fact {
	date: string;
	repository: string;
	dimensions: Partial<Record<CostDimension, string>>;
	count: number;
	numerator: number;
	denominator: number;
	seconds: number[];
}
const PR_DIMENSIONS: CostDimension[] = [
	"repositories",
	"githubAuthors",
	"pullRequestCi",
];
const RUN_DIMENSIONS: CostDimension[] = [
	"repositories",
	"ciConclusions",
	"ciEvents",
	"ciWorkflows",
	"ciAttempts",
];
const QUERY_SETTINGS = {
	max_execution_time: 20,
	max_rows_to_read: "100000000",
	max_bytes_to_read: "10000000000",
	max_result_rows: "100001",
	max_result_bytes: "10000000",
	result_overflow_mode: "throw",
} as const;

export async function getGitHubOutcomesDashboardMetrics(
	organizationId: string,
	input: CostDashboardInput,
	readiness: GitHubReadiness | null,
	preview: boolean,
	env: { database: postgres.Sql; queryClickhouse: typeof queryClickhouse },
) {
	const active = await env.database.unsafe<Array<{ repository_id: string }>>(
		`SELECT b.repository_id FROM github_repository_binding b JOIN github_app_installation i ON i.installation_id = b.installation_id AND i.organization_id = b.organization_id AND i.status = 'active' WHERE b.organization_id = $1 AND b.status = 'active'`,
		[organizationId],
	);
	const activeIds = new Set(active.map((row) => row.repository_id));
	const repositories = (readiness?.details.repositories ?? []).filter((repo) =>
		activeIds.has(repo.repositoryId),
	);
	const included = repositories.filter((repo) => repo.included);
	const selected = included.filter(
		(repo) =>
			input.repositories.length === 0 ||
			input.repositories.includes(repo.repositoryId),
	);
	const byRepository = new Map(
		included.map((repo) => [repo.repositoryId, repo]),
	);
	const query_params = {
		organizationId,
		repositories: included.map((repo) => repo.repositoryId),
		ciFloors: included.map(
			(repo) => effectiveCiFrom(repo) ?? "2299-01-01T00:00:00Z",
		),
		startDate: input.startDate,
		endDate: input.endDate,
	};
	const [pulls, runs, authors] = await Promise.all([
		included.length === 0
			? Promise.resolve([])
			: env.queryClickhouse<PullRow>({
					query: `WITH prs AS (SELECT repository_id, number, author_id, author_login, created_at, merged_at FROM rudel.github_pull_requests FINAL PREWHERE workspace_id = {organizationId:String} AND provider = 'github' AND has({repositories:Array(String)}, repository_id) WHERE merged_at >= toDateTime({startDate:String}, 'UTC') AND merged_at < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY),
			 links AS (SELECT repository_id, pr_number, kind, run_id, attempt, run_created_at FROM rudel.github_ci_run_pull_requests FINAL PREWHERE workspace_id = {organizationId:String} AND provider = 'github' AND has({repositories:Array(String)}, repository_id) WHERE kind != 'check_suite' AND run_created_at >= (SELECT min(created_at) FROM prs) AND run_created_at <= (SELECT max(merged_at) FROM prs) AND (repository_id, pr_number) IN (SELECT repository_id, number FROM prs)),
			 runs AS (SELECT repository_id, kind, run_id, attempt, created_at, conclusion FROM rudel.github_ci_runs FINAL PREWHERE workspace_id = {organizationId:String} AND provider = 'github' AND has({repositories:Array(String)}, repository_id) WHERE kind != 'check_suite' AND created_at >= (SELECT min(created_at) FROM prs) AND created_at <= (SELECT max(merged_at) FROM prs))
			 SELECT p.repository_id AS repository_id, p.number AS number, p.author_id AS author_id, p.author_login AS author_login, toString(toDate(p.merged_at, 'UTC')) AS date, toString(p.created_at) AS created_at, toString(p.merged_at) AS merged_at,
			 countIf(r.run_id != '' AND r.created_at BETWEEN p.created_at AND p.merged_at) AS attempts,
			 countIf(r.run_id != '' AND r.created_at BETWEEN p.created_at AND p.merged_at AND if(r.kind = 'status', r.conclusion IN ('failure','error'), r.conclusion IN ('failure','startup_failure','timed_out'))) AS failed,
			 dateDiff('millisecond', p.created_at, p.merged_at) / 1000 AS seconds
			 FROM prs p ALL LEFT JOIN links l ON p.repository_id = l.repository_id AND p.number = l.pr_number
			 ALL LEFT JOIN runs r ON l.repository_id = r.repository_id AND l.kind = r.kind AND l.run_id = r.run_id AND l.attempt = r.attempt AND l.run_created_at = r.created_at
			 GROUP BY p.repository_id, p.number, p.author_id, p.author_login, p.created_at, p.merged_at LIMIT 100001`,
					query_params,
					clickhouse_settings: QUERY_SETTINGS,
				}),
		included.length === 0
			? Promise.resolve([])
			: env.queryClickhouse<RunRow>({
					query: `SELECT repository_id, toString(toDate(created_at, 'UTC')) AS date,
			 multiIf(isNull(conclusion), 'inProgress', conclusion IN ('failure','startup_failure'), 'failure', conclusion = 'timed_out', 'timedOut', conclusion = 'action_required', 'actionRequired', conclusion IN ('neutral','stale'), 'neutral', conclusion) AS conclusion,
			 event, workflow_id, any(workflow_name) AS workflow_name, if(attempt = 1, 'first', 'rerun') AS attempt, count() AS count,
			 groupArrayIf(100001)(dateDiff('millisecond', run_started_at, completed_at) / 1000, status = 'completed' AND run_started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= run_started_at) AS seconds
			 FROM rudel.github_ci_runs FINAL PREWHERE workspace_id = {organizationId:String} AND provider = 'github' AND has({repositories:Array(String)}, repository_id)
			 WHERE kind = 'actions_run' AND created_at >= toDateTime({startDate:String}, 'UTC') AND created_at < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
			 AND created_at >= parseDateTime64BestEffort(arrayElement({ciFloors:Array(String)}, indexOf({repositories:Array(String)}, repository_id)))
			 GROUP BY repository_id, date, conclusion, event, workflow_id, attempt LIMIT 100001`,
					query_params,
					clickhouse_settings: QUERY_SETTINGS,
				}),
		env.database.unsafe<
			Array<{ account_id: string; name: string; image: string | null }>
		>(
			`SELECT a.account_id, coalesce(nullif(u.name, ''), u.email) AS name, u.image FROM account a JOIN "user" u ON u.id = a.user_id JOIN member m ON m.user_id = u.id AND m.organization_id = $1 WHERE a.provider_id = 'github'`,
			[organizationId],
		),
	]);
	if (
		pulls.length > 100000 ||
		runs.length > 100000 ||
		runs.reduce((sum, run) => sum + run.seconds.length, 0) > 100000
	)
		throw new ORPCError("BAD_REQUEST", {
			message: "Choose a shorter date range to view pull request analytics.",
		});
	const labels = new Map<string, string>();
	for (const repo of included)
		labels.set(`repositories:${repo.repositoryId}`, repo.fullName);
	for (const entry of PULL_REQUEST_CI)
		labels.set(`pullRequestCi:${entry.id}`, entry.label);
	for (const entry of CI_RUN_CONCLUSIONS)
		labels.set(`ciConclusions:${entry.id}`, entry.label);
	labels.set("ciAttempts:first", "First attempt");
	labels.set("ciAttempts:rerun", "Re-run");
	const members = new Map(authors.map((author) => [author.account_id, author]));
	const pullFacts: Fact[] = pulls.map((pull) => {
		const repo = byRepository.get(pull.repository_id);
		const ciFrom = repo ? effectiveCiFrom(repo) : null;
		const covered =
			ciFrom !== null && timestamp(pull.created_at) >= Date.parse(ciFrom);
		const status = !covered
			? "unavailable"
			: Number(pull.failed) > 0
				? "failed"
				: Number(pull.attempts) > 0
					? "passed"
					: repo?.externalComplete
						? "noCi"
						: "unavailable";
		labels.set(
			`githubAuthors:${pull.author_login}`,
			members.get(pull.author_id)?.name ?? pull.author_login,
		);
		return {
			date: pull.date,
			repository: pull.repository_id,
			dimensions: {
				repositories: pull.repository_id,
				githubAuthors: pull.author_login,
				pullRequestCi: status,
			},
			count: 1,
			numerator:
				covered && (status === "failed" || status === "passed")
					? Number(pull.failed)
					: 0,
			denominator: status === "failed" || status === "passed" ? 1 : 0,
			seconds: Number(pull.seconds) >= 0 ? [Number(pull.seconds)] : [],
		};
	});
	const eventCounts = new Map<string, number>();
	for (const run of runs)
		eventCounts.set(
			run.event,
			(eventCounts.get(run.event) ?? 0) + Number(run.count),
		);
	const namedEvents = new Set(
		[...eventCounts]
			.sort(
				(first, second) =>
					second[1] - first[1] || first[0].localeCompare(second[0]),
			)
			.slice(0, 7)
			.map(([event]) => event),
	);
	labels.set("ciEvents:other", "Other");
	const runFacts: Fact[] = runs
		.filter((run) => {
			const repo = byRepository.get(run.repository_id);
			const ciFrom = repo ? effectiveCiFrom(repo) : null;
			return ciFrom !== null && run.date >= ciFrom.slice(0, 10);
		})
		.map((run) => {
			labels.set(
				`ciEvents:${run.event}`,
				CI_EVENT_LABELS[run.event] ?? run.event,
			);
			labels.set(
				`ciWorkflows:${run.workflow_id}`,
				run.workflow_name || run.workflow_id,
			);
			return {
				date: run.date,
				repository: run.repository_id,
				dimensions: {
					repositories: run.repository_id,
					ciConclusions: run.conclusion,
					ciEvents: namedEvents.has(run.event) ? run.event : "other",
					ciWorkflows: run.workflow_id,
					ciAttempts: run.attempt,
				},
				count: Number(run.count),
				numerator: 0,
				denominator: 0,
				seconds: run.seconds.map(Number),
			};
		});
	const matchedPulls = pullFacts.filter((fact) =>
		matches(fact, input, PR_DIMENSIONS),
	);
	const matchedRuns = runFacts.filter((fact) =>
		matches(fact, input, RUN_DIMENSIONS),
	);
	const history: NonNullable<DashboardMetricData["githubHistory"]> = {
		pullRequestsFrom: latestDate(selected.map((repo) => repo.prFrom)),
		ciFrom: latestDate(selected.map(effectiveCiFrom)),
		ciUnavailablePullRequests: matchedPulls.filter(
			(fact) => fact.dimensions.pullRequestCi === "unavailable",
		).length,
		syncingRepositories: repositories.filter(
			(repo) => !repo.included && !repo.reason,
		).length,
		unavailableRepositories: repositories.filter(
			(repo) => !repo.included && repo.reason,
		).length,
		lastSyncedAt: oldestTimestamp(selected),
		preview,
	};
	const mergedPullRequests = metricFromFacts(
		pullFacts,
		input,
		PR_DIMENSIONS,
		"mergedPullRequests",
		labels,
		history,
	);
	const ciFailuresPerPullRequest = metricFromFacts(
		pullFacts,
		input,
		PR_DIMENSIONS,
		"ciFailuresPerPullRequest",
		labels,
		history,
	);
	const ciRuns = metricFromFacts(
		runFacts,
		input,
		RUN_DIMENSIONS,
		"ciRuns",
		labels,
		history,
	);
	for (const entry of mergedPullRequests.breakdowns.githubAuthors) {
		const author = pulls.find((pull) => pull.author_login === entry.id);
		entry.image = author
			? (members.get(author.author_id)?.image ?? null)
			: null;
	}
	const cycle = durationStats(matchedPulls, input, 0.9);
	mergedPullRequests.cycleTimeStats = {
		...cycle,
		p90Seconds: cycle.p95Seconds,
		trend: cycle.trend.map((point) => ({
			...point,
			p90Seconds: point.p95Seconds,
		})),
	};
	for (const dimension of ["repositories", "githubAuthors"] as const) {
		for (const entry of mergedPullRequests.breakdowns[dimension]) {
			const seconds = pullFacts
				.filter(
					(fact) =>
						fact.dimensions[dimension] === entry.id &&
						matches(fact, input, PR_DIMENSIONS, dimension),
				)
				.flatMap((fact) => fact.seconds);
			entry.medianSeconds = percentile(seconds, 0.5);
			entry.p90Seconds = percentile(seconds, 0.9);
		}
	}
	ciRuns.durationStats = durationStats(matchedRuns, input, 0.95);
	const minuteEntries = (dimension: "repositories" | "ciWorkflows") =>
		ciRuns.breakdowns[dimension].map((entry) => ({
			...entry,
			value: runFacts
				.filter(
					(fact) =>
						fact.dimensions[dimension] === entry.id &&
						matches(fact, input, RUN_DIMENSIONS, dimension),
				)
				.reduce(
					(sum, fact) =>
						sum +
						fact.seconds.reduce((total, seconds) => total + seconds, 0) / 60,
					0,
				),
		}));
	ciRuns.ciMinutes = {
		total: matchedRuns.reduce(
			(sum, fact) =>
				sum + fact.seconds.reduce((total, seconds) => total + seconds, 0) / 60,
			0,
		),
		trend: listDashboardDates(input).map((date) => ({
			date,
			minutes: matchedRuns
				.filter((fact) => fact.date === date)
				.reduce(
					(sum, fact) =>
						sum +
						fact.seconds.reduce((total, seconds) => total + seconds, 0) / 60,
					0,
				),
		})),
		repositories: minuteEntries("repositories"),
		workflows: minuteEntries("ciWorkflows"),
	};
	for (const dimension of ["repositories", "ciWorkflows"] as const) {
		const minutes =
			dimension === "repositories"
				? ciRuns.ciMinutes.repositories
				: ciRuns.ciMinutes.workflows;
		for (const entry of ciRuns.breakdowns[dimension])
			entry.approximateMinutes =
				minutes.find((item) => item.id === entry.id)?.value ?? 0;
	}
	return { mergedPullRequests, ciFailuresPerPullRequest, ciRuns };
}

function metricFromFacts(
	facts: Fact[],
	requestedInput: CostDashboardInput,
	dimensions: CostDimension[],
	metric: "mergedPullRequests" | "ciFailuresPerPullRequest" | "ciRuns",
	labels: Map<string, string>,
	githubHistory: NonNullable<DashboardMetricData["githubHistory"]>,
): DashboardMetricData {
	const input: CostDashboardInput = {
		...requestedInput,
		splitBy: dimensions.some(
			(dimension) => dimension === requestedInput.splitBy,
		)
			? requestedInput.splitBy
			: "none",
	};
	const ratio = metric === "ciFailuresPerPullRequest";
	const rows: CostAggregateRow[] = [];
	for (const fact of facts) {
		const matched = matches(fact, input, dimensions);
		if (matched)
			rows.push({
				metric,
				date: fact.date,
				dimension: "headline",
				id: "",
				value: ratio ? fact.denominator : fact.count,
				incomplete: 0,
				matched_value: ratio ? fact.denominator : fact.count,
				matched_rows: fact.count,
				matched_incomplete: 0,
			});
		for (const dimension of ["members", ...dimensions] as const) {
			if (!matches(fact, input, dimensions, dimension)) continue;
			rows.push({
				metric,
				date: fact.date,
				dimension,
				id: fact.dimensions[dimension] ?? "",
				value: ratio ? fact.denominator : fact.count,
				incomplete: 0,
				matched_value: matched ? (ratio ? fact.denominator : fact.count) : 0,
				matched_rows: matched ? fact.count : 0,
				matched_incomplete: 0,
			});
		}
	}
	const result = buildMetric(
		rows,
		input,
		new Map(),
		metric === "ciRuns" ? "CI runs" : "Merged PRs",
	);
	const splitSeries = new Map(
		result.series.map((entry) => [entry.label, entry.id]),
	);
	for (const dimension of dimensions)
		for (const entry of result.breakdowns[dimension])
			entry.label = labels.get(`${dimension}:${entry.id}`) ?? entry.id;
	result.breakdowns.members = [];
	if (input.splitBy !== "none")
		for (const entry of result.series)
			entry.label =
				labels.get(`${input.splitBy}:${entry.label}`) ?? entry.label;
	for (const entry of metric === "ciRuns"
		? CI_RUN_CONCLUSIONS
		: PULL_REQUEST_CI) {
		const dimension = metric === "ciRuns" ? "ciConclusions" : "pullRequestCi";
		if (!result.breakdowns[dimension].some((item) => item.id === entry.id))
			result.breakdowns[dimension].push({
				id: entry.id,
				label: entry.label,
				value: 0,
				incomplete: false,
				image: null,
			});
	}
	if (ratio) {
		const matched = facts.filter((fact) => matches(fact, input, dimensions));
		result.numerator = matched.reduce((sum, fact) => sum + fact.numerator, 0);
		result.denominator = matched.reduce(
			(sum, fact) => sum + fact.denominator,
			0,
		);
		result.total = result.denominator
			? result.numerator / result.denominator
			: 0;
		for (const dimension of dimensions)
			for (const entry of result.breakdowns[dimension]) {
				const scoped = facts.filter(
					(fact) =>
						fact.dimensions[dimension] === entry.id &&
						matches(fact, input, dimensions, dimension),
				);
				entry.numerator = scoped.reduce((sum, fact) => sum + fact.numerator, 0);
				entry.denominator = scoped.reduce(
					(sum, fact) => sum + fact.denominator,
					0,
				);
				entry.value = entry.denominator
					? entry.numerator / entry.denominator
					: 0;
			}
		for (const point of result.trend) {
			const day = matched.filter((fact) => fact.date === point.date);
			point.numerator = day.reduce((sum, fact) => sum + fact.numerator, 0);
			point.denominator = day.reduce((sum, fact) => sum + fact.denominator, 0);
			point.total = point.denominator ? point.numerator / point.denominator : 0;
			point.numeratorValues = Object.fromEntries(
				result.series.map((entry) => [entry.id, 0]),
			);
			point.denominatorValues = Object.fromEntries(
				result.series.map((entry) => [entry.id, 0]),
			);
			for (const fact of day) {
				const key =
					input.splitBy === "none"
						? "total"
						: (splitSeries.get(fact.dimensions[input.splitBy] ?? "") ??
							"other");
				point.numeratorValues[key] =
					(point.numeratorValues[key] ?? 0) + fact.numerator;
				point.denominatorValues[key] =
					(point.denominatorValues[key] ?? 0) + fact.denominator;
			}
			point.values = Object.fromEntries(
				result.series.map(({ id }) => [
					id,
					point.denominatorValues?.[id]
						? (point.numeratorValues?.[id] ?? 0) / point.denominatorValues[id]
						: 0,
				]),
			);
		}
	}
	result.githubHistory = githubHistory;
	result.incomplete =
		githubHistory.preview || githubHistory.syncingRepositories > 0;
	return result;
}

function matches(
	fact: Fact,
	input: CostDashboardInput,
	dimensions: CostDimension[],
	except?: CostDimension,
) {
	return dimensions.every(
		(dimension) =>
			dimension === except ||
			input[dimension].length === 0 ||
			input[dimension].some((id) => id === fact.dimensions[dimension]),
	);
}
function effectiveCiFrom(repo: GitHubRepositoryReadiness) {
	return repo.ciFrom ?? (repo.noActions ? repo.prFrom : null);
}

function timestamp(value: string) {
	return Date.parse(
		value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
	);
}
function latestDate(values: (string | null)[]) {
	const dates = values
		.filter((value): value is string => value !== null)
		.map((value) => new Date(value).toISOString().slice(0, 10))
		.sort();
	return dates.at(-1) ?? null;
}
function oldestTimestamp(repos: GitHubRepositoryReadiness[]) {
	const values = repos
		.map((repo) => repo.lastSyncedAt)
		.filter((value): value is string => value !== null)
		.sort();
	return values[0] ? new Date(values[0]).toISOString() : null;
}
function percentile(values: number[], fraction: number) {
	if (!values.length) return null;
	const sorted = [...values].sort((first, second) => first - second);
	const index = (sorted.length - 1) * fraction;
	const lower = Math.floor(index);
	return (
		(sorted[lower] ?? 0) +
		((sorted[Math.ceil(index)] ?? 0) - (sorted[lower] ?? 0)) * (index - lower)
	);
}
function durationStats(
	facts: Fact[],
	input: CostDashboardInput,
	fraction: number,
): NonNullable<DashboardMetricData["durationStats"]> {
	const values = facts.flatMap((fact) => fact.seconds);
	const trend = buildDurationPeriods(
		input.startDate,
		input.endDate,
		input.durationInterval ?? "daily",
	).map((point) => {
		const scoped = facts.filter(
			(fact) => fact.date >= point.startDate && fact.date <= point.endDate,
		);
		const seconds = scoped.flatMap((fact) => fact.seconds);
		return {
			...point,
			sampleCount: seconds.length,
			unknownCount: scoped.reduce(
				(sum, fact) => sum + fact.count - fact.seconds.length,
				0,
			),
			medianSeconds: percentile(seconds, 0.5),
			p95Seconds: percentile(seconds, fraction),
		};
	});
	return {
		interval: input.durationInterval ?? "daily",
		sampleCount: values.length,
		unknownCount: facts.reduce(
			(sum, fact) => sum + fact.count - fact.seconds.length,
			0,
		),
		medianSeconds: percentile(values, 0.5),
		p95Seconds: percentile(values, fraction),
		trend,
	};
}
