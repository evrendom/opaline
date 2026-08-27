import { describe, expect, test } from "bun:test";
import {
	ALLOCATE_SESSION_REVISION_SQL,
	allocateSessionRevision,
	buildSessionRevisionDeduplicationToken,
	buildSessionRevisionOperationId,
	LOCK_SESSION_REVISION_HEAD_SQL,
	READ_SESSION_OPERATION_REVISION_SQL,
	RECORD_SESSION_OPERATION_REVISION_SQL,
	type SessionRevisionTransactionRunner,
} from "./session-revision.service.js";

const CONTENT_HASH = "a".repeat(64);

function createFakeTransactions(
	initialHead = 0n,
	databaseFloor = 100n,
): {
	readonly allocationCount: () => number;
	readonly revisionHead: () => string;
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
					head = head + 1n > databaseFloor ? head + 1n : databaseFloor;
					allocationCount += 1;
					return [{ revision: head.toString() }];
				}
				if (query === RECORD_SESSION_OPERATION_REVISION_SQL) {
					const revision = readStringParameter(parameters, 4);
					receipts.set(receiptKey(parameters), revision);
					return [{ revision }];
				}
				throw new Error("Unexpected session revision query");
			}),
	};
	return {
		allocationCount: () => allocationCount,
		revisionHead: () => head.toString(),
		transactions,
	};
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
		allowReceiptPromotion: false,
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
		const environment = { transactions: fake.transactions };

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
		const environment = { transactions: fake.transactions };
		const input = allocationInput("job-retry");

		const first = await allocateSessionRevision(input, environment);
		const retry = await allocateSessionRevision(input, environment);

		expect(retry).toBe(first);
		expect(fake.allocationCount()).toBe(1);
	});

	test("includes the content hash in operation identity", async () => {
		const fake = createFakeTransactions();
		const environment = { transactions: fake.transactions };

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

	test("does not promote an exact legacy receipt over an intervening head", async () => {
		const fake = createFakeTransactions();
		const environment = { transactions: fake.transactions };
		const recurring = allocationInput("legacy:claude_code", "a".repeat(64));

		const first = await allocateSessionRevision(recurring, environment);
		const exactRetry = await allocateSessionRevision(recurring, environment);
		const intervening = await allocateSessionRevision(
			allocationInput("legacy:claude_code", "b".repeat(64)),
			environment,
		);
		const recurrence = await allocateSessionRevision(recurring, environment);

		expect(exactRetry).toBe(first);
		expect(BigInt(intervening)).toBe(BigInt(first) + 1n);
		expect(recurrence).toBe(first);
		expect(fake.revisionHead()).toBe(intervening);
		expect(fake.allocationCount()).toBe(2);
	});

	test("reuses a client operation receipt after an intervening upload", async () => {
		const fake = createFakeTransactions(9n, 10n);
		const environment = { transactions: fake.transactions };
		const operationId = "op:00000000-0000-4000-8000-000000000010";
		const firstInput = allocationInput(operationId, "a".repeat(64));

		const first = await allocateSessionRevision(firstInput, environment);
		const intervening = await allocateSessionRevision(
			allocationInput(
				"op:00000000-0000-4000-8000-000000000011",
				"b".repeat(64),
			),
			environment,
		);
		const retry = await allocateSessionRevision(firstInput, environment);

		expect(first).toBe("10");
		expect(intervening).toBe("11");
		expect(retry).toBe("10");
		expect(fake.revisionHead()).toBe("11");
		expect(fake.allocationCount()).toBe(2);
	});

	test("allows explicit legacy replacement to promote an old receipt", async () => {
		const fake = createFakeTransactions();
		const environment = { transactions: fake.transactions };
		const recurring = allocationInput("legacy:claude_code", "a".repeat(64));

		const first = await allocateSessionRevision(recurring, environment);
		const intervening = await allocateSessionRevision(
			allocationInput("legacy:claude_code", "b".repeat(64)),
			environment,
		);
		const replacement = await allocateSessionRevision(
			{ ...recurring, allowReceiptPromotion: true },
			environment,
		);

		expect(BigInt(replacement)).toBe(BigInt(intervening) + 1n);
		expect(BigInt(replacement)).toBeGreaterThan(BigInt(first));
		expect(fake.allocationCount()).toBe(3);
	});

	test("uses a short row-lock transaction and an atomic head update", () => {
		expect(LOCK_SESSION_REVISION_HEAD_SQL).toContain("FOR UPDATE");
		expect(READ_SESSION_OPERATION_REVISION_SQL).toContain("operation_id = $3");
		expect(READ_SESSION_OPERATION_REVISION_SQL).toContain(
			"content_sha256 = $4",
		);
		expect(ALLOCATE_SESSION_REVISION_SQL).toContain(
			"EXTRACT(EPOCH FROM clock_timestamp())",
		);
		expect(ALLOCATE_SESSION_REVISION_SQL).toContain("RETURNING");
		expect(RECORD_SESSION_OPERATION_REVISION_SQL).toContain("ON CONFLICT");
		expect(RECORD_SESSION_OPERATION_REVISION_SQL).toContain(
			"revision = EXCLUDED.revision",
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
		expect(
			buildSessionRevisionOperationId(
				"codex",
				"job-1",
				"00000000-0000-4000-8000-000000000010",
			),
		).toBe("r2:job-1");
		expect(
			buildSessionRevisionOperationId(
				"codex",
				undefined,
				"00000000-0000-4000-8000-000000000010",
			),
		).toBe("op:00000000-0000-4000-8000-000000000010");
		expect(buildSessionRevisionOperationId("codex", undefined, undefined)).toBe(
			"legacy:codex",
		);
	});
});
