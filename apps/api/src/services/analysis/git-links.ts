import type { AnalysisGitEvent } from "@rudel/api-routes";
import { z } from "zod";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	type CursorKey,
	type CursorOrder,
	compareKeys,
} from "./find-cursor.js";
import { runKey } from "./reactions.js";
import type { AnalysisSession, ScopeBatch } from "./scope.js";
import { ANALYSIS_QUERY_SETTINGS, query, records } from "./sql.js";

/**
 * Sessions joined to the pull requests and CI runs they touched. Events are
 * `session_git_observations` rows of the observation generation that matches
 * each session's indexed transcript (the newest one, marked not current, when
 * none does), plus the PRs GitHub listed for captured commits and the CLI's
 * capture commits. GitHub facts come from the workspace's active bindings and
 * the GitHub outcome tables. Every link keeps the rules that made it; counts
 * that could not be established completely are null (unknown), never zero: an
 * abbreviated SHA resolves only when exactly one collected SHA starts with it,
 * and an event that names a repository is never linked to another one.
 */

type GitEvent = AnalysisGitEvent;
type GitHubCoverage = GitEvent["github"];
type PullRequest = GitEvent["pullRequests"][number];
type CiRun = GitEvent["ciRuns"][number];
type CiEdge = CiRun["edges"][number];

export interface GitHubBinding {
	repositoryId: string;
	fullName: string;
}

export interface RepositoryCoverage {
	included: boolean;
	prFrom: string | null;
	ciFrom: string | null;
	/** End (exclusive) of the history every dataset holds without a gap. */
	coveredThrough: string | null;
	reason: string | null;
}

export interface GitHubAccess {
	visibility: "hidden" | "visible" | "preview";
	bindings: GitHubBinding[];
	repositories: Map<string, RepositoryCoverage>;
}

export interface SessionOwners {
	userId: string;
	sessionIds: readonly string[];
}

export interface SnapshotRow {
	/** Stable identity of the snapshot row. */
	originId: string;
	sessionId: string;
	repositoryId: string;
	pullNumber: number;
	commitSha: string;
	observedAt: string;
	coverageComplete: boolean;
	ciCoverageComplete: boolean;
}

export interface CaptureRow {
	/** Stable identity of the capture (its context id). */
	originId: string;
	sessionId: string;
	agentId: string;
	/** The GitHub repository id the capture names; null for other providers. */
	repositoryId: string | null;
	remote: string;
	lifecycle: string;
	baseCommit: string;
	headCommit: string;
	capturedAt: string;
}

/**
 * Evidence rows after a find cursor in the merged order (time descending,
 * then session, stream and origin call, by code unit), at most `limit` per
 * owner and kind. `after.call` is null when the cursor is a transcript event,
 * which sorts after every evidence row of its time, session and stream.
 */
export interface EvidencePage {
	after:
		| { at: string; sessionId: string; agentId: string; call: string | null }
		| undefined;
	limit: number;
}

/** Where GitHub access and session evidence come from (Postgres in production). */
export interface GitHubSource {
	access(organizationId: string): Promise<GitHubAccess>;
	evidence(
		organizationId: string,
		owners: readonly SessionOwners[],
		page: EvidencePage,
	): Promise<{ snapshots: SnapshotRow[]; captures: CaptureRow[] }>;
}

/** Observations scanned per find when `refs` or `model` select runs. */
export const GIT_EVENT_ROW_CAP = 20_000;
/** CI runs listed per event; `ciRunsObserved` counts all that were found. */
const CI_RUNS_PER_EVENT = 200;
/** A CI check that names a branch reads the branch's runs of the day before it. */
const BRANCH_RUN_WINDOW_MS = 86_400_000;
/** Runs read per checked branch and page; beyond it, older windows are unknown. */
const BRANCH_RUNS_CAP = 2_000;
/** A target's CI history is taken to start this long before its first sighting. */
const TARGET_LOOKBACK_MS = 86_400_000;

const ObservationSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	record_idx: z.coerce.number(),
	block_idx: z.coerce.number(),
	call_id: z.string(),
	kind: z.string(),
	label: z.string(),
	short_sha: z.string(),
	branch: z.string(),
	push_from_sha: z.string(),
	push_to_sha: z.string(),
	push_source_branch: z.string(),
	pr_repo: z.string(),
	pr_number: z.coerce.number(),
	commit_hash: z.string(),
	repository_url: z.string(),
	run_id: z.string(),
	ts_ms: z.coerce.number(),
});
export type ObservationRow = z.infer<typeof ObservationSchema>;

const ReceiptSchema = z.object({
	session_id: z.string(),
	revision_text: z.string(),
	parser_version: z.coerce.number(),
	transcript_parser_version: z.coerce.number(),
});
const TurnSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	record_idx: z.coerce.number(),
	block_idx: z.coerce.number(),
	turn_idx: z.coerce.number(),
});
/** An abbreviated SHA a session's commit observation created, and when. */
export interface SessionCommit {
	shortSha: string;
	atMs: number;
}
const SessionCommitSchema = z.object({
	session_id: z.string(),
	short_sha: z.string(),
	first_ms: z.coerce.number(),
});

/** CI status reads in a push's stream, relative to the push's record. */
export interface ChecksAfter {
	/** Later checks that ran. */
	count: number;
	/** Later checks the command does not show ran. */
	unconfirmed: number;
	/** Checks in the push's own record. */
	sameCall: number;
	/** The first later check that ran. */
	first: { record: number; atMs: number } | null;
}
const ChecksAfterSchema = z.object({
	push_session: z.string(),
	push_agent: z.string(),
	push_record: z.coerce.number(),
	ran: z.coerce.number(),
	unconfirmed: z.coerce.number(),
	same_call: z.coerce.number(),
	first_record: z.coerce.number(),
	first_ms: z.coerce.number(),
});
const ShaSchema = z.object({ repository_id: z.string(), sha: z.string() });
const MembershipSchema = z.object({
	repository_id: z.string(),
	sha: z.string(),
	pr_number: z.coerce.number(),
	last_seen_head_sha: z.string(),
});
const PullRequestRowSchema = z
	.object({
		repository_id: z.string(),
		number: z.coerce.number(),
		head_repository_id: z.string(),
		title: z.string(),
		state: z.string(),
		draft: z.coerce.boolean(),
		created_text: z.string(),
		merged_text: z.string().nullable(),
		closed_text: z.string().nullable(),
		head_ref: z.string(),
		head_sha: z.string(),
		merge_commit_sha: z.string(),
	})
	.transform(({ created_text, merged_text, closed_text, ...row }) => ({
		...row,
		created_at: created_text,
		merged_at: merged_text,
		closed_at: closed_text,
	}));
const CiRunRowSchema = z
	.object({
		repository_id: z.string(),
		run_kind: z.string(),
		run_id: z.string(),
		attempt: z.coerce.number(),
		workflow_name: z.string(),
		event: z.string(),
		head_branch: z.string(),
		head_sha: z.string(),
		status: z.string(),
		conclusion: z.string().nullable(),
		created_text: z.string(),
		started_text: z.string().nullable(),
		completed_text: z.string().nullable(),
		pr_number: z.coerce.number(),
		link_basis: z.string(),
	})
	.transform(
		({ run_kind, created_text, started_text, completed_text, ...row }) => ({
			...row,
			kind: run_kind,
			created_at: created_text,
			started_at: started_text,
			completed_at: completed_text,
		}),
	);
export type PullRequestRow = z.infer<typeof PullRequestRowSchema>;
export type CiRunRow = z.infer<typeof CiRunRowSchema>;

export interface ObservationGeneration {
	revision: string;
	parserVersion: number;
	transcriptParserVersion: number;
	/** The generation was extracted from the session's indexed transcript generation. */
	current: boolean;
}

/** An event before GitHub facts are added. */
export interface Seed {
	sessionId: string;
	agentId: string;
	record: number;
	block: number;
	/** Call id of a transcript event; stable origin id of an evidence event. */
	call: string;
	atMs: number;
	kind: GitEvent["kind"];
	label: string;
	branch: string;
	sourceBranch: string;
	shortSha: string;
	pushFrom: string;
	pushTo: string;
	remote: string;
	prRepo: string;
	prNumber: number;
	commitHash: string;
	baseCommit: string;
	runId: string;
	generation: ObservationGeneration | null;
	turn: number | null;
	/** GitHub repository id an evidence capture or snapshot names directly. */
	repositoryId: string | null;
}

/** What GitHub holds for a page of events, keyed for assembly. */
export interface GitHubFacts {
	/** `repositoryId|prefix` → distinct full SHAs starting with it. */
	shaCandidates: Map<string, string[]>;
	/** `repositoryId|sha` → PRs containing the commit. */
	memberships: Map<string, { prNumber: number; lastSeenHeadSha: string }[]>;
	/** `repositoryId|number` → PR. */
	pullRequests: Map<string, PullRequestRow>;
	/** `headRepositoryId|branch` → PR keys (`repositoryId|number`) with that head. */
	branchPullRequests: Map<string, string[]>;
	/** `repositoryId|sha` → CI runs on that head SHA. */
	shaRuns: Map<string, CiRunRow[]>;
	/** `repositoryId|number` → CI runs GitHub links to the PR. */
	pullRequestRuns: Map<string, CiRunRow[]>;
	/** `repositoryId|runId` → every attempt of the run. */
	namedRuns: Map<string, CiRunRow[]>;
	/** `repositoryId|branch` → CI runs on that head branch in the checks' windows, newest first. */
	branchRuns: Map<string, CiRunRow[]>;
	/**
	 * `repositoryId|branch` → creation time (ms) of the oldest run read when
	 * `BRANCH_RUNS_CAP` was reached; only windows starting after it are complete.
	 */
	branchRunsCappedAt: Map<string, number>;
}

export function emptyGitHubFacts(): GitHubFacts {
	return {
		shaCandidates: new Map(),
		memberships: new Map(),
		pullRequests: new Map(),
		branchPullRequests: new Map(),
		shaRuns: new Map(),
		pullRequestRuns: new Map(),
		namedRuns: new Map(),
		branchRuns: new Map(),
		branchRunsCappedAt: new Map(),
	};
}

export interface GitPageInput {
	executor: ClickHouseExecutor;
	organizationId: string;
	batches: readonly ScopeBatch[];
	/** Sessions without a committed transcript generation, per owner. */
	unindexed: readonly {
		scope: ScopeBatch["scope"];
		sessions: AnalysisSession[];
	}[];
	sessions: ReadonlyMap<string, AnalysisSession>;
	/** Run keys `refs`/`model` selected; null when every run of the scope counts. */
	runKeys: ReadonlySet<string> | null;
	after: CursorKey | undefined;
	order: CursorOrder;
	limit: number;
	source: GitHubSource;
}

export interface GitPage {
	events: GitEvent[];
	keys: CursorKey[];
	more: boolean;
	notes: string[];
	truncated: boolean;
}

/** One page of the scope's git events, newest first, with their GitHub links. */
export async function loadGitPage(input: GitPageInput): Promise<GitPage> {
	const notes: string[] = [];
	const generations = await loadObservationGenerations(
		input.executor,
		input.batches,
	);
	const access = await input.source.access(input.organizationId);
	const observed = await collectObservationSeeds(input, generations);
	const evidence =
		access.visibility === "hidden" || input.runKeys
			? { snapshots: [], captures: [] }
			: await input.source.evidence(
					input.organizationId,
					[...input.batches, ...input.unindexed].map((group) => ({
						userId: group.scope.userId,
						sessionIds: group.sessions.map((session) => session.session_id),
					})),
					{
						after:
							input.after === undefined
								? undefined
								: {
										at: String(input.after[0]),
										sessionId: String(input.after[1] ?? ""),
										agentId: String(input.after[2] ?? ""),
										call:
											Number(input.after[3] ?? 0) === 0
												? String(input.after[5] ?? "")
												: null,
									},
						limit: input.limit + 1,
					},
				);
	const ordered = [
		...observed.seeds,
		...evidenceSeeds(evidence.snapshots, evidence.captures),
	]
		.map((seed) => ({ seed, key: seedKey(seed) }))
		.filter(
			({ key: position }) =>
				input.after === undefined ||
				compareKeys(position, input.after, input.order) > 0,
		)
		.sort((left, right) => compareKeys(left.key, right.key, input.order));
	const page = ordered.slice(0, input.limit).map(({ seed }) => seed);
	const more = ordered.length > input.limit || observed.more;
	if (!input.runKeys) await addTurns(input.executor, input.batches, page);
	const checks = await loadChecksAfter(
		input.executor,
		input.batches,
		generations,
		page,
	);
	const resolved = page.map((seed) => ({
		seed,
		...resolveRepository(
			seed,
			input.sessions.get(seed.sessionId)?.repository ?? "",
			access,
		),
	}));
	const facts = await loadGitHubFacts(
		input.executor,
		input.organizationId,
		gitHubNeeds(resolved),
		access.bindings.map((binding) => binding.repositoryId),
	);
	const commits = await loadSessionCommits(
		input.executor,
		input.batches,
		generations,
		page,
	);
	const events = assembleGitEvents(
		resolved,
		facts,
		checks,
		input.sessions,
		access,
		commits,
	);

	if (observed.filtered > 0)
		notes.push(
			`${observed.filtered} scanned events are outside the selected runs (or have no known run); captures and snapshots are left out when refs or model select runs`,
		);
	if (observed.capped)
		notes.push(
			`git event scan ceiling reached (${GIT_EVENT_ROW_CAP} events) before the page filled; continue with the cursor`,
		);
	const sessionIds = [...input.sessions.keys()];
	const missing = sessionIds.filter((id) => !generations.has(id)).length;
	if (missing > 0)
		notes.push(
			`${missing} of the ${sessionIds.length} sessions in scope have no git observations extracted yet; their transcript events are unknown, not absent`,
		);
	const stale = [...generations.values()].filter(
		(generation) => !generation.current,
	).length;
	if (stale > 0)
		notes.push(
			`${stale} sessions' git observations come from an older transcript generation than the one indexed (generation.current=false)`,
		);
	if (access.visibility === "hidden")
		notes.push(
			"GitHub outcomes are not visible for this workspace: events show what the transcripts recorded; PRs, CI runs and captures are unknown",
		);
	else if (access.visibility === "preview")
		notes.push(
			"GitHub history is still being collected for this workspace (preview): CI counts are unknown (null) and found runs are a lower bound",
		);
	const byStatus = new Map<string, number>();
	for (const event of events)
		byStatus.set(
			event.github.status,
			(byStatus.get(event.github.status) ?? 0) + 1,
		);
	for (const [status, count] of byStatus)
		if (status !== "linked")
			notes.push(
				`${count} events have github.status=${status}; their CI counts are unknown (null) and what was found is a lower bound`,
			);
	const unknownCounts = new Map<string, number>();
	for (const event of events)
		if (event.ciRunCountUnknown && event.ciRunCountUnknown !== "github_status")
			unknownCounts.set(
				event.ciRunCountUnknown,
				(unknownCounts.get(event.ciRunCountUnknown) ?? 0) + 1,
			);
	for (const [reason, count] of unknownCounts)
		notes.push(
			`${count} events have ciRunCount=null (ciRunCountUnknown=${reason}); what was found is a lower bound`,
		);
	const ambiguous = events.filter(
		(event) => (event.sha?.candidates ?? 0) > 1,
	).length;
	if (ambiguous > 0)
		notes.push(
			`${ambiguous} abbreviated SHAs match more than one commit; they stay unresolved (sha.candidates)`,
		);
	if (events.some((event) => event.ciRunsObserved > event.ciRuns.length))
		notes.push(
			`some events have more than ${CI_RUNS_PER_EVENT} CI runs; ciRuns lists the newest, ciRunsObserved counts all found`,
		);
	// A capped scan continues after the last event it scanned, not the last one kept.
	const keys = page.map(seedKey);
	if (observed.boundary && ordered.length <= input.limit)
		keys.push(observed.boundary);
	return {
		events,
		keys,
		more,
		notes,
		truncated: observed.capped,
	};
}

/**
 * Transcript events after the cursor, newest first. Without a run filter one
 * page is read; with one, pages are scanned until the page fills, the scope
 * ends or `GIT_EVENT_ROW_CAP` events were read (the cursor then continues).
 */
async function collectObservationSeeds(
	input: GitPageInput,
	generations: ReadonlyMap<string, ObservationGeneration>,
): Promise<{
	seeds: Seed[];
	more: boolean;
	filtered: number;
	capped: boolean;
	/** Where a capped scan stopped; the cursor resumes after it. */
	boundary?: CursorKey;
}> {
	const chunk = input.runKeys
		? Math.max(4 * (input.limit + 1), 200)
		: input.limit + 1;
	const kept: Seed[] = [];
	let after = input.after;
	let scanned = 0;
	let filtered = 0;
	for (;;) {
		const rows: ObservationRow[] = [];
		for (const batch of input.batches)
			rows.push(
				...(await queryObservations(input.executor, batch, generations, {
					after,
					limit: chunk,
				})),
			);
		const seeds = rows
			.map((row) => observationSeed(row, generations))
			.sort((left, right) =>
				compareKeys(seedKey(left), seedKey(right), input.order),
			)
			.slice(0, chunk);
		if (!input.runKeys)
			return { seeds, more: false, filtered: 0, capped: false };
		if (seeds.length === 0)
			return { seeds: kept, more: false, filtered, capped: false };
		await addTurns(input.executor, input.batches, seeds);
		const runKeys = input.runKeys;
		for (const seed of seeds)
			if (
				seed.turn !== null &&
				runKeys.has(
					runKey({
						sessionId: seed.sessionId,
						agentId: seed.agentId,
						turn: seed.turn,
					}),
				)
			)
				kept.push(seed);
			else filtered++;
		scanned += seeds.length;
		const last = seeds.at(-1);
		if (kept.length > input.limit || seeds.length < chunk || !last)
			return { seeds: kept, more: false, filtered, capped: false };
		if (scanned >= GIT_EVENT_ROW_CAP)
			return {
				seeds: kept,
				more: true,
				filtered,
				capped: true,
				boundary: seedKey(last),
			};
		after = seedKey(last);
	}
}

/**
 * Per session, the observation generation extracted from its indexed
 * transcript generation, else its newest one (not current).
 */
export async function loadObservationGenerations(
	executor: ClickHouseExecutor,
	batches: readonly ScopeBatch[],
): Promise<Map<string, ObservationGeneration>> {
	const chosen = new Map<string, ObservationGeneration>();
	for (const batch of batches) {
		const sessionIds = batch.sessions.map((session) => session.session_id);
		if (sessionIds.length === 0) continue;
		const receipts = await query(executor, ReceiptSchema, {
			query: `SELECT session_id, toString(revision) AS revision_text, parser_version, transcript_parser_version
				FROM rudel.session_git_observations FINAL
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND session_id IN {sessionIds:Array(String)} AND kind = 'receipt'`,
			query_params: {
				organizationId: batch.scope.organizationId,
				userId: batch.scope.userId,
				sessionIds,
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		const indexed = new Map(
			batch.generations.map((generation) => [generation.sessionId, generation]),
		);
		for (const sessionId of sessionIds) {
			const transcript = indexed.get(sessionId);
			const newestFirst = receipts
				.filter((receipt) => receipt.session_id === sessionId)
				.sort(
					(left, right) =>
						compareRevision(right.revision_text, left.revision_text) ||
						right.parser_version - left.parser_version,
				);
			const current = newestFirst.find(
				(receipt) =>
					transcript !== undefined &&
					receipt.revision_text === transcript.revision &&
					receipt.transcript_parser_version === transcript.parserVersion,
			);
			const pick = current ?? newestFirst[0];
			if (pick)
				chosen.set(sessionId, {
					revision: pick.revision_text,
					parserVersion: pick.parser_version,
					transcriptParserVersion: pick.transcript_parser_version,
					current: current !== undefined,
				});
		}
	}
	return chosen;
}

async function queryObservations(
	executor: ClickHouseExecutor,
	batch: ScopeBatch,
	generations: ReadonlyMap<string, ObservationGeneration>,
	options: { after: CursorKey | undefined; limit: number },
): Promise<ObservationRow[]> {
	const pinned = batch.sessions.flatMap((session) => {
		const generation = generations.get(session.session_id);
		return generation ? [[session.session_id, generation] as const] : [];
	});
	if (pinned.length === 0) return [];
	const after = options.after;
	return query(executor, ObservationSchema, {
		query: `SELECT session_id, agent_id, record_idx, block_idx, call_id, kind, label, short_sha, branch,
				push_from_sha, push_to_sha, push_source_branch, pr_repo, pr_number, commit_hash,
				repository_url, run_id, toUnixTimestamp64Milli(ts) AS ts_ms
			FROM rudel.session_git_observations FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id IN {sessionIds:Array(String)} AND kind != 'receipt'
				AND (session_id, toString(revision), parser_version) IN (
					SELECT g.1, g.2, g.3 FROM (SELECT arrayJoin(arrayZip(
						{genSessions:Array(String)}, {genRevisions:Array(String)}, {genParsers:Array(UInt16)})) AS g))
				${
					after
						? `AND (toUnixTimestamp64Milli(ts) < {afterMs:Int64}
					OR (toUnixTimestamp64Milli(ts) = {afterMs:Int64}
						AND (session_id, agent_id, record_idx, block_idx) > ({afterSession:String}, {afterAgent:String}, {afterRecord:UInt32}, {afterBlock:UInt32})))`
						: ""
				}
			ORDER BY ts_ms DESC, session_id, agent_id, record_idx, block_idx
			LIMIT {limit:UInt32}`,
		query_params: {
			organizationId: batch.scope.organizationId,
			userId: batch.scope.userId,
			sessionIds: pinned.map(([sessionId]) => sessionId),
			genSessions: pinned.map(([sessionId]) => sessionId),
			genRevisions: pinned.map(([, generation]) => generation.revision),
			genParsers: pinned.map(([, generation]) => generation.parserVersion),
			limit: options.limit,
			...(after
				? {
						afterMs: Date.parse(String(after[0])),
						afterSession: String(after[1] ?? ""),
						afterAgent: String(after[2] ?? ""),
						afterRecord: Number(after[3] ?? 0),
						afterBlock: Number(after[4] ?? 0),
					}
				: {}),
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
}

/** Sets each observation's run from its pinned `transcript_records` result row. */
async function addTurns(
	executor: ClickHouseExecutor,
	batches: readonly ScopeBatch[],
	seeds: Seed[],
): Promise<void> {
	for (const batch of batches) {
		const own = new Set(batch.sessions.map((session) => session.session_id));
		const targets = seeds.filter(
			(seed) => seed.generation !== null && own.has(seed.sessionId),
		);
		if (targets.length === 0) continue;
		const rows = await query(executor, TurnSchema, {
			query: `SELECT session_id, agent_id, record_idx, block_idx, turn_idx
				FROM ${records()} FINAL
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND session_id IN {sessionIds:Array(String)}
					AND (session_id, agent_id, toString(revision), parser_version, record_idx, block_idx) IN (
						SELECT k.1, k.2, k.3, k.4, k.5, k.6 FROM (SELECT arrayJoin(arrayZip(
							{keySessions:Array(String)}, {keyAgents:Array(String)}, {keyRevisions:Array(String)},
							{keyParsers:Array(UInt16)}, {keyRecords:Array(UInt32)}, {keyBlocks:Array(UInt16)})) AS k))`,
			query_params: {
				organizationId: batch.scope.organizationId,
				userId: batch.scope.userId,
				sessionIds: [...new Set(targets.map((seed) => seed.sessionId))],
				keySessions: targets.map((seed) => seed.sessionId),
				keyAgents: targets.map((seed) => seed.agentId),
				keyRevisions: targets.map((seed) => seed.generation?.revision ?? ""),
				keyParsers: targets.map(
					(seed) => seed.generation?.transcriptParserVersion ?? 0,
				),
				keyRecords: targets.map((seed) => seed.record),
				keyBlocks: targets.map((seed) => nativeBlock(seed.block)),
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		const turns = new Map(
			rows.map((row) => [
				JSON.stringify([
					row.session_id,
					row.agent_id,
					row.record_idx,
					row.block_idx,
				]),
				row.turn_idx,
			]),
		);
		for (const seed of targets) {
			const turn = turns.get(
				JSON.stringify([
					seed.sessionId,
					seed.agentId,
					seed.record,
					nativeBlock(seed.block),
				]),
			);
			seed.turn = turn !== undefined && turn >= 1 ? turn : null;
		}
	}
}

/**
 * For each push on the page, the CI status reads of its stream in the pinned
 * generation, counted in ClickHouse over all of them, keyed by `pushKey`.
 */
async function loadChecksAfter(
	executor: ClickHouseExecutor,
	batches: readonly ScopeBatch[],
	generations: ReadonlyMap<string, ObservationGeneration>,
	page: readonly Seed[],
): Promise<Map<string, ChecksAfter>> {
	const checks = new Map<string, ChecksAfter>();
	const pushes = new Map(
		page
			.filter((seed) => seed.kind === "push_range" && seed.generation)
			.map((seed) => [pushKey(seed), seed]),
	);
	for (const batch of batches) {
		const own = new Set(batch.sessions.map((session) => session.session_id));
		const targets = [...pushes.values()].filter((seed) =>
			own.has(seed.sessionId),
		);
		const pinned = [...new Set(targets.map((seed) => seed.sessionId))].flatMap(
			(sessionId) => {
				const generation = generations.get(sessionId);
				return generation ? [[sessionId, generation] as const] : [];
			},
		);
		if (targets.length === 0 || pinned.length === 0) continue;
		const ran =
			"c.record_idx > pushes.push_record AND c.label != 'unconfirmed'";
		const rows = await query(executor, ChecksAfterSchema, {
			query: `SELECT pushes.push_session AS push_session, pushes.push_agent AS push_agent,
					pushes.push_record AS push_record,
					countIf(${ran}) AS ran,
					countIf(c.record_idx > pushes.push_record AND c.label = 'unconfirmed') AS unconfirmed,
					countIf(c.record_idx = pushes.push_record) AS same_call,
					minIf(c.record_idx, ${ran}) AS first_record,
					argMinIf(toUnixTimestamp64Milli(c.ts), c.record_idx, ${ran}) AS first_ms
				FROM (
					SELECT p.1 AS push_session, p.2 AS push_agent, p.3 AS push_record
					FROM (SELECT arrayJoin(arrayZip(
						{pushSessions:Array(String)}, {pushAgents:Array(String)}, {pushRecords:Array(UInt32)})) AS p)
				) AS pushes
				INNER JOIN (
					SELECT session_id, agent_id, record_idx, label, ts
					FROM rudel.session_git_observations FINAL
					WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
						AND session_id IN {sessionIds:Array(String)} AND kind = 'ci_check'
						AND (session_id, toString(revision), parser_version) IN (
							SELECT g.1, g.2, g.3 FROM (SELECT arrayJoin(arrayZip(
								{genSessions:Array(String)}, {genRevisions:Array(String)}, {genParsers:Array(UInt16)})) AS g))
				) AS c ON c.session_id = pushes.push_session AND c.agent_id = pushes.push_agent
				GROUP BY pushes.push_session, pushes.push_agent, pushes.push_record`,
			query_params: {
				organizationId: batch.scope.organizationId,
				userId: batch.scope.userId,
				sessionIds: pinned.map(([sessionId]) => sessionId),
				genSessions: pinned.map(([sessionId]) => sessionId),
				genRevisions: pinned.map(([, generation]) => generation.revision),
				genParsers: pinned.map(([, generation]) => generation.parserVersion),
				pushSessions: targets.map((seed) => seed.sessionId),
				pushAgents: targets.map((seed) => seed.agentId),
				pushRecords: targets.map((seed) => seed.record),
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		for (const row of rows)
			checks.set(
				JSON.stringify([row.push_session, row.push_agent, row.push_record]),
				{
					count: row.ran,
					unconfirmed: row.unconfirmed,
					sameCall: row.same_call,
					first:
						row.ran > 0
							? { record: row.first_record, atMs: row.first_ms }
							: null,
				},
			);
	}
	return checks;
}

/**
 * For the sessions of a page's events, the abbreviated SHAs their pinned
 * commit observations created, with the first time each was created.
 */
async function loadSessionCommits(
	executor: ClickHouseExecutor,
	batches: readonly ScopeBatch[],
	generations: ReadonlyMap<string, ObservationGeneration>,
	page: readonly Seed[],
): Promise<Map<string, SessionCommit[]>> {
	const commits = new Map<string, SessionCommit[]>();
	const wanted = new Set(
		page
			.filter((seed) => seed.kind !== "commit_created")
			.map((seed) => seed.sessionId),
	);
	for (const batch of batches) {
		const pinned = batch.sessions.flatMap((session) => {
			const generation = generations.get(session.session_id);
			return generation && wanted.has(session.session_id)
				? [[session.session_id, generation] as const]
				: [];
		});
		if (pinned.length === 0) continue;
		const rows = await query(executor, SessionCommitSchema, {
			query: `SELECT session_id, short_sha, min(toUnixTimestamp64Milli(ts)) AS first_ms
				FROM rudel.session_git_observations FINAL
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND session_id IN {sessionIds:Array(String)} AND kind = 'commit_created' AND short_sha != ''
					AND (session_id, toString(revision), parser_version) IN (
						SELECT g.1, g.2, g.3 FROM (SELECT arrayJoin(arrayZip(
							{genSessions:Array(String)}, {genRevisions:Array(String)}, {genParsers:Array(UInt16)})) AS g))
				GROUP BY session_id, short_sha`,
			query_params: {
				organizationId: batch.scope.organizationId,
				userId: batch.scope.userId,
				sessionIds: pinned.map(([sessionId]) => sessionId),
				genSessions: pinned.map(([sessionId]) => sessionId),
				genRevisions: pinned.map(([, generation]) => generation.revision),
				genParsers: pinned.map(([, generation]) => generation.parserVersion),
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		for (const row of rows)
			push(commits, row.session_id, {
				shortSha: row.short_sha.toLowerCase(),
				atMs: row.first_ms,
			});
	}
	return commits;
}

/**
 * When the session created a full SHA: its earliest commit observation whose
 * abbreviation (at least 7 characters, unique in the repository git printed
 * it from) the SHA starts with.
 */
function createdInSession(
	commits: readonly SessionCommit[],
	fullSha: string,
): number | undefined {
	const times = commits
		.filter(
			(commit) =>
				commit.shortSha.length >= 7 && fullSha.startsWith(commit.shortSha),
		)
		.map((commit) => commit.atMs);
	return times.length > 0 ? Math.min(...times) : undefined;
}

/**
 * GitHub facts for the repositories, SHAs, PRs, runs and branches a page of
 * events names, within the workspace's authorized (actively bound) repositories:
 * a fork PR is found through its base repository when that one is bound.
 */
export async function loadGitHubFacts(
	executor: ClickHouseExecutor,
	organizationId: string,
	needs: GitHubNeeds,
	authorizedRepositoryIds: readonly string[],
): Promise<GitHubFacts> {
	const facts = emptyGitHubFacts();
	if (needs.repositoryIds.size === 0 || authorizedRepositoryIds.length === 0)
		return facts;
	const statement = (sql: string, params: Record<string, unknown>) => ({
		query: sql,
		query_params: {
			workspaceId: organizationId,
			repositoryIds: [...authorizedRepositoryIds],
			...params,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});

	const byLength = new Map<string, [string, string][]>();
	for (const entry of needs.prefixes) {
		const [repositoryId, prefix] = splitKey(entry);
		push(byLength, String(prefix.length), [repositoryId, prefix]);
	}
	if (byLength.size > 0) {
		const conditions: string[] = [];
		// Every collected SHA of the repositories, whatever its date, so a
		// unique match is unique in the collection.
		const params: Record<string, unknown> = {
			prefixRepoSet: [
				...new Set([...needs.prefixes].map((entry) => splitKey(entry)[0])),
			],
		};
		[...byLength.entries()].forEach(([length, pairs], index) => {
			conditions.push(
				`has(arrayZip({prefixRepos${index}:Array(String)}, {prefixValues${index}:Array(String)}), (repository_id, substring(sha, 1, ${Number(length)})))`,
			);
			params[`prefixRepos${index}`] = pairs.map(
				([repositoryId]) => repositoryId,
			);
			params[`prefixValues${index}`] = pairs.map(([, prefix]) => prefix);
		});
		const shaRows = await query(
			executor,
			ShaSchema,
			statement(
				`SELECT DISTINCT repository_id, sha FROM (
					SELECT repository_id, sha FROM rudel.github_pull_request_commits FINAL
						WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND has({repositoryIds:Array(String)}, repository_id)
							AND repository_id IN {prefixRepoSet:Array(String)}
					UNION ALL
					SELECT repository_id, head_sha AS sha FROM rudel.github_pull_requests FINAL
						WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND has({repositoryIds:Array(String)}, repository_id)
							AND repository_id IN {prefixRepoSet:Array(String)}
					UNION ALL
					SELECT repository_id, head_sha AS sha FROM rudel.github_ci_runs FINAL
						WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND has({repositoryIds:Array(String)}, repository_id)
							AND repository_id IN {prefixRepoSet:Array(String)}
				)
				WHERE sha != '' AND (${conditions.join(" OR ")})`,
				params,
			),
		);
		for (const entry of needs.prefixes) {
			const [repositoryId, prefix] = splitKey(entry);
			facts.shaCandidates.set(
				entry,
				shaRows
					.filter(
						(row) =>
							row.repository_id === repositoryId && row.sha.startsWith(prefix),
					)
					.map((row) => row.sha),
			);
		}
	}

	const shas = new Set(needs.fullShas);
	for (const [entry, candidates] of facts.shaCandidates)
		if (candidates.length === 1)
			shas.add(key(splitKey(entry)[0], candidates[0] ?? ""));
	const pullRequestKeys = new Set(needs.pullRequests);
	if (shas.size > 0) {
		const pairs = [...shas].map(splitKey);
		const memberships = await query(
			executor,
			MembershipSchema,
			statement(
				`SELECT repository_id, sha, pr_number, last_seen_head_sha FROM rudel.github_pull_request_commits FINAL
					WHERE workspace_id = {workspaceId:String} AND provider = 'github'
						AND has({repositoryIds:Array(String)}, repository_id)
						AND has(arrayZip({shaRepos:Array(String)}, {shaValues:Array(String)}), (repository_id, sha))`,
				{
					shaRepos: pairs.map(([repositoryId]) => repositoryId),
					shaValues: pairs.map(([, sha]) => sha),
				},
			),
		);
		for (const row of memberships) {
			push(facts.memberships, key(row.repository_id, row.sha), {
				prNumber: row.pr_number,
				lastSeenHeadSha: row.last_seen_head_sha,
			});
			pullRequestKeys.add(key(row.repository_id, row.pr_number));
		}
	}

	const numbers = [...pullRequestKeys].map(splitKey);
	const branches = [...needs.branches].map(splitKey);
	if (numbers.length > 0 || branches.length > 0) {
		const pullRequests = await query(
			executor,
			PullRequestRowSchema,
			statement(
				`SELECT repository_id, number, head_repository_id, title, state, draft,
					toString(created_at) AS created_text,
					if(isNull(merged_at), NULL, toString(merged_at)) AS merged_text,
					if(isNull(closed_at), NULL, toString(closed_at)) AS closed_text,
					head_ref, head_sha, merge_commit_sha
				FROM rudel.github_pull_requests FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github'
					AND has({repositoryIds:Array(String)}, repository_id)
					AND (has(arrayZip({numberRepos:Array(String)}, {numberValues:Array(UInt32)}), (repository_id, number))
						OR has(arrayZip({branchRepos:Array(String)}, {branchValues:Array(String)}), (if(head_repository_id = '', repository_id, head_repository_id), head_ref)))`,
				{
					numberRepos: numbers.map(([repositoryId]) => repositoryId),
					numberValues: numbers.map(([, number]) => Number(number)),
					branchRepos: branches.map(([repositoryId]) => repositoryId),
					branchValues: branches.map(([, branch]) => branch),
				},
			),
		);
		for (const row of pullRequests) {
			const prKey = key(row.repository_id, row.number);
			facts.pullRequests.set(prKey, row);
			pullRequestKeys.add(prKey);
			push(
				facts.branchPullRequests,
				key(row.head_repository_id || row.repository_id, row.head_ref),
				prKey,
			);
		}
	}

	for (const pr of facts.pullRequests.values())
		if (pr.merge_commit_sha)
			shas.add(key(pr.repository_id, pr.merge_commit_sha));
	const runColumns = `repository_id, toString(kind) AS run_kind, run_id, attempt, workflow_name, event, head_branch,
		head_sha, status, conclusion, toString(created_at) AS created_text,
		if(isNull(run_started_at), NULL, toString(run_started_at)) AS started_text,
		if(isNull(completed_at), NULL, toString(completed_at)) AS completed_text`;
	if (shas.size > 0) {
		// Every collected run on the SHAs, whatever its date: a session may
		// inspect a commit tested long before it.
		const pairs = [...shas].map(splitKey);
		const runs = await query(
			executor,
			CiRunRowSchema,
			statement(
				`SELECT ${runColumns}, toUInt32(0) AS pr_number, '' AS link_basis
				FROM rudel.github_ci_runs FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND kind != 'check_suite'
					AND has({repositoryIds:Array(String)}, repository_id)
					AND repository_id IN {shaRepoSet:Array(String)}
					AND has(arrayZip({shaRepos:Array(String)}, {shaValues:Array(String)}), (repository_id, head_sha))`,
				{
					shaRepoSet: [...new Set(pairs.map(([repositoryId]) => repositoryId))],
					shaRepos: pairs.map(([repositoryId]) => repositoryId),
					shaValues: pairs.map(([, sha]) => sha),
				},
			),
		);
		for (const row of runs)
			push(facts.shaRuns, key(row.repository_id, row.head_sha), row);
	}
	if (needs.branchRuns.size > 0) {
		const windows = [...needs.branchRuns.entries()];
		const pairs = windows.map(([entry]) => splitKey(entry));
		const runs = await query(
			executor,
			CiRunRowSchema,
			statement(
				`SELECT ${runColumns}, toUInt32(0) AS pr_number, '' AS link_basis
				FROM rudel.github_ci_runs FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND kind != 'check_suite'
					AND has({repositoryIds:Array(String)}, repository_id)
					AND repository_id IN {branchRepoSet:Array(String)}
					AND created_at >= toDateTime64({branchFrom:String}, 3, 'UTC') AND created_at <= toDateTime64({branchTo:String}, 3, 'UTC')
					AND has(arrayZip({branchRepos:Array(String)}, {branchNames:Array(String)}), (repository_id, head_branch))
				ORDER BY created_at DESC, run_id, attempt
				LIMIT {branchCap:UInt32} BY repository_id, head_branch`,
				{
					branchRepoSet: [
						...new Set(pairs.map(([repositoryId]) => repositoryId)),
					],
					branchRepos: pairs.map(([repositoryId]) => repositoryId),
					branchNames: pairs.map(([, branch]) => branch),
					branchFrom: clickHouseTime(
						Math.min(...windows.map(([, window]) => window.fromMs)),
					),
					branchTo: clickHouseTime(
						Math.max(...windows.map(([, window]) => window.toMs)),
					),
					branchCap: BRANCH_RUNS_CAP + 1,
				},
			),
		);
		for (const row of runs)
			push(facts.branchRuns, key(row.repository_id, row.head_branch), row);
		for (const [branchKey, rows] of facts.branchRuns)
			if (rows.length > BRANCH_RUNS_CAP) {
				rows.length = BRANCH_RUNS_CAP;
				const oldest = rows.at(-1);
				if (oldest)
					facts.branchRunsCappedAt.set(
						branchKey,
						githubTimeMs(oldest.created_at),
					);
			}
	}
	if (needs.runIds.size > 0) {
		const pairs = [...needs.runIds].map(splitKey);
		const runs = await query(
			executor,
			CiRunRowSchema,
			statement(
				`SELECT ${runColumns}, toUInt32(0) AS pr_number, '' AS link_basis
				FROM rudel.github_ci_runs FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND kind = 'actions_run'
					AND has({repositoryIds:Array(String)}, repository_id)
					AND has(arrayZip({runRepos:Array(String)}, {runValues:Array(String)}), (repository_id, run_id))`,
				{
					runRepos: pairs.map(([repositoryId]) => repositoryId),
					runValues: pairs.map(([, runId]) => runId),
				},
			),
		);
		for (const row of runs)
			push(facts.namedRuns, key(row.repository_id, row.run_id), row);
	}
	if (pullRequestKeys.size > 0) {
		const pairs = [...pullRequestKeys].map(splitKey);
		const runs = await query(
			executor,
			CiRunRowSchema,
			statement(
				`WITH links AS (
					SELECT repository_id, pr_number, kind, run_id, attempt, run_created_at, toString(basis) AS link_basis
					FROM rudel.github_ci_run_pull_requests FINAL
					WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND kind != 'check_suite'
						AND has({repositoryIds:Array(String)}, repository_id)
						AND has(arrayZip({prRepos:Array(String)}, {prNumbers:Array(UInt32)}), (repository_id, pr_number))
				)
				SELECT r.repository_id AS repository_id, toString(r.kind) AS run_kind, r.run_id AS run_id, r.attempt AS attempt,
					r.workflow_name AS workflow_name, r.event AS event, r.head_branch AS head_branch, r.head_sha AS head_sha,
					r.status AS status, r.conclusion AS conclusion, toString(r.created_at) AS created_text,
					if(isNull(r.run_started_at), NULL, toString(r.run_started_at)) AS started_text,
					if(isNull(r.completed_at), NULL, toString(r.completed_at)) AS completed_text,
					l.pr_number AS pr_number, l.link_basis AS link_basis
				FROM (
					SELECT * FROM rudel.github_ci_runs FINAL
					WHERE workspace_id = {workspaceId:String} AND provider = 'github' AND kind != 'check_suite'
						AND has({repositoryIds:Array(String)}, repository_id)
						AND created_at >= (SELECT min(run_created_at) FROM links)
						AND created_at <= (SELECT max(run_created_at) FROM links)
				) AS r
				INNER JOIN links AS l
					ON r.repository_id = l.repository_id AND r.kind = l.kind AND r.run_id = l.run_id AND r.attempt = l.attempt`,
				{
					prRepos: pairs.map(([repositoryId]) => repositoryId),
					prNumbers: pairs.map(([, number]) => Number(number)),
				},
			),
		);
		for (const row of runs)
			push(facts.pullRequestRuns, key(row.repository_id, row.pr_number), row);
	}
	return facts;
}

/** What `loadGitHubFacts` must read for a page of events. */
export interface GitHubNeeds {
	repositoryIds: Set<string>;
	/** `repositoryId|prefix` of abbreviated SHAs. */
	prefixes: Set<string>;
	/** `repositoryId|sha` of full SHAs (Codex HEAD, captured commits, check commits). */
	fullShas: Set<string>;
	/** `repositoryId|number` of PRs the events name. */
	pullRequests: Set<string>;
	/** `headRepositoryId|branch` of pushed or checked branches. */
	branches: Set<string>;
	/** `repositoryId|runId` of runs CI checks name. */
	runIds: Set<string>;
	/** `repositoryId|branch` of branches CI checks name → the span of their run windows. */
	branchRuns: Map<string, { fromMs: number; toMs: number }>;
}

export interface Resolved {
	seed: Seed;
	repository: GitEvent["repository"];
	github: GitHubCoverage;
}

/**
 * The repository an event names, or its session's remote when it names none;
 * an event that names a repository without an active binding is never linked
 * to another one.
 */
export function resolveRepository(
	seed: Seed,
	sessionRemote: string,
	access: GitHubAccess,
): Omit<Resolved, "seed"> {
	if (access.visibility === "hidden")
		return { repository: null, github: coverage("not_visible") };
	if (seed.repositoryId !== null) {
		const binding = access.bindings.find(
			(candidate) => candidate.repositoryId === seed.repositoryId,
		);
		return binding
			? linked(binding, "capture", seed.remote || binding.fullName, access)
			: { repository: null, github: coverage("unbound") };
	}
	const own = eventRepository(seed);
	if (own) return fromLiteral(own, "event", access);
	if (seed.kind === "evidence_capture")
		return { repository: null, github: coverage("not_github") };
	if (sessionRemote) return fromLiteral(sessionRemote, "session", access);
	return { repository: null, github: coverage("no_repository") };
}

export function gitHubNeeds(resolved: readonly Resolved[]): GitHubNeeds {
	const needs: GitHubNeeds = {
		repositoryIds: new Set(),
		prefixes: new Set(),
		fullShas: new Set(),
		pullRequests: new Set(),
		branches: new Set(),
		runIds: new Set(),
		branchRuns: new Map(),
	};
	for (const { seed, repository, github } of resolved) {
		if (!repository || !queried(github)) continue;
		needs.repositoryIds.add(repository.id);
		const prefix = seedPrefix(seed);
		if (prefix) needs.prefixes.add(key(repository.id, prefix));
		const full = seedFullSha(seed);
		if (full) needs.fullShas.add(key(repository.id, full));
		if (seed.prNumber > 0)
			needs.pullRequests.add(key(repository.id, seed.prNumber));
		const branch = seedBranch(seed);
		if (branch) needs.branches.add(key(repository.id, branchName(branch)));
		if (seed.kind === "ci_check" && seed.runId)
			needs.runIds.add(key(repository.id, seed.runId));
		if (seed.kind === "ci_check" && branch) {
			const branchKey = key(repository.id, branchName(branch));
			const window = needs.branchRuns.get(branchKey);
			needs.branchRuns.set(branchKey, {
				fromMs: Math.min(
					window?.fromMs ?? Number.POSITIVE_INFINITY,
					seed.atMs - BRANCH_RUN_WINDOW_MS,
				),
				toMs: Math.max(window?.toMs ?? 0, seed.atMs),
			});
		}
	}
	return needs;
}

/** The events with their GitHub links. */
export function assembleGitEvents(
	resolved: readonly Resolved[],
	facts: GitHubFacts,
	checks: ReadonlyMap<string, ChecksAfter>,
	sessions: ReadonlyMap<string, Pick<AnalysisSession, "parentSessionId">>,
	access: GitHubAccess,
	/** Per session, the abbreviated SHAs its commit observations created, first time each. */
	commits: ReadonlyMap<string, readonly SessionCommit[]> = new Map(),
): GitEvent[] {
	return resolved.map(({ seed, repository, github }) => {
		const queriedRepository = repository !== null && queried(github);
		const prefix = seedPrefix(seed);
		const candidates =
			queriedRepository && repository && prefix
				? (facts.shaCandidates.get(key(repository.id, prefix)) ?? [])
				: null;
		const sha = prefix
			? {
					value: candidates?.length === 1 ? (candidates[0] ?? null) : null,
					candidates: candidates === null ? null : candidates.length,
					complete: github.status === "linked",
				}
			: null;
		const fullSha = sha?.value ?? seedFullSha(seed);
		const pullRequests: PullRequest[] = [];
		const runs = new Map<string, CiRun>();
		if (queriedRepository && repository) {
			const prs = new Map<string, PullRequest>();
			const add = (
				prKey: string,
				basis: PullRequest["bases"][number],
				commitInHead: boolean | null = null,
			) => {
				const pr = facts.pullRequests.get(prKey);
				if (!pr) return;
				const existing = prs.get(prKey);
				if (existing) {
					if (!existing.bases.includes(basis)) existing.bases.push(basis);
					if (commitInHead !== null) existing.commitInHead = commitInHead;
					return;
				}
				prs.set(prKey, {
					number: pr.number,
					repositoryId: pr.repository_id,
					headRepositoryId: pr.head_repository_id || pr.repository_id,
					title: pr.title,
					state: pr.state,
					draft: pr.draft,
					createdAt: pr.created_at,
					mergedAt: pr.merged_at,
					closedAt: pr.closed_at,
					headRef: pr.head_ref,
					headSha: pr.head_sha,
					mergeCommitSha: pr.merge_commit_sha,
					bases: [basis],
					commitInHead,
				});
			};
			if (seed.prNumber > 0)
				add(
					key(repository.id, seed.prNumber),
					seed.kind === "evidence_snapshot" ? "snapshot" : "named",
				);
			const branch = seedBranch(seed);
			if (branch)
				for (const prKey of facts.branchPullRequests.get(
					key(repository.id, branchName(branch)),
				) ?? [])
					add(prKey, "branch");
			if (fullSha)
				for (const membership of facts.memberships.get(
					key(repository.id, fullSha),
				) ?? []) {
					const prKey = key(repository.id, membership.prNumber);
					const pr = facts.pullRequests.get(prKey);
					add(
						prKey,
						"commit",
						pr && membership.lastSeenHeadSha
							? membership.lastSeenHeadSha === pr.head_sha
							: null,
					);
				}
			pullRequests.push(...prs.values());
			const addRun = (row: CiRunRow, edge: CiEdge) => {
				const identity = `${row.repository_id}|${row.kind}|${row.run_id}|${row.attempt}`;
				const existing = runs.get(identity);
				if (existing) {
					if (
						!existing.edges.some(
							(known) =>
								known.basis === edge.basis &&
								known.linkBasis === edge.linkBasis &&
								known.prNumber === edge.prNumber,
						)
					)
						existing.edges.push(edge);
					return;
				}
				runs.set(identity, {
					repositoryId: row.repository_id,
					kind: row.kind,
					runId: row.run_id,
					attempt: row.attempt,
					workflow: row.workflow_name,
					event: row.event,
					branch: row.head_branch,
					headSha: row.head_sha,
					status: row.status,
					conclusion: row.conclusion,
					createdAt: row.created_at,
					startedAt: row.started_at,
					completedAt: row.completed_at,
					edges: [edge],
				});
			};
			if (fullSha)
				for (const row of facts.shaRuns.get(key(repository.id, fullSha)) ?? [])
					addRun(row, { basis: "pushed_sha", linkBasis: null, prNumber: null });
			if (seed.kind === "ci_check" && seed.runId)
				for (const row of facts.namedRuns.get(key(repository.id, seed.runId)) ??
					[])
					addRun(row, { basis: "named_run", linkBasis: null, prNumber: null });
			if (seed.kind === "ci_check" && branch)
				for (const row of facts.branchRuns.get(
					key(repository.id, branchName(branch)),
				) ?? []) {
					const createdMs = githubTimeMs(row.created_at);
					if (
						createdMs >= seed.atMs - BRANCH_RUN_WINDOW_MS &&
						createdMs <= seed.atMs
					)
						addRun(row, { basis: "branch", linkBasis: null, prNumber: null });
				}
			for (const pr of pullRequests) {
				for (const row of facts.pullRequestRuns.get(
					key(pr.repositoryId, pr.number),
				) ?? [])
					addRun(row, {
						basis: "pull_request",
						linkBasis: row.link_basis || null,
						prNumber: pr.number,
					});
				if (pr.mergeCommitSha)
					for (const row of facts.shaRuns.get(
						key(pr.repositoryId, pr.mergeCommitSha),
					) ?? [])
						addRun(row, {
							basis: "merge_commit",
							linkBasis: null,
							prNumber: pr.number,
						});
			}
		}
		const found = [...runs.values()].sort(
			(left, right) =>
				right.createdAt.localeCompare(left.createdAt) ||
				left.runId.localeCompare(right.runId) ||
				right.attempt - left.attempt,
		);
		const ciConclusions: Record<string, number> = {};
		for (const run of found) {
			const conclusion = run.conclusion ?? run.status;
			ciConclusions[conclusion] = (ciConclusions[conclusion] ?? 0) + 1;
		}
		const counted = ciCount({
			seed,
			repository,
			github,
			unresolved: prefix !== "" && sha?.value == null,
			fullSha,
			createdMs: fullSha
				? createdInSession(commits.get(seed.sessionId) ?? [], fullSha)
				: undefined,
			pullRequests,
			runs: found,
			facts,
			access,
		});
		const checked = checks.get(pushKey(seed));
		return {
			sessionId: seed.sessionId,
			agentId: seed.agentId,
			turn: seed.turn,
			record: seed.record,
			block: seed.block,
			call: seed.call,
			at: new Date(seed.atMs).toISOString(),
			kind: seed.kind,
			label: seed.label,
			branch: seed.branch,
			sourceBranch: seed.sourceBranch,
			shortSha: seed.shortSha,
			pushFrom: seed.pushFrom,
			pushTo: seed.pushTo,
			remote: seed.remote,
			prRepo: seed.prRepo,
			prNumber: seed.prNumber > 0 ? seed.prNumber : null,
			commitHash: seed.commitHash,
			baseCommit: seed.baseCommit,
			runId: seed.runId,
			generation: seed.generation,
			repository,
			github,
			sha,
			pullRequests,
			ciRuns: found.slice(0, CI_RUNS_PER_EVENT),
			ciRunsObserved: found.length,
			ciRunCount: counted.count,
			ciRunCountThrough: counted.through,
			ciRunCountUnknown: counted.unknown,
			ciConclusions,
			checksAfter:
				seed.kind === "push_range"
					? {
							count: checked?.count ?? 0,
							unconfirmed: checked?.unconfirmed ?? 0,
							sameCall: checked?.sameCall ?? 0,
							first: checked?.first
								? {
										record: checked.first.record,
										at: new Date(checked.first.atMs).toISOString(),
									}
								: null,
						}
					: null,
			parentSessionId: sessions.get(seed.sessionId)?.parentSessionId ?? null,
		};
	});
}

/**
 * An event's CI count with its boundary, or why it has none. The count is
 * the run attempts started before the earliest `coveredThrough` of every
 * repository its runs come from (its own and each PR's base), and it is set
 * only when every target the event names was looked up and each target's
 * history starts inside all of those repositories' coverage: a PR's history
 * `TARGET_LOOKBACK_MS` before its creation, a named run's at its creation, a
 * branch check's at its window, and a SHA's at the commit observation that
 * created it in the session. A SHA nothing in the session created has an
 * unknown history: a later PR or run on it does not date its earlier CI.
 */
function ciCount(input: {
	seed: Seed;
	repository: GitEvent["repository"];
	github: GitHubCoverage;
	unresolved: boolean;
	fullSha: string | null;
	/** When a commit observation of the session created `fullSha`. */
	createdMs: number | undefined;
	pullRequests: readonly PullRequest[];
	runs: readonly CiRun[];
	facts: GitHubFacts;
	access: GitHubAccess;
}): {
	count: number | null;
	through: string | null;
	unknown: GitEvent["ciRunCountUnknown"];
} {
	const unknown = (reason: NonNullable<GitEvent["ciRunCountUnknown"]>) => ({
		count: null,
		through: null,
		unknown: reason,
	});
	const { seed, repository, facts } = input;
	if (input.github.status !== "linked" || !repository)
		return unknown("github_status");
	if (seed.kind === "push_range" && !seed.pushTo)
		return unknown("push_without_sha");
	if (input.unresolved) return unknown("sha_unresolved");
	if (
		seed.prNumber > 0 &&
		!facts.pullRequests.has(key(repository.id, seed.prNumber))
	)
		return unknown("target_not_found");
	const runNamed = seed.kind === "ci_check" && seed.runId !== "";
	const namedRuns = runNamed
		? (facts.namedRuns.get(key(repository.id, seed.runId)) ?? [])
		: [];
	if (runNamed && namedRuns.length === 0) return unknown("target_not_found");
	const branch = seed.kind === "ci_check" ? seedBranch(seed) : "";
	if (!input.fullSha && !runNamed && !branch && input.pullRequests.length === 0)
		return unknown("no_target");
	const coverages = [
		...new Set([
			repository.id,
			...input.pullRequests.map((pr) => pr.repositoryId),
		]),
	].map((repositoryId) =>
		repositoryId === repository.id
			? input.github
			: repositoryCoverage(repositoryId, input.access),
	);
	if (coverages.some((coverage) => coverage.status !== "linked"))
		return unknown("repository_incomplete");

	const starts = [branch ? seed.atMs - BRANCH_RUN_WINDOW_MS : seed.atMs];
	for (const pr of input.pullRequests)
		starts.push(githubTimeMs(pr.createdAt) - TARGET_LOOKBACK_MS);
	for (const run of namedRuns) starts.push(githubTimeMs(run.created_at));
	if (input.fullSha) {
		const created =
			seed.kind === "commit_created" ? seed.atMs : input.createdMs;
		if (created === undefined) return unknown("target_history_unknown");
		starts.push(created);
	}
	const historyFrom = Math.min(...starts);
	let throughMs = Number.POSITIVE_INFINITY;
	for (const coverage of coverages) {
		const from = coverage.ciFrom ?? coverage.prFrom;
		if (from === null || historyFrom < githubTimeMs(from))
			return unknown("before_coverage");
		if (coverage.coveredThrough === null) return unknown("after_coverage");
		throughMs = Math.min(throughMs, githubTimeMs(coverage.coveredThrough));
	}
	if (seed.atMs >= throughMs) return unknown("after_coverage");
	const cappedAt = branch
		? facts.branchRunsCappedAt.get(key(repository.id, branchName(branch)))
		: undefined;
	if (cappedAt !== undefined && seed.atMs - BRANCH_RUN_WINDOW_MS <= cappedAt)
		return unknown("search_capped");
	return {
		count: input.runs.filter(
			(run) => githubTimeMs(run.startedAt ?? run.createdAt) < throughMs,
		).length,
		through: new Date(throughMs).toISOString(),
		unknown: null,
	};
}

export function observationSeed(
	row: ObservationRow,
	generations: ReadonlyMap<string, ObservationGeneration>,
): Seed {
	return {
		sessionId: row.session_id,
		agentId: row.agent_id,
		record: row.record_idx,
		block: row.block_idx,
		call: row.call_id,
		atMs: row.ts_ms,
		kind: row.kind as Seed["kind"],
		label: row.label,
		branch: row.branch,
		sourceBranch: row.push_source_branch,
		shortSha: row.short_sha,
		pushFrom: row.push_from_sha,
		pushTo: row.push_to_sha,
		remote: row.repository_url,
		prRepo: row.pr_repo,
		prNumber: row.pr_number,
		commitHash: row.commit_hash,
		baseCommit: "",
		runId: row.run_id,
		generation: generations.get(row.session_id) ?? null,
		turn: null,
		repositoryId: null,
	};
}

/** Snapshot PRs and capture commits as events, identified by their stable origin ids. */
export function evidenceSeeds(
	snapshots: readonly SnapshotRow[],
	captures: readonly CaptureRow[],
): Seed[] {
	const empty = {
		record: 0,
		block: 0,
		branch: "",
		sourceBranch: "",
		shortSha: "",
		pushFrom: "",
		pushTo: "",
		prRepo: "",
		runId: "",
		generation: null,
		turn: null,
	};
	return [
		...captures.map(
			(capture): Seed => ({
				...empty,
				sessionId: capture.sessionId,
				agentId: capture.agentId,
				call: `capture:${capture.originId}`,
				atMs: Date.parse(capture.capturedAt),
				kind: "evidence_capture",
				label: capture.lifecycle,
				remote: capture.remote,
				prNumber: 0,
				commitHash: capture.headCommit,
				baseCommit: capture.baseCommit,
				repositoryId: capture.repositoryId,
			}),
		),
		...snapshots.map(
			(snapshot): Seed => ({
				...empty,
				sessionId: snapshot.sessionId,
				agentId: "",
				call: `snapshot:${snapshot.originId}`,
				atMs: Date.parse(snapshot.observedAt),
				kind: "evidence_snapshot",
				label: `coverage=${snapshot.coverageComplete ? "complete" : "partial"} ci=${snapshot.ciCoverageComplete ? "complete" : "partial"}`,
				remote: "",
				prNumber: snapshot.pullNumber,
				commitHash: snapshot.commitSha,
				baseCommit: "",
				repositoryId: snapshot.repositoryId,
			}),
		),
	];
}

/** Newest first, then session, stream, record, block and call (evidence origin). */
export function seedKey(seed: Seed): CursorKey {
	return [
		new Date(seed.atMs).toISOString(),
		seed.sessionId,
		seed.agentId,
		seed.record,
		seed.block,
		seed.call,
	];
}

/** The transcript content block of an observation (its `block` adds a match ordinal). */
export function nativeBlock(block: number): number {
	return Math.floor(block / 65_536);
}

/** `owner/name` of a GitHub remote, PR repository or `--repo` value, else null. */
export function githubFullName(value: string): string | null {
	const trimmed = value.trim().replace(/\.git$/u, "");
	const match =
		/^(?:(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/|git@github\.com:|github\.com[:/])?([\w.-]+)\/([\w.-]+)\/?$/iu.exec(
			trimmed,
		);
	if (!match) return null;
	const [, owner, name] = match;
	return owner && name ? `${owner}/${name}` : null;
}

function fromLiteral(
	value: string,
	basis: "event" | "session",
	access: GitHubAccess,
): Omit<Resolved, "seed"> {
	const name = githubFullName(value);
	if (!name)
		return {
			repository: null,
			github: coverage(isRemote(value) ? "not_github" : "no_repository"),
		};
	const binding = access.bindings.find(
		(candidate) => candidate.fullName.toLowerCase() === name.toLowerCase(),
	);
	return binding
		? linked(binding, basis, value, access)
		: { repository: null, github: coverage("unbound") };
}

function linked(
	binding: GitHubBinding,
	basis: NonNullable<GitEvent["repository"]>["basis"],
	value: string,
	access: GitHubAccess,
): Omit<Resolved, "seed"> {
	const repository = access.repositories.get(binding.repositoryId);
	const status: GitHubCoverage["status"] =
		access.visibility === "preview"
			? "preview"
			: repository?.included
				? "linked"
				: "collecting";
	return {
		repository: {
			id: binding.repositoryId,
			fullName: binding.fullName,
			basis,
			value,
		},
		github: {
			status,
			reason:
				repository?.reason ??
				(repository ? null : "not yet in the workspace's GitHub collection"),
			prFrom: repository?.prFrom ?? null,
			ciFrom: repository?.ciFrom ?? null,
			coveredThrough: repository?.coveredThrough ?? null,
		},
	};
}

/** Collection coverage of an authorized repository, such as a fork PR's base. */
function repositoryCoverage(
	repositoryId: string,
	access: GitHubAccess,
): GitHubCoverage {
	const binding = access.bindings.find(
		(candidate) => candidate.repositoryId === repositoryId,
	);
	return binding
		? linked(binding, "event", binding.fullName, access).github
		: coverage("unbound");
}

function coverage(status: GitHubCoverage["status"]): GitHubCoverage {
	return {
		status,
		reason: null,
		prFrom: null,
		ciFrom: null,
		coveredThrough: null,
	};
}

/** GitHub was queried for the event's repository (completely only when `linked`). */
function queried(github: GitHubCoverage): boolean {
	return (
		github.status === "linked" ||
		github.status === "preview" ||
		github.status === "collecting"
	);
}

function eventRepository(seed: Seed): string {
	if (
		seed.kind === "push_range" ||
		seed.kind === "codex_session_meta" ||
		seed.kind === "evidence_capture"
	)
		return seed.remote;
	if (
		seed.kind === "pr_url" ||
		seed.kind === "mcp_pr_created" ||
		seed.kind === "ci_check"
	)
		return seed.prRepo;
	return "";
}

function isRemote(value: string): boolean {
	return /^(?:[a-z][a-z\d+.-]*:\/\/|git@|[\w.-]+\.[a-z]{2,}[:/])/iu.test(
		value.trim(),
	);
}

function seedPrefix(seed: Seed): string {
	if (seed.kind === "commit_created") return seed.shortSha;
	if (seed.kind === "push_range") return seed.pushTo;
	if (seed.kind === "ci_check" && /^[a-f\d]{7,39}$/u.test(seed.commitHash))
		return seed.commitHash;
	return "";
}

function seedFullSha(seed: Seed): string | null {
	if (
		(seed.kind === "codex_session_meta" ||
			seed.kind === "evidence_capture" ||
			seed.kind === "evidence_snapshot" ||
			seed.kind === "ci_check") &&
		/^[a-f\d]{40}$/iu.test(seed.commitHash)
	)
		return seed.commitHash.toLowerCase();
	return null;
}

/** The branch an event names: a pushed branch, or a CI check's branch target. */
function seedBranch(seed: Seed): string {
	return seed.kind === "push_range" || seed.kind === "ci_check"
		? seed.branch
		: "";
}

function branchName(ref: string): string {
	return ref.replace(/^refs\/heads\//u, "");
}

/** A push's place: session, stream and record (as `loadChecksAfter` keys its counts). */
function pushKey(seed: Seed): string {
	return JSON.stringify([seed.sessionId, seed.agentId, seed.record]);
}

/** Milliseconds of a GitHub fact's time: ClickHouse text (UTC) or an ISO time. */
function githubTimeMs(value: string): number {
	const iso = value.includes("T") ? value : value.replace(" ", "T");
	return Date.parse(
		/(?:Z|[+-]\d{2}:?\d{2})$/u.test(iso) || !iso.includes("T")
			? iso
			: `${iso}Z`,
	);
}

/** A UTC time as ClickHouse reads it with `toDateTime64(…, 3, 'UTC')`. */
function clickHouseTime(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

function compareRevision(left: string, right: string): number {
	const difference = BigInt(left) - BigInt(right);
	return difference > 0n ? 1 : difference < 0n ? -1 : 0;
}

function key(left: string, right: string | number): string {
	return `${left}|${right}`;
}

function splitKey(value: string): [string, string] {
	const index = value.indexOf("|");
	return [value.slice(0, index), value.slice(index + 1)];
}

function push<T>(map: Map<string, T[]>, mapKey: string, value: T): void {
	const values = map.get(mapKey);
	if (values) values.push(value);
	else map.set(mapKey, [value]);
}
