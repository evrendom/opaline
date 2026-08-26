import { describe, expect, test } from "bun:test";
import {
	ALLOCATE_SESSION_REVISION_SQL,
	allocateSessionRevision,
	buildMinimumSessionRevision,
	buildSessionRevisionDeduplicationToken,
	buildSessionRevisionOperationId,
	LOCK_SESSION_REVISION_HEAD_SQL,
	READ_SESSION_OPERATION_REVISION_SQL,
	RECORD_SESSION_OPERATION_REVISION_SQL,
	type SessionRevisionTransactionRunner,
} from "./session-revision.service.js";

const CONTENT_HASH = "a".repeat(64);

function createFakeTransactions(initialHead = 0n): {
	readonly allocationCount: () => number;
	readonly transactions: SessionRevisionTransactionRunner;
} {
	let allocationCount = 0;
	let head = initialHead;
	const receipts = new Map<string, string>();
	const transactions: SessionRevisionTransactionRunner = {
		run: (operation) =>
			operation(async (query, parameters) => {
				if (query === LOCK_SESSION_REVISION_HEAD_SQL) {
					return [{ revisionHead: head.toString() }];
				}
				if (query === READ_SESSION_OPERATION_REVISION_SQL) {
					const revision = receipts.get(receiptKey(parameters));
					return revision ? [{ revision }] : [];
				}
				if (query === ALLOCATE_SESSION_REVISION_SQL) {
					const minimum = BigInt(readStringParameter(parameters, 3));
					head = head + 1n > minimum ? head + 1n : minimum;
					allocationCount += 1;
					return [{ revision: head.toString() }];
				}
				if (query === RECORD_SESSION_OPERATION_REVISION_SQL) {
					receipts.set(
						receiptKey(parameters),
						readStringParameter(parameters, 4),
					);
					return [];
				}
				throw new Error("Unexpected session revision query");
			}),
	};
	return { allocationCount: () => allocationCount, transactions };
}

function readStringParameter(
	parameters: readonly (number | string)[],
	index: number,
): string {
	const value = parameters[index];
	if (typeof value !== "string") {
		throw new Error(`Expected string parameter ${index}`);
	}
	return value;
}

function receiptKey(parameters: readonly (number | string)[]): string {
	return [
		readStringParameter(parameters, 2),
		readStringParameter(parameters, 3),
	].join(":");
}

function allocationInput(operationId: string, contentSha256 = CONTENT_HASH) {
	return {
		contentSha256,
		operationId,
		organizationId: "org-1",
		sessionId: "session-1",
		userId: "user-1",
	};
}

describe("session revision allocation", () => {
	test("allocates distinct increasing revisions for distinct operations", async () => {
		const fake = createFakeTransactions();
		const environment = {
			now: () => new Date("2026-08-26T10:00:00.000Z"),
			transactions: fake.transactions,
		};

		const first = await allocateSessionRevision(
			allocationInput("job-1"),
			environment,
		);
		const second = await allocateSessionRevision(
			allocationInput("job-2"),
			environment,
		);

		expect(BigInt(second)).toBe(BigInt(first) + 1n);
		expect(fake.allocationCount()).toBe(2);
	});

	test("reuses the receipt for an exact operation retry", async () => {
		const fake = createFakeTransactions();
		let now = new Date("2026-08-26T10:00:00.000Z");
		const environment = { now: () => now, transactions: fake.transactions };
		const input = allocationInput("job-retry");

		const first = await allocateSessionRevision(input, environment);
		now = new Date("2026-08-26T10:05:00.000Z");
		const retry = await allocateSessionRevision(input, environment);

		expect(retry).toBe(first);
		expect(fake.allocationCount()).toBe(1);
	});

	test("includes the content hash in operation identity", async () => {
		const fake = createFakeTransactions();
		const environment = {
			now: () => new Date("2026-08-26T10:00:00.000Z"),
			transactions: fake.transactions,
		};

		const first = await allocateSessionRevision(
			allocationInput("job-1", "a".repeat(64)),
			environment,
		);
		const changed = await allocateSessionRevision(
			allocationInput("job-1", "b".repeat(64)),
			environment,
		);

		expect(BigInt(changed)).toBeGreaterThan(BigInt(first));
	});

	test("uses a short row-lock transaction and an atomic head update", () => {
		expect(LOCK_SESSION_REVISION_HEAD_SQL).toContain("FOR UPDATE");
		expect(READ_SESSION_OPERATION_REVISION_SQL).toContain("operation_id = $3");
		expect(READ_SESSION_OPERATION_REVISION_SQL).toContain(
			"content_sha256 = $4",
		);
		expect(ALLOCATE_SESSION_REVISION_SQL).toContain(
			"GREATEST(revision_head + 1, $4::bigint)",
		);
		expect(ALLOCATE_SESSION_REVISION_SQL).toContain("RETURNING");
	});

	test("seeds revisions above historical millisecond backfills", () => {
		expect(buildMinimumSessionRevision(new Date(1_000))).toBe(
			(1_000n << 16n).toString(),
		);
	});

	test("builds stable operation and ClickHouse deduplication identities", () => {
		const input = allocationInput("job-1");
		const first = buildSessionRevisionDeduplicationToken(
			input,
			"115807295561596928",
			"rudel.claude_sessions",
		);
		const retry = buildSessionRevisionDeduplicationToken(
			input,
			"115807295561596928",
			"rudel.claude_sessions",
		);
		const analytics = buildSessionRevisionDeduplicationToken(
			input,
			"115807295561596928",
			"rudel.session_analytics",
		);

		expect(first).toBe(retry);
		expect(analytics).not.toBe(first);
		expect(buildSessionRevisionOperationId("codex", "job-1")).toBe("r2:job-1");
		expect(buildSessionRevisionOperationId("codex", undefined)).toBe(
			"legacy:codex",
		);
	});
});
