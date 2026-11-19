import {
	CLI_DATA_LIMITS,
	type CliDataTable,
	type DataChunk,
} from "@rudel/api-routes/cli-data";
import { redactReturnedValue } from "@rudel/secret-filter";
import { sqlString } from "../analysis/retro-measure-sql.js";
import { type GitHubReach, reachGitHub } from "./github.js";
import { ChunkWriter, redactJsonText } from "./lines.js";
import { type EdgeReach, readEdges, readGitRows } from "./reach.js";
import {
	RECORD_COLUMNS,
	recordLines,
	SETUP_TEXT_COLUMNS,
	type SetupVersion,
	setupTextLines,
} from "./records.js";
import {
	agentBatches,
	asCliDataError,
	type CliDataContext,
	type Row,
} from "./statements.js";
import { inList, type VisibleSession, visibleSessions } from "./visible.js";

export const PULL_NARROW =
	"Pull fewer sessions per call: send this table's sessions in smaller batches.";

interface Reach {
	readonly edges: EdgeReach;
	readonly github: GitHubReach;
}

const REACH_TTL_MS = 300_000;
const REACH_ENTRIES = 16;
const reaches = new Map<string, { at: number; value: Promise<Reach> }>();

export function forgetReaches(): void {
	reaches.clear();
}

function reachOf(
	context: CliDataContext,
	sessions: readonly VisibleSession[],
): Promise<Reach> {
	const { workspaceId, reader } = context.caller;
	const key = JSON.stringify([
		workspaceId,
		reader.userId,
		reader.role,
		reader.ownSessionsOnly,
		sessions.map((session) => session.sessionId),
	]);
	const now = Date.now();
	for (const [stale, entry] of reaches)
		if (now - entry.at >= REACH_TTL_MS) reaches.delete(stale);
	const known = reaches.get(key);
	if (known) return known.value;
	const unsignalled: CliDataContext = { ...context, signal: undefined };
	const ids = sessions.map((session) => session.sessionId);
	const value = (async () => {
		const edges = await readEdges(unsignalled, ids);
		const gitRows = await readGitRows(unsignalled, ids);
		return {
			edges,
			github: await reachGitHub(unsignalled, sessions, edges, gitRows),
		};
	})();
	value.catch(() => reaches.delete(key));
	reaches.set(key, { at: now, value });
	if (reaches.size > REACH_ENTRIES) {
		const oldest = reaches.keys().next().value;
		if (oldest !== undefined) reaches.delete(oldest);
	}
	return value;
}

function windowOf(
	starts: ReadonlyMap<string, string>,
	batch: readonly string[],
): string {
	const first =
		batch
			.map((id) => starts.get(id) ?? "")
			.filter(Boolean)
			.sort()[0] ?? "1970-01-01 00:00:00.000";
	return `toDateTime64(${sqlString(first)}, 3, 'UTC') - INTERVAL 1 DAY`;
}

async function* viewLines(
	context: CliDataContext,
	keys: readonly string[],
	size: number,
	sqlFor: (batch: readonly string[]) => string,
): AsyncGenerator<string> {
	for await (const line of agentBatches(context, keys, size, sqlFor))
		yield redactJsonText(line);
}

function* objectLines(rows: readonly Row[]): Generator<string> {
	for (const row of rows) yield JSON.stringify(redactReturnedValue(row));
}

async function* setupLines(
	context: CliDataContext,
	sessions: readonly VisibleSession[],
	starts: ReadonlyMap<string, string>,
	texts: boolean,
): AsyncGenerator<string> {
	const versions = new Map<string, SetupVersion>();
	for await (const line of agentBatches(
		context,
		byStart(sessions),
		40,
		(batch) =>
			`SELECT * FROM setup_files WHERE started_at >= ${windowOf(starts, batch)} AND session_id IN ${inList(batch)} ORDER BY session_id, agent_id, started_at`,
	)) {
		if (!texts) {
			yield redactJsonText(line);
			continue;
		}
		const row = JSON.parse(line) as Row;
		const entry = {
			userId: String(row.user_id),
			version: String(row.version),
			versionName: String(row.version_name ?? ""),
		};
		versions.set(`${entry.userId}|${entry.version}`, entry);
	}
	if (texts)
		yield* setupTextLines(
			context,
			[...versions.entries()]
				.sort(([left], [right]) => (left < right ? -1 : 1))
				.map(([, entry]) => entry),
		);
}

function byStart(sessions: readonly VisibleSession[]): string[] {
	return [...sessions]
		.sort((left, right) =>
			left.firstStart < right.firstStart
				? -1
				: left.firstStart > right.firstStart
					? 1
					: 0,
		)
		.map((session) => session.sessionId);
}

async function* tableLines(
	context: CliDataContext,
	table: CliDataTable,
	sessions: readonly VisibleSession[],
): AsyncGenerator<string> {
	const ids = sessions.map((session) => session.sessionId);
	const starts = new Map(
		sessions.map((session) => [session.sessionId, session.firstStart]),
	);
	switch (table) {
		case "records":
			yield* recordLines(context, sessions);
			return;
		case "runs":
			yield* viewLines(
				context,
				ids,
				50,
				(batch) =>
					`SELECT * FROM runs WHERE session_id IN ${inList(batch)} ORDER BY session_id, agent_id, turn_idx`,
			);
			return;
		case "calls":
			yield* viewLines(
				context,
				byStart(sessions),
				10,
				(batch) =>
					`SELECT * FROM calls WHERE started_at >= ${windowOf(starts, batch)} AND session_id IN ${inList(batch)} ORDER BY session_id, agent_id, turn_idx, started_at`,
			);
			return;
		case "git":
			yield* viewLines(
				context,
				ids,
				50,
				(batch) =>
					`SELECT * FROM git_events WHERE session_id IN ${inList(batch)} ORDER BY session_id, agent_id, record_idx`,
			);
			return;
		case "setup_files":
			yield* setupLines(context, sessions, starts, false);
			return;
		case "setup_texts":
			yield* setupLines(context, sessions, starts, true);
			return;
		case "github_repositories":
			yield* objectLines(
				(await context.env.githubBindings(context.caller.workspaceId)).map(
					(binding) => ({
						repository_id: binding.repositoryId,
						full_name: binding.fullName,
					}),
				),
			);
			return;
	}
	const reach = await reachOf(context, sessions);
	switch (table) {
		case "edges":
			for (const line of reach.edges.lines) yield redactJsonText(line);
			return;
		case "ci_jobs":
			yield* viewLines(
				context,
				reach.github.jobRuns,
				300,
				(batch) =>
					`SELECT * FROM ci_jobs WHERE ci_run_id IN ${inList(batch)} ORDER BY ci_run_id, job_id`,
			);
			return;
		case "github_prs":
			yield* objectLines(reach.github.prs);
			return;
		case "github_pr_commits":
			yield* objectLines(reach.github.prCommits);
			return;
		case "github_ci_run_prs":
			yield* objectLines(reach.github.links);
			return;
		case "github_ci_runs":
			yield* objectLines(reach.github.ciRuns);
			return;
		case "github_sha_candidates":
			yield* objectLines(reach.github.candidates);
	}
}

const STATIC_COLUMNS: Partial<Record<CliDataTable, readonly string[]>> = {
	records: RECORD_COLUMNS,
	setup_texts: SETUP_TEXT_COLUMNS,
	github_repositories: ["repository_id", "full_name"],
	github_sha_candidates: ["repository_id", "prefix", "shas"],
};

export async function* pullTable(
	context: CliDataContext,
	table: CliDataTable,
	sessionIds: readonly string[],
): AsyncGenerator<DataChunk> {
	try {
		const sessions = await visibleSessions(context, sessionIds);
		const notices: string[] = [];
		const missing = sessionIds.length - sessions.length;
		if (missing > 0)
			notices.push(
				`${missing} of ${sessionIds.length} sessions are not indexed or not yours to read; nothing of them is included.`,
			);
		const writer = new ChunkWriter(CLI_DATA_LIMITS.exportBytes, PULL_NARROW);
		let columns: readonly string[] | null = null;
		if (sessions.length > 0)
			for await (const line of tableLines(context, table, sessions)) {
				columns ??= Object.keys(JSON.parse(line) as Row);
				yield* writer.line(line);
			}
		yield* writer.flush();
		yield writer.done(columns ?? STATIC_COLUMNS[table] ?? [], notices);
	} catch (error) {
		throw asCliDataError(error, context);
	}
}
