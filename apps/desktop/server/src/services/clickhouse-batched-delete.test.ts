import { describe, expect, test } from "bun:test";
import { ClickHouseError, TupleParam } from "@clickhouse/client-web";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	buildKeyedDeleteOperations,
	DELETE_KEYS_PER_STATEMENT,
	type DeleteOperation,
	decideDeleteReconciliation,
	deleteQueryId,
	hasKeyedDeleteTime,
	isUnknownDeleteOutcome,
	runDeleteOperation,
} from "./clickhouse-batched-delete.js";

const COLUMNS = [
	{ name: "user_id", type: "String" },
	{ name: "session_id", type: "String" },
	{ name: "revision", type: "UInt64" },
	{ name: "parser_version", type: "UInt16" },
] as const;

function operation(keyCount = 2): DeleteOperation {
	const [first] = buildKeyedDeleteOperations({
		table: "rudel.transcript_records",
		organizationId: "org1",
		columns: COLUMNS,
		keys: Array.from({ length: keyCount }, (_, index) => [
			"u1",
			`s${index}`,
			String(100 + index),
			12,
		]),
	});
	if (!first) throw new Error("no operation");
	return first;
}

function timeout(): ClickHouseError {
	return new ClickHouseError({
		message: "Timeout exceeded: elapsed 60059.762 ms, maximum: 60000.000 ms.",
		code: "159",
		type: "TIMEOUT_EXCEEDED",
	});
}

interface Script {
	execute: (statement: ClickHouseStatement) => Promise<void>;
	rowsRemain: () => boolean | Error;
	pending: () => boolean | Error;
}

function scripted(script: Script) {
	const deletes: ClickHouseStatement[] = [];
	const checks: string[] = [];
	const executor = {
		async execute(statement: ClickHouseStatement) {
			deletes.push(statement);
			await script.execute(statement);
		},
		async query(statement: ClickHouseStatement) {
			if (statement.query.includes("system.mutations")) {
				checks.push("mutations");
				const pending = script.pending();
				if (pending instanceof Error) throw pending;
				return [{ pending: pending ? 1 : 0 }];
			}
			checks.push("rows");
			const remain = script.rowsRemain();
			if (remain instanceof Error) throw remain;
			return remain ? [{ found: 1 }] : [];
		},
	} as unknown as ClickHouseExecutor;
	return { executor, deletes, checks };
}

const instant = { sleep: async () => {}, pollMs: 1 };

describe("decideDeleteReconciliation", () => {
	test("completed: no matching row is left, whatever the mutations say", () => {
		for (const mutationsPending of [true, false, null])
			expect(
				decideDeleteReconciliation({
					rowsRemain: false,
					mutationsPending,
					resubmitted: false,
					canWait: true,
				}),
			).toBe("completed");
	});

	test("still running: wait while the budget allows, then stop without resubmitting", () => {
		const state = {
			rowsRemain: true,
			mutationsPending: true,
			resubmitted: false,
		};
		expect(decideDeleteReconciliation({ ...state, canWait: true })).toBe(
			"wait",
		);
		expect(decideDeleteReconciliation({ ...state, canWait: false })).toBe(
			"stop",
		);
	});

	test("failed or absent with rows left: resubmit once", () => {
		const state = {
			rowsRemain: true,
			mutationsPending: false,
			canWait: true,
		};
		expect(decideDeleteReconciliation({ ...state, resubmitted: false })).toBe(
			"resubmit",
		);
		expect(decideDeleteReconciliation({ ...state, resubmitted: true })).toBe(
			"stop",
		);
	});

	test("an unreadable mutation state never resubmits", () => {
		expect(
			decideDeleteReconciliation({
				rowsRemain: true,
				mutationsPending: null,
				resubmitted: false,
				canWait: true,
			}),
		).toBe("stop");
	});
});

describe("isUnknownDeleteOutcome", () => {
	test("timeouts, cancellations, broken connections and same-id rejections are unknown", () => {
		for (const code of ["159", "209", "210", "216", "394"])
			expect(
				isUnknownDeleteOutcome(
					new ClickHouseError({ message: "", code, type: "" }),
				),
			).toBe(true);
		expect(isUnknownDeleteOutcome(new Error("Timeout error."))).toBe(true);
		expect(
			isUnknownDeleteOutcome(new Error("The user aborted a request.")),
		).toBe(true);
		expect(
			isUnknownDeleteOutcome(
				new Error("ClickHouse request failed with HTTP 502 Bad Gateway"),
			),
		).toBe(true);
	});

	test("a rejected statement is a known failure", () => {
		for (const code of ["62", "47", "497", "241"])
			expect(
				isUnknownDeleteOutcome(
					new ClickHouseError({ message: "", code, type: "" }),
				),
			).toBe(false);
		expect(
			isUnknownDeleteOutcome(
				new Error("ClickHouse request failed with HTTP 414 URI Too Long"),
			),
		).toBe(false);
	});
});

describe("buildKeyedDeleteOperations", () => {
	test("keeps the organization and every key column in one bounded IN per statement", () => {
		const keys = Array.from(
			{ length: DELETE_KEYS_PER_STATEMENT + 1 },
			(_, i) => [
				"u1",
				`s${String(i).padStart(4, "0")}`,
				"117547586974711808",
				12,
			],
		);
		const operations = buildKeyedDeleteOperations({
			table: "rudel.transcript_records",
			organizationId: "org1",
			columns: COLUMNS,
			keys: [...keys, keys[0] ?? []],
		});
		expect(operations.map((op) => op.keyCount)).toEqual([
			DELETE_KEYS_PER_STATEMENT,
			1,
		]);
		expect(operations[0]?.predicate).toBe(
			"organization_id = {organizationId:String} AND (user_id, session_id, revision, parser_version) IN {keys:Array(Tuple(String, String, UInt64, UInt16))}",
		);
		expect(operations[0]?.queryParams.organizationId).toBe("org1");
		const [first] = operations[0]?.queryParams.keys as TupleParam[];
		expect(first).toBeInstanceOf(TupleParam);
		expect(first?.values).toEqual(["u1", "s0000", 117547586974711808n, 12]);
		expect(operations[0]?.settings).toMatchObject({
			lightweight_deletes_sync: "1",
			max_execution_time: 60,
		});
		expect(operations[0]?.settings).not.toHaveProperty(
			"lightweight_deletes_sync",
			"0",
		);
	});

	test("the same keys in any order give the same operation ids", () => {
		const keys = [
			["u1", "s1", "1", 12],
			["u1", "s2", "2", 12],
		];
		const ids = (input: (string | number)[][]) =>
			buildKeyedDeleteOperations({
				table: "rudel.transcript_records",
				organizationId: "org1",
				columns: COLUMNS,
				keys: input,
			}).map((op) => op.operationId);
		expect(ids(keys)).toEqual(ids([...keys].reverse()));
		expect(ids(keys)[0]).toMatch(/^transcript_records-[0-9a-f]{20}$/u);
		expect(
			buildKeyedDeleteOperations({
				table: "rudel.transcript_records",
				organizationId: "org2",
				columns: COLUMNS,
				keys,
			})[0]?.operationId,
		).not.toBe(ids(keys)[0]);
	});

	test("rejects keys that do not match their columns and unknown tables", () => {
		expect(() =>
			buildKeyedDeleteOperations({
				table: "rudel.transcript_records",
				organizationId: "org1",
				columns: COLUMNS,
				keys: [["u1", "s1"]],
			}),
		).toThrow("Key does not match its columns");
		expect(() =>
			buildKeyedDeleteOperations({
				table: "rudel.not_a_table",
				organizationId: "org1",
				columns: COLUMNS,
				keys: [],
			}),
		).toThrow("Unsupported ClickHouse table");
	});
});

describe("runDeleteOperation", () => {
	test("a DELETE that answers runs once under its deterministic query id", async () => {
		const op = operation();
		const run = scripted({
			execute: async () => {},
			rowsRemain: () => true,
			pending: () => false,
		});
		const outcome = await runDeleteOperation(run.executor, op);
		expect(outcome).toMatchObject({
			status: "completed",
			operationId: op.operationId,
			queryIds: [deleteQueryId(op.operationId, 1)],
		});
		expect(run.deletes).toHaveLength(1);
		expect(run.deletes[0]?.query).toBe(
			`DELETE FROM rudel.transcript_records WHERE ${op.predicate}`,
		);
		expect(run.deletes[0]?.query_id).toBe(`opaline-delete-${op.operationId}-1`);
		expect(run.checks).toEqual([]);
	});

	test("a timed-out DELETE that finished later is not submitted again", async () => {
		const run = scripted({
			execute: async () => {
				throw timeout();
			},
			rowsRemain: () => false,
			pending: () => false,
		});
		const outcome = await runDeleteOperation(
			run.executor,
			operation(),
			instant,
		);
		expect(outcome.status).toBe("completed-late");
		expect(run.deletes).toHaveLength(1);
		expect(run.checks).toEqual(["rows"]);
	});

	test("a still-running mutation is polled until its rows are gone", async () => {
		let polls = 0;
		const run = scripted({
			execute: async () => {
				throw new Error("Timeout error.");
			},
			rowsRemain: () => ++polls < 3,
			pending: () => true,
		});
		const outcome = await runDeleteOperation(
			run.executor,
			operation(),
			instant,
		);
		expect(outcome.status).toBe("completed-late");
		expect(run.deletes).toHaveLength(1);
		expect(run.checks).toEqual([
			"rows",
			"mutations",
			"rows",
			"mutations",
			"rows",
		]);
	});

	test("a mutation still running when the budget ends is left running, never resubmitted", async () => {
		let clock = 0;
		const run = scripted({
			execute: async () => {
				throw timeout();
			},
			rowsRemain: () => true,
			pending: () => true,
		});
		const outcome = await runDeleteOperation(run.executor, operation(), {
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
			pollMs: 10,
			reconcileBudgetMs: 35,
		});
		expect(outcome.status).toBe("running");
		expect(run.deletes).toHaveLength(1);
	});

	test("rows left with no pending mutation resubmit once under the next query id", async () => {
		const op = operation();
		let submissions = 0;
		const run = scripted({
			execute: async () => {
				submissions++;
				if (submissions === 1) throw timeout();
			},
			rowsRemain: () => true,
			pending: () => false,
		});
		const outcome = await runDeleteOperation(run.executor, op, instant);
		expect(outcome).toMatchObject({
			status: "completed-late",
			queryIds: [
				deleteQueryId(op.operationId, 1),
				deleteQueryId(op.operationId, 2),
			],
		});
		expect(run.deletes.map((statement) => statement.query_id)).toEqual([
			deleteQueryId(op.operationId, 1),
			deleteQueryId(op.operationId, 2),
		]);
	});

	test("a resubmission that also times out is reconciled but never submitted a third time", async () => {
		const run = scripted({
			execute: async () => {
				throw timeout();
			},
			rowsRemain: () => true,
			pending: () => false,
		});
		const outcome = await runDeleteOperation(
			run.executor,
			operation(),
			instant,
		);
		expect(outcome.status).toBe("unresolved");
		expect(run.deletes).toHaveLength(2);
	});

	test("an unreadable mutation state stops without resubmitting", async () => {
		const run = scripted({
			execute: async () => {
				throw timeout();
			},
			rowsRemain: () => true,
			pending: () => new Error("ACCESS_DENIED"),
		});
		const outcome = await runDeleteOperation(
			run.executor,
			operation(),
			instant,
		);
		expect(outcome.status).toBe("unresolved");
		expect(run.deletes).toHaveLength(1);
	});

	test("a rejected statement is rethrown without reconciliation", async () => {
		const run = scripted({
			execute: async () => {
				throw new ClickHouseError({
					message: "Syntax error",
					code: "62",
					type: "SYNTAX_ERROR",
				});
			},
			rowsRemain: () => true,
			pending: () => false,
		});
		await expect(
			runDeleteOperation(run.executor, operation(), instant),
		).rejects.toThrow("Syntax error");
		expect(run.checks).toEqual([]);
	});

	test("with deferWhilePending, an earlier DELETE still running defers the new one", async () => {
		const run = scripted({
			execute: async () => {},
			rowsRemain: () => true,
			pending: () => true,
		});
		const outcome = await runDeleteOperation(run.executor, operation(), {
			deferWhilePending: true,
		});
		expect(outcome.status).toBe("deferred");
		expect(run.deletes).toHaveLength(0);
	});
});

describe("runDeleteOperation with skipWhenNoRows", () => {
	test("submits nothing when no row matches", async () => {
		const run = scripted({
			execute: async () => {},
			rowsRemain: () => false,
			pending: () => false,
		});
		const outcome = await runDeleteOperation(run.executor, operation(), {
			skipWhenNoRows: true,
		});
		expect(outcome).toMatchObject({ status: "empty", queryIds: [] });
		expect(run.deletes).toHaveLength(0);
	});

	test("submits when rows match", async () => {
		const run = scripted({
			execute: async () => {},
			rowsRemain: () => true,
			pending: () => false,
		});
		const outcome = await runDeleteOperation(run.executor, operation(), {
			skipWhenNoRows: true,
		});
		expect(outcome.status).toBe("completed");
		expect(run.deletes).toHaveLength(1);
	});
});

describe("hasKeyedDeleteTime", () => {
	test("a statement starts only when its whole server budget fits", () => {
		expect(hasKeyedDeleteTime(undefined)).toBe(true);
		expect(hasKeyedDeleteTime({ deadlineAt: 65_000, now: () => 0 })).toBe(true);
		expect(hasKeyedDeleteTime({ deadlineAt: 64_999, now: () => 0 })).toBe(
			false,
		);
	});
});
