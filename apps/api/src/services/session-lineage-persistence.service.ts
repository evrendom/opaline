import { createHmac } from "node:crypto";
import {
	type ChildLineageEvidence,
	SESSION_LINEAGE_DERIVATION_VERSION,
	type SessionLineageEdge,
} from "@rudel/api-routes";
import {
	ingestRudelSessionLineage,
	type RudelSessionLineageRow,
} from "@rudel/ch-schema/generated";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";

const INPUT_SEQUENCE_BITS = 48n;
const MAX_INPUT_SEQUENCE = (1n << INPUT_SEQUENCE_BITS) - 1n;

export interface SessionLineageRowBuildInput {
	readonly edge: SessionLineageEdge;
	readonly fingerprintKey: string;
	readonly derivedAt: Date | string;
	readonly inputEvidenceAt?: string;
}

export function buildSessionLineageRow(
	input: SessionLineageRowBuildInput,
): RudelSessionLineageRow {
	const inputSequence = resolveInputSequence(input.edge, input.inputEvidenceAt);
	const replacementVersion = encodeReplacementVersion(inputSequence);

	return {
		anchor_operation_ordinal: input.edge.anchor.operationOrdinal,
		anchor_tool_use_id: input.edge.anchor.toolUseId,
		anchor_ts: toClickHouseDateTime(input.edge.anchor.anchorTs),
		carrier:
			input.edge.anchor.parentSource === "codex"
				? "codex_custom_exec"
				: "claude_bash",
		child_entrypoint: input.edge.child.entrypoint ?? "",
		child_first_ingested_at: toClickHouseDateTime(
			input.edge.child.childFirstIngestedAt,
		),
		child_model: input.edge.child.model,
		child_originator: input.edge.child.originator ?? "",
		child_session_date: toClickHouseDateTime(input.edge.child.childSessionDate),
		child_session_id: input.edge.child.childSessionId,
		child_source: input.edge.child.childSource,
		child_start_ts: toClickHouseDateTime(input.edge.child.childStartTs),
		confidence: input.edge.confidence,
		countable: input.edge.countable ? 1 : 0,
		derivation_version: SESSION_LINEAGE_DERIVATION_VERSION,
		derived_at: toClickHouseDateTime(input.derivedAt),
		input_sequence: inputSequence.toString(),
		organization_id: input.edge.child.organizationId,
		outcome: input.edge.child.outcome,
		parent_session_date: toClickHouseDateTime(
			input.edge.anchor.parentSessionDate,
		),
		parent_session_id: input.edge.anchor.parentSessionId,
		parent_source: input.edge.anchor.parentSource,
		prompt_fingerprint: fingerprintPrompt(
			input.edge.anchor.prompt,
			input.fingerprintKey,
		),
		reason: input.edge.reason,
		replacement_version: replacementVersion.toString(),
		user_id: input.edge.child.userId,
		workdir: input.edge.child.workdir ?? input.edge.anchor.workdir ?? "",
	};
}

export function buildUnmatchedSessionLineageRow(input: {
	readonly child: ChildLineageEvidence;
	readonly derivedAt: Date | string;
	readonly fingerprintKey: string;
	readonly inputEvidenceAt: string;
}): RudelSessionLineageRow {
	const inputSequence = BigInt(
		toUnixTimestampMilliseconds(input.inputEvidenceAt),
	);
	return {
		anchor_operation_ordinal: 0,
		anchor_tool_use_id: "",
		anchor_ts: toClickHouseDateTime(input.child.childStartTs),
		carrier: "unmatched",
		child_entrypoint: input.child.entrypoint ?? "",
		child_first_ingested_at: toClickHouseDateTime(
			input.child.childFirstIngestedAt,
		),
		child_model: input.child.model,
		child_originator: input.child.originator ?? "",
		child_session_date: toClickHouseDateTime(input.child.childSessionDate),
		child_session_id: input.child.childSessionId,
		child_source: input.child.childSource,
		child_start_ts: toClickHouseDateTime(input.child.childStartTs),
		confidence: "ambiguous",
		countable: 0,
		derivation_version: SESSION_LINEAGE_DERIVATION_VERSION,
		derived_at: toClickHouseDateTime(input.derivedAt),
		input_sequence: inputSequence.toString(),
		organization_id: input.child.organizationId,
		outcome: input.child.outcome,
		parent_session_date: toClickHouseDateTime(input.child.childSessionDate),
		parent_session_id: "",
		parent_source: "",
		prompt_fingerprint: fingerprintPrompt("", input.fingerprintKey),
		reason: "unmatched child candidate",
		replacement_version: encodeReplacementVersion(inputSequence).toString(),
		user_id: input.child.userId,
		workdir: input.child.workdir ?? "",
	};
}

export function fingerprintPrompt(
	prompt: string,
	fingerprintKey: string,
): string {
	if (fingerprintKey.length < 32) {
		throw new Error(
			"Session-lineage fingerprint key must contain at least 32 characters",
		);
	}
	return createHmac("sha256", fingerprintKey)
		.update(`v${SESSION_LINEAGE_DERIVATION_VERSION}\u0000`)
		.update(prompt)
		.digest("hex");
}

export function resolveInputSequence(
	edge: SessionLineageEdge,
	inputEvidenceAt?: string,
): bigint {
	const parentSequence = toUnixTimestampMilliseconds(
		edge.anchor.parentIngestedAt,
	);
	const childSequence = toUnixTimestampMilliseconds(
		edge.child.childLatestIngestedAt,
	);
	const scopeSequence = inputEvidenceAt
		? toUnixTimestampMilliseconds(inputEvidenceAt)
		: 0;
	const inputSequence = BigInt(
		Math.max(parentSequence, childSequence, scopeSequence),
	);
	if (inputSequence > MAX_INPUT_SEQUENCE) {
		throw new Error("Session-lineage input sequence exceeds the 48-bit budget");
	}
	return inputSequence;
}

function encodeReplacementVersion(inputSequence: bigint): bigint {
	if (inputSequence > MAX_INPUT_SEQUENCE) {
		throw new Error("Session-lineage input sequence exceeds the 48-bit budget");
	}
	return (
		(BigInt(SESSION_LINEAGE_DERIVATION_VERSION) << INPUT_SEQUENCE_BITS) |
		inputSequence
	);
}

export async function insertSessionLineageRows(
	executor: ClickHouseExecutor,
	rows: readonly RudelSessionLineageRow[],
): Promise<void> {
	if (rows.length === 0) return;
	await ingestRudelSessionLineage(
		{
			insert: ({ table, values }) =>
				executor.insert({ asyncInsert: false, table, values }),
		},
		[...rows],
	);
}

export function insertSessionLineageRowsWithDefaultExecutor(
	rows: readonly RudelSessionLineageRow[],
): Promise<void> {
	return insertSessionLineageRows(getClickhouse(), rows);
}

function toUnixTimestampMilliseconds(value: string): number {
	const timestamp = Date.parse(value);
	if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
		throw new Error("Session-lineage input timestamp is invalid");
	}
	return timestamp;
}

function toClickHouseDateTime(value: Date | string): string {
	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error("Session-lineage timestamp is invalid");
	}
	return parsed.toISOString().replace("T", " ").replace("Z", "");
}
