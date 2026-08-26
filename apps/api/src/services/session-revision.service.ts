import { createHash } from "node:crypto";

const REVISION_SEQUENCE_BITS = 16n;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export const LOCK_SESSION_REVISION_HEAD_SQL = `
	SELECT revision_head::text AS "revisionHead"
	FROM session_ownership
	WHERE organization_id = $1
		AND session_id = $2
		AND user_id = $3
	FOR UPDATE
`;

export const READ_SESSION_OPERATION_REVISION_SQL = `
	SELECT revision::text AS revision
	FROM session_ingest_revision
	WHERE organization_id = $1
		AND session_id = $2
		AND operation_id = $3
		AND content_sha256 = $4
`;

export const ALLOCATE_SESSION_REVISION_SQL = `
	UPDATE session_ownership
	SET revision_head = GREATEST(revision_head + 1, $4::bigint)
	WHERE organization_id = $1
		AND session_id = $2
		AND user_id = $3
	RETURNING revision_head::text AS revision
`;

export const RECORD_SESSION_OPERATION_REVISION_SQL = `
	INSERT INTO session_ingest_revision (
		organization_id,
		session_id,
		operation_id,
		content_sha256,
		revision
	)
	VALUES ($1, $2, $3, $4, $5::bigint)
`;

interface SessionRevisionRow {
	readonly [key: string]: unknown;
}

export type SessionRevisionExecute = (
	query: string,
	parameters: readonly (number | string)[],
) => Promise<readonly SessionRevisionRow[]>;

export interface SessionRevisionTransactionRunner {
	run(
		operation: (execute: SessionRevisionExecute) => Promise<string>,
	): Promise<string>;
}

export interface AllocateSessionRevisionInput {
	readonly contentSha256: string;
	readonly operationId: string;
	readonly organizationId: string;
	readonly sessionId: string;
	readonly userId: string;
}

export interface AllocateSessionRevisionEnvironment {
	readonly now: () => Date;
	readonly transactions: SessionRevisionTransactionRunner;
}

const DEFAULT_ENVIRONMENT: AllocateSessionRevisionEnvironment = {
	now: () => new Date(),
	transactions: {
		run: async (operation) => {
			const { sqlClient } = await import("../db.js");
			return sqlClient.begin((transaction) =>
				operation((query, parameters) =>
					transaction.unsafe(query, [...parameters]),
				),
			);
		},
	},
};

export async function allocateSessionRevision(
	input: AllocateSessionRevisionInput,
	environment: AllocateSessionRevisionEnvironment = DEFAULT_ENVIRONMENT,
): Promise<string> {
	validateAllocationInput(input);
	const minimumRevision = buildMinimumSessionRevision(environment.now());

	return environment.transactions.run(async (execute) => {
		const lockedHead = await execute(LOCK_SESSION_REVISION_HEAD_SQL, [
			input.organizationId,
			input.sessionId,
			input.userId,
		]);
		if (lockedHead.length !== 1) {
			throw new Error("Session revision head was not found for its owner");
		}

		const existing = await execute(READ_SESSION_OPERATION_REVISION_SQL, [
			input.organizationId,
			input.sessionId,
			input.operationId,
			input.contentSha256,
		]);
		if (existing.length > 1) {
			throw new Error("Session operation has multiple revision receipts");
		}
		if (existing[0]) return readRevision(existing[0]);

		const allocated = await execute(ALLOCATE_SESSION_REVISION_SQL, [
			input.organizationId,
			input.sessionId,
			input.userId,
			minimumRevision,
		]);
		if (allocated.length !== 1 || !allocated[0]) {
			throw new Error("Session revision allocation failed");
		}
		const revision = readRevision(allocated[0]);
		await execute(RECORD_SESSION_OPERATION_REVISION_SQL, [
			input.organizationId,
			input.sessionId,
			input.operationId,
			input.contentSha256,
			revision,
		]);
		return revision;
	});
}

export function buildSessionRevisionOperationId(
	source: "claude_code" | "codex",
	durableOperationId: string | undefined,
): string {
	return durableOperationId ? `r2:${durableOperationId}` : `legacy:${source}`;
}

export function buildSessionRevisionDeduplicationToken(
	input: AllocateSessionRevisionInput,
	revision: string,
	table: string,
): string {
	return `session-revision:${createHash("sha256")
		.update(
			JSON.stringify([
				input.organizationId,
				input.sessionId,
				input.operationId,
				input.contentSha256,
				revision,
				table,
			]),
		)
		.digest("hex")}`;
}

export function buildMinimumSessionRevision(now: Date): string {
	const epochMilliseconds = now.getTime();
	if (!Number.isSafeInteger(epochMilliseconds) || epochMilliseconds < 0) {
		throw new Error("Session revision clock must return a valid epoch date");
	}
	const revision = BigInt(epochMilliseconds) << REVISION_SEQUENCE_BITS;
	if (revision > MAX_POSTGRES_BIGINT) {
		throw new Error("Session revision exceeds the Postgres bigint range");
	}
	return revision.toString();
}

function validateAllocationInput(input: AllocateSessionRevisionInput): void {
	if (!/^[a-f0-9]{64}$/u.test(input.contentSha256)) {
		throw new Error("Session revision content hash must be lowercase SHA-256");
	}
	for (const [name, value] of Object.entries({
		operationId: input.operationId,
		organizationId: input.organizationId,
		sessionId: input.sessionId,
		userId: input.userId,
	})) {
		if (value.trim() === "") {
			throw new Error(`Session revision ${name} must not be empty`);
		}
	}
}

function readRevision(row: SessionRevisionRow): string {
	const revision = Reflect.get(row, "revision");
	if (typeof revision !== "string" || !/^[1-9]\d*$/u.test(revision)) {
		throw new Error("Session revision query returned an invalid revision");
	}
	return revision;
}
