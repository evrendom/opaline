import { describe, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { TRANSCRIPT_READ_DEADLINE_MS } from "../transcript-records-reader.service.js";
import {
	type GenerationStore,
	MAX_RETIRED_PER_SESSION,
	planRetirement,
	RETIREMENT_GRACE_MS,
	type RetirementPolicy,
	retireGenerations,
	runRetirementPass,
	type StoredGeneration,
	type StoredSession,
} from "./retirement.js";
import { SESSION_RETIREMENT_STORES } from "./stores.js";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const minutesAgo = (minutes: number) => NOW - minutes * 60_000;
const GRACE: RetirementPolicy = {
	graceMs: RETIREMENT_GRACE_MS,
	abandonedBuilds: false,
};
const BUILDS: RetirementPolicy = {
	graceMs: RETIREMENT_GRACE_MS,
	abandonedBuilds: true,
};
const NO_GRACE: RetirementPolicy = { graceMs: null, abandonedBuilds: false };

function committed(
	revision: string,
	publishedMinutesAgo: number,
	parserVersion = 8,
): StoredGeneration {
	return {
		key: [revision, parserVersion],
		committed: true,
		publishedAtMs: minutesAgo(publishedMinutesAgo),
		writtenAtMs: minutesAgo(publishedMinutesAgo),
		rows: 10,
	};
}

function uncommitted(
	revision: string,
	writtenMinutesAgo = 0,
	parserVersion = 8,
): StoredGeneration {
	return {
		key: [revision, parserVersion],
		committed: false,
		publishedAtMs: null,
		writtenAtMs: minutesAgo(writtenMinutesAgo),
		rows: null,
	};
}

const retired = (
	generations: StoredGeneration[],
	policy: RetirementPolicy = GRACE,
) =>
	planRetirement(generations, policy, NOW).retired.map((generation) =>
		generation.key.join("/"),
	);

describe("which generations retire at a time", () => {
	test("the grace outlasts the enforced whole-read deadline of a pinned read", () => {
		expect(RETIREMENT_GRACE_MS).toBeGreaterThan(TRANSCRIPT_READ_DEADLINE_MS);
	});

	test("what the committed generation superseded past the grace goes, never it or a newer build", () => {
		expect(
			retired([
				uncommitted("20", 0, 9),
				committed("20", 11),
				committed("20", 12, 7),
				uncommitted("10"),
			]),
		).toEqual(["20/7", "10/8"]);
	});

	test("a committed generation goes once the grace since it was superseded has passed", () => {
		expect(
			retired([
				committed("200", 0),
				committed("150", 30),
				committed("100", 60),
				committed("50", 90),
			]),
		).toEqual(["100/8", "50/8"]);
		expect(
			retired([committed("200", 0), committed("150", 3), committed("100", 5)]),
		).toEqual([]);
	});

	test("crashed attempts go at once, a just superseded generation stays", () => {
		expect(
			retired([committed("200", 1), uncommitted("150"), committed("100", 60)]),
		).toEqual(["150/8"]);
	});

	test("revisions are ordered as numbers, not text", () => {
		expect(retired([committed("9", 12), committed("10", 11)])).toEqual(["9/8"]);
	});

	test("nothing goes without a readable committed publication", () => {
		expect(
			retired([
				{ ...committed("2", 30), publishedAtMs: Number.NaN },
				uncommitted("1"),
			]),
		).toEqual([]);
		expect(retired([uncommitted("2"), uncommitted("1")])).toEqual([]);
	});

	test("an unreadable publication keeps the committed generations below it", () => {
		expect(
			retired([
				committed("3", 30),
				{ ...committed("2", 60), publishedAtMs: Number.NaN },
				committed("1", 90),
				uncommitted("0"),
			]),
		).toEqual(["2/8", "0/8"]);
	});

	test("a build store also retires builds abandoned past the grace, committed or not below them", () => {
		expect(retired([committed("2", 30), uncommitted("1", 40)], BUILDS)).toEqual(
			["1/8"],
		);
		expect(retired([uncommitted("3", 1), committed("2", 30)], BUILDS)).toEqual(
			[],
		);
		expect(retired([uncommitted("3", 30), committed("2", 30)], BUILDS)).toEqual(
			["3/8"],
		);
		expect(
			retired([uncommitted("3", 30), uncommitted("2", 1)], BUILDS),
		).toEqual(["3/8"]);
		expect(retired([uncommitted("3", 30), uncommitted("2", 1)], GRACE)).toEqual(
			[],
		);
	});

	test("without a grace everything below the newest receipt goes at once, a newer build stays", () => {
		expect(
			retired(
				[
					uncommitted("4"),
					committed("3", 0),
					committed("2", 0),
					uncommitted("1"),
				],
				NO_GRACE,
			),
		).toEqual(["2/8", "1/8"]);
		expect(retired([uncommitted("2"), uncommitted("1")], NO_GRACE)).toEqual([]);
	});

	test("a session retires at most its cap per pass and says so only when more remain", () => {
		const generations = [
			committed("1000", 30),
			...Array.from({ length: MAX_RETIRED_PER_SESSION + 5 }, (_, index) =>
				uncommitted(String(index + 1)),
			),
		];
		const plan = planRetirement(generations, GRACE, NOW);
		expect(plan.retired).toHaveLength(MAX_RETIRED_PER_SESSION);
		expect(plan.capped).toBe(true);
		const exactly = planRetirement(
			generations.slice(0, MAX_RETIRED_PER_SESSION + 1),
			GRACE,
			NOW,
		);
		expect(exactly.retired).toHaveLength(MAX_RETIRED_PER_SESSION);
		expect(exactly.capped).toBe(false);
		expect(planRetirement(generations.slice(0, 3), GRACE, NOW).capped).toBe(
			false,
		);
	});
});

interface FakeSession extends StoredSession {
	readonly generations: StoredGeneration[];
}

function session(
	organizationId: string,
	sessionId: string,
	generations: StoredGeneration[],
): FakeSession {
	return { organizationId, key: ["u1", sessionId], generations };
}

function fakeStore(
	sessions: readonly FakeSession[],
	options: {
		dependents?: string[];
		policy?: RetirementPolicy;
		table?: string;
		onRead?: (organizationId: string) => void;
	} = {},
) {
	const reads: string[][] = [];
	const store: GenerationStore = {
		table: options.table ?? "rudel.transcript_records",
		dependents: () => options.dependents ?? [],
		sessionColumns: [
			{ name: "user_id", type: "String" },
			{ name: "session_id", type: "String" },
		],
		generationColumns: [
			{ name: "revision", type: "UInt64" },
			{ name: "parser_version", type: "UInt16" },
		],
		policy: options.policy ?? GRACE,
		census: {
			windowRows: 1_000,
			windowsPerPass: 2,
			sessionsPerPass: 1_000,
			readsMs: 60_000,
		},
		async findSessions(_executor, input) {
			return sessions
				.filter(
					(entry) =>
						input.organizationId === undefined ||
						entry.organizationId === input.organizationId,
				)
				.slice(0, input.limit);
		},
		async readGenerations(_executor, organizationId, page) {
			reads.push(page.map((entry) => `${organizationId}:${entry.key[1]}`));
			options.onRead?.(organizationId);
			return page.map((entry) => ({
				session: entry,
				generations: (entry as FakeSession).generations,
			}));
		},
	};
	return { store, reads };
}

function fakeExecutor(
	settle: (statement: ClickHouseStatement) => "ok" | "unknown" = () => "ok",
	options: {
		pending?: (statement: ClickHouseStatement) => boolean;
		rowsRemain?: (statement: ClickHouseStatement) => boolean;
		onExecute?: () => void;
	} = {},
) {
	const deletes: ClickHouseStatement[] = [];
	const executor = {
		async query(statement: ClickHouseStatement) {
			if (statement.query.includes("mergeTreeIndex")) return [];
			if (statement.query.includes("system.mutations"))
				return [{ pending: options.pending?.(statement) ? 1 : 0 }];
			if (statement.query.includes("SELECT 1 AS found"))
				return (options.rowsRemain?.(statement) ?? true) ? [{ found: 1 }] : [];
			return [];
		},
		async execute(statement: ClickHouseStatement) {
			deletes.push(statement);
			options.onExecute?.();
			if (settle(statement) === "unknown") throw new Error("Timeout error.");
		},
	} as unknown as ClickHouseExecutor;
	return { executor, deletes };
}

function oldGenerations(count: number): StoredGeneration[] {
	return [
		committed("1000", 30),
		...Array.from({ length: count }, (_, index) =>
			uncommitted(String(index + 1)),
		),
	];
}

const deadline = (budgetMs = 600_000) => ({
	deadlineAt: NOW + budgetMs,
	now: () => NOW,
});
const table = (statement: ClickHouseStatement) =>
	/DELETE FROM (\S+)/u.exec(statement.query)?.[1];

describe("a retirement pass over a store", () => {
	test("deletes each retired generation by its session and generation key, dependents before their parent", async () => {
		const { store } = fakeStore(
			[
				session("org-a", "s1", [
					committed("3", 30),
					committed("2", 60),
					uncommitted("1"),
				]),
			],
			{ dependents: ["rudel.transcript_record_commands"] },
		);
		const run = fakeExecutor();
		const result = await retireGenerations(run.executor, store, {
			deadline: deadline(),
		});

		expect(run.deletes.map(table)).toEqual([
			"rudel.transcript_record_commands",
			"rudel.transcript_records",
		]);
		expect(run.deletes[0]?.query).toContain(
			"(user_id, session_id, revision, parser_version) IN {keys:Array(Tuple(String, String, UInt64, UInt16))}",
		);
		expect(run.deletes[0]?.query_params?.keys).toEqual(
			run.deletes[1]?.query_params?.keys,
		);
		expect(run.deletes[1]?.query_params?.keys).toHaveLength(2);
		expect(run.deletes[1]?.query_params?.organizationId).toBe("org-a");
		expect(result).toMatchObject({
			retired: 2,
			generations: 2,
			sessions: 1,
			deleteStatements: 2,
			hasMore: false,
		});
	});

	test("a parent is never deleted while its dependents' delete is unsettled", async () => {
		const { store } = fakeStore(
			[session("org-a", "s1", [committed("2", 30), uncommitted("1")])],
			{ dependents: ["rudel.call_facts"] },
		);
		const run = fakeExecutor((statement) =>
			statement.query.includes("rudel.call_facts") ? "unknown" : "ok",
		);
		const result = await retireGenerations(run.executor, store, {
			deadline: { deadlineAt: NOW + 70_000, now: () => NOW },
		});

		expect(run.deletes.map(table)).toEqual([
			"rudel.call_facts",
			"rudel.call_facts",
		]);
		expect(result).toMatchObject({ retired: 0, hasMore: true });
	});

	test("reads and deletes one organization's page at a time", async () => {
		const sessions = [
			session("org-a", "s1", [committed("2", 30), uncommitted("1")]),
			session("org-a", "s2", [committed("2", 30), uncommitted("1")]),
			session("org-b", "s3", [committed("2", 30), uncommitted("1")]),
		];
		const { store, reads } = fakeStore(sessions);
		const run = fakeExecutor();
		const result = await retireGenerations(run.executor, store, {
			deadline: deadline(),
		});

		expect(reads).toEqual([["org-a:s1", "org-a:s2"], ["org-b:s3"]]);
		expect(
			run.deletes.map((statement) => statement.query_params?.organizationId),
		).toEqual(["org-a", "org-b"]);
		expect(result).toMatchObject({ retired: 3, hasMore: false });
	});

	test("an organization pass reads only that organization's sessions", async () => {
		const { store, reads } = fakeStore([
			session("org-a", "s1", [committed("2", 30), uncommitted("1")]),
			session("org-b", "s2", [committed("2", 30), uncommitted("1")]),
		]);
		await retireGenerations(fakeExecutor().executor, store, {
			deadline: deadline(),
			organizationId: "org-b",
		});
		expect(reads).toEqual([["org-b:s2"]]);
	});

	test("stops before a delete the deadline cannot fit, and says more remain", async () => {
		const { store } = fakeStore([
			session("org-a", "s1", [committed("2", 30), uncommitted("1")]),
		]);
		const run = fakeExecutor();
		const result = await retireGenerations(run.executor, store, {
			deadline: deadline(1_000),
		});
		expect(run.deletes).toHaveLength(0);
		expect(result).toMatchObject({ retired: 0, hasMore: true });
	});

	test("says more remain when the census fills the pass or a session hits its cap", async () => {
		const full = fakeStore([
			session("org-a", "s1", [committed("2", 30), uncommitted("1")]),
			session("org-a", "s2", [committed("2", 30), uncommitted("1")]),
		]);
		expect(
			await retireGenerations(fakeExecutor().executor, full.store, {
				deadline: deadline(),
				maxSessions: 1,
			}),
		).toMatchObject({ sessions: 1, retired: 1, hasMore: true });

		const capped = fakeStore([
			session("org-a", "s1", [
				committed("1000", 30),
				...Array.from({ length: MAX_RETIRED_PER_SESSION + 1 }, (_, index) =>
					uncommitted(String(index + 1)),
				),
			]),
		]);
		expect(
			await retireGenerations(fakeExecutor().executor, capped.store, {
				deadline: deadline(),
			}),
		).toMatchObject({ retired: MAX_RETIRED_PER_SESSION, hasMore: true });
	});

	test("dependent and parent deletes stay aligned chunk by chunk above 256 keys", async () => {
		const { store } = fakeStore(
			["s1", "s2", "s3"].map((id) =>
				session("org-a", id, oldGenerations(MAX_RETIRED_PER_SESSION)),
			),
			{ dependents: ["rudel.transcript_record_commands"] },
		);
		const run = fakeExecutor();
		const result = await retireGenerations(run.executor, store, {
			deadline: deadline(),
		});

		expect(run.deletes.map(table)).toEqual([
			"rudel.transcript_record_commands",
			"rudel.transcript_records",
			"rudel.transcript_record_commands",
			"rudel.transcript_records",
		]);
		const keys = run.deletes.map(
			(statement) => statement.query_params?.keys as unknown[],
		);
		expect(keys.map((chunk) => chunk.length)).toEqual([256, 256, 44, 44]);
		expect(keys[0]).toEqual(keys[1] as unknown[]);
		expect(keys[2]).toEqual(keys[3] as unknown[]);
		expect(result).toMatchObject({
			retired: 3 * MAX_RETIRED_PER_SESSION,
			deleteStatements: 4,
			hasMore: false,
		});
	});

	test("a dependent table without the retired keys is skipped and the parent is still deleted", async () => {
		const { store } = fakeStore(
			[session("org-a", "s1", [committed("2", 30), uncommitted("1")])],
			{ dependents: ["rudel.transcript_record_commands"] },
		);
		const run = fakeExecutor(undefined, {
			rowsRemain: (statement) =>
				!statement.query.includes("rudel.transcript_record_commands"),
		});
		const result = await retireGenerations(run.executor, store, {
			deadline: deadline(),
		});

		expect(run.deletes.map(table)).toEqual(["rudel.transcript_records"]);
		expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
			"empty",
			"completed",
		]);
		expect(result).toMatchObject({ retired: 1, hasMore: false });
	});

	test("an organization with a deferred delete is left for the next pass, the next organization still retires", async () => {
		const stuck = Array.from({ length: 101 }, (_, index) =>
			session("org-a", `a${index}`, [committed("2", 30), uncommitted("1")]),
		);
		const { store, reads } = fakeStore([
			...stuck,
			session("org-b", "b1", [committed("2", 30), uncommitted("1")]),
		]);
		const run = fakeExecutor(undefined, {
			pending: (statement) => statement.query_params?.marker === "org-a",
		});
		const result = await retireGenerations(run.executor, store, {
			deadline: deadline(),
		});

		expect(reads.map((page) => page.length)).toEqual([100, 1]);
		expect(reads[1]).toEqual(["org-b:b1"]);
		expect(
			run.deletes.map((statement) => statement.query_params?.organizationId),
		).toEqual(["org-b"]);
		expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
			"deferred",
			"completed",
		]);
		expect(result).toMatchObject({ retired: 1, hasMore: true });
	});

	test("a page read the deadline cuts off after deletes returns the work done", async () => {
		let clock = NOW;
		const { store } = fakeStore(
			[
				session("org-a", "a1", [committed("2", 30), uncommitted("1")]),
				session("org-b", "b1", [committed("2", 30), uncommitted("1")]),
			],
			{
				onRead: (organizationId) => {
					if (organizationId === "org-b") clock += 600_000;
				},
			},
		);
		const run = fakeExecutor();
		const result = await retireGenerations(run.executor, store, {
			deadline: { deadlineAt: NOW + 300_000, now: () => clock },
		});

		expect(result).toMatchObject({
			retired: 1,
			deleteStatements: 1,
			hasMore: true,
		});
	});

	test("a session with nothing past its grace deletes nothing", async () => {
		const { store } = fakeStore([
			session("org-a", "s1", [committed("2", 1), committed("1", 30)]),
		]);
		const run = fakeExecutor();
		expect(
			await retireGenerations(run.executor, store, { deadline: deadline() }),
		).toMatchObject({ retired: 0, deleteStatements: 0, hasMore: false });
		expect(run.deletes).toHaveLength(0);
	});
});

describe("the hourly retirement pass", () => {
	function executorReading(
		failWhen: (statement: ClickHouseStatement) => boolean = () => false,
	) {
		const reads: string[] = [];
		const executor = {
			async query(statement: ClickHouseStatement) {
				if (statement.query.includes("mergeTreeIndex")) return [];
				const table = /FROM (rudel\.\w+)/u.exec(statement.query)?.[1] ?? "";
				reads.push(table);
				if (failWhen(statement)) throw new Error(`census of ${table} failed`);
				return [];
			},
			async execute() {},
		} as unknown as ClickHouseExecutor;
		return { executor, reads };
	}
	const at = (hour: number) => {
		const now = Date.UTC(2026, 10, 6, hour, 40);
		return { deadlineAt: now + 270_000, now: () => now };
	};

	test("with nothing superseded it reads each store once and reports every step", async () => {
		const run = executorReading();
		const result = await runRetirementPass({
			executor: run.executor,
			deadline: at(0),
			stores: SESSION_RETIREMENT_STORES,
		});
		expect(run.reads).toEqual([
			"rudel.session_git_observations",
			"rudel.transcript_chunk_hits",
			"rudel.run_index",
			"rudel.transcript_records",
		]);
		expect(Object.keys(result)).toEqual([
			"gitObservations",
			"chunkHits",
			"runIndex",
			"transcriptRecords",
		]);
		for (const step of Object.values(result))
			expect(step).toEqual({
				status: "ok",
				retired: 0,
				deleteStatements: 0,
				hasMore: false,
			});
	});

	test("starts from a different store each hour so a backlog cannot starve the others", async () => {
		const run = executorReading();
		await runRetirementPass({
			executor: run.executor,
			deadline: at(2),
			stores: SESSION_RETIREMENT_STORES,
		});
		expect(run.reads).toEqual([
			"rudel.run_index",
			"rudel.transcript_records",
			"rudel.session_git_observations",
			"rudel.transcript_chunk_hits",
		]);
	});

	test("deletes that outlast the census budget leave the page reads their own budget", async () => {
		let clock = NOW;
		const { store } = fakeStore(
			["org-a", "org-b"].map((organizationId) =>
				session(organizationId, `s-${organizationId}`, [
					committed("3", 30),
					committed("2", 60),
				]),
			),
			{
				table: "rudel.run_index",
				dependents: ["rudel.call_facts"],
				policy: BUILDS,
			},
		);
		const census = { ...store.census, readsMs: 30_000 };
		const run = fakeExecutor(undefined, {
			onExecute: () => {
				clock += 20_000;
			},
		});
		const result = await runRetirementPass({
			executor: run.executor,
			deadline: { deadlineAt: NOW + 270_000, now: () => clock },
			stores: [["runIndex", { ...store, census }]] as const,
		});

		expect(result.runIndex).toEqual({
			status: "ok",
			retired: 1,
			deleteStatements: 3,
			hasMore: true,
		});
	});

	test("each store's census reads a window under the per-window read budget", async () => {
		for (const [name, store] of SESSION_RETIREMENT_STORES) {
			const censuses: ClickHouseStatement[] = [];
			const executor = {
				async query(statement: ClickHouseStatement) {
					if (!statement.query.includes("mergeTreeIndex"))
						censuses.push(statement);
					return [];
				},
				async execute() {},
			} as unknown as ClickHouseExecutor;
			await retireGenerations(executor, store, { deadline: deadline() });

			expect(censuses, name).toHaveLength(1);
			expect(censuses[0]?.clickhouse_settings, name).toMatchObject({
				max_execution_time: 10,
				max_rows_to_read: "4000000",
				max_bytes_to_read: String(1024 * 1024 * 1024),
				result_overflow_mode: "throw",
			});
		}
	});

	test("a failing store is reported and the others still run", async () => {
		const run = executorReading((statement) =>
			statement.query.includes("rudel.transcript_records"),
		);
		const result = await runRetirementPass({
			executor: run.executor,
			deadline: at(0),
			stores: SESSION_RETIREMENT_STORES,
		});
		expect(result.transcriptRecords).toEqual({
			status: "failed",
			retired: 0,
			deleteStatements: 0,
			hasMore: true,
			error: "census of rudel.transcript_records failed",
		});
		expect(result.gitObservations.status).toBe("ok");
		expect(result.chunkHits.status).toBe("ok");
		expect(result.runIndex.status).toBe("ok");
	});
});
