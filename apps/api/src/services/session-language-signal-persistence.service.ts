import { getLogger } from "@logtape/logtape";
import type { Source } from "@rudel/api-routes";
import {
	ingestRudelSessionLanguageSignals,
	type RudelSessionLanguageSignalsRow,
} from "@rudel/ch-schema/generated";
import {
	type LanguageSignalCounts,
	type LanguageSignalSummary,
	SCAN_VERSION,
} from "@rudel/language-signals";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";
import { scanSessionLanguageSignalsOffThread } from "./session-language-signal-scanner.service.js";

const logger = getLogger(["rudel", "api", "session-language-signals"]);

export interface SessionLanguageSignalScanInput {
	readonly content: string;
	readonly organizationId: string;
	readonly rawIngestedAt: Date | string;
	readonly rawRevision: string;
	readonly sessionDate: Date | string;
	readonly sessionId: string;
	readonly source: Source;
	readonly userId: string;
}

interface PersistSessionLanguageSignalsEnvironment {
	readonly insertRows: (
		rows: readonly RudelSessionLanguageSignalsRow[],
	) => Promise<void>;
	readonly now: () => Date;
	readonly scan: (
		content: string,
	) => Promise<LanguageSignalCounts | LanguageSignalSummary>;
}

const DEFAULT_ENVIRONMENT: PersistSessionLanguageSignalsEnvironment = {
	insertRows: (rows) => insertSessionLanguageSignalRows(getClickhouse(), rows),
	now: () => new Date(),
	scan: scanSessionLanguageSignalsOffThread,
};

export async function persistSessionLanguageSignalsBestEffort(
	input: SessionLanguageSignalScanInput,
	env: PersistSessionLanguageSignalsEnvironment = DEFAULT_ENVIRONMENT,
): Promise<void> {
	try {
		await persistSessionLanguageSignals(input, env);
	} catch (error) {
		logger.error(
			"Language-signal persistence failed after raw ingest; reconciliation will retry (organization_id={organizationId} session_id={sessionId} error={error})",
			{
				error: String(error),
				organizationId: input.organizationId,
				sessionId: input.sessionId,
			},
		);
	}
}

export async function persistSessionLanguageSignals(
	input: SessionLanguageSignalScanInput,
	env: PersistSessionLanguageSignalsEnvironment = DEFAULT_ENVIRONMENT,
): Promise<void> {
	const counts = await env.scan(input.content);
	await env.insertRows([
		buildSessionLanguageSignalRow(input, counts, env.now()),
	]);
}

export function persistSessionLanguageSignalsWithExecutor(
	input: SessionLanguageSignalScanInput,
	executor: ClickHouseExecutor,
): Promise<void> {
	return persistSessionLanguageSignals(input, {
		insertRows: (rows) => insertSessionLanguageSignalRows(executor, rows),
		now: () =>
			input.rawIngestedAt instanceof Date
				? input.rawIngestedAt
				: new Date(input.rawIngestedAt),
		scan: scanSessionLanguageSignalsOffThread,
	});
}

export function buildSessionLanguageSignalRow(
	input: Omit<SessionLanguageSignalScanInput, "content">,
	summary: LanguageSignalCounts | LanguageSignalSummary,
	scannedAt: Date | string,
): RudelSessionLanguageSignalsRow {
	const persistedScannedAt = toClickHouseDateTime(scannedAt);
	const matches = hasLanguageSignalMatches(summary)
		? summary
		: EMPTY_LANGUAGE_SIGNAL_MATCHES;

	// Count-only legacy callers cannot claim that exact phrases were indexed.
	const scanVersion = hasLanguageSignalMatches(summary) ? SCAN_VERSION : 4;
	return {
		organization_id: input.organizationId,
		session_date: toClickHouseDateTime(input.sessionDate),
		session_id: input.sessionId,
		user_id: input.userId,
		source: input.source,
		raw_revision: input.rawRevision,
		raw_ingested_at: toClickHouseDateTime(input.rawIngestedAt),
		scan_version: scanVersion,
		member_negative: summary.member_negative,
		member_swears: summary.member_swears,
		member_apologies: summary.member_apologies,
		member_positive: summary.member_positive,
		model_swears: summary.model_swears,
		model_apologies: summary.model_apologies,
		model_positive: summary.model_positive,
		member_swear_matches: [...matches.member_swear_matches],
		member_apology_matches: [...matches.member_apology_matches],
		member_positive_matches: [...matches.member_positive_matches],
		model_swear_matches: [...matches.model_swear_matches],
		model_apology_matches: [...matches.model_apology_matches],
		model_positive_matches: [...matches.model_positive_matches],
		model_apology_counts: { ...matches.model_apology_counts },
		member_negative_counts: { ...matches.member_negative_counts },
		member_positive_counts: { ...matches.member_positive_counts },
		scanned_at: persistedScannedAt,
		signal_version: buildSessionLanguageSignalVersion(
			input.rawRevision,
			scanVersion,
			scannedAt,
		),
	};
}

export function buildSessionLanguageSignalVersion(
	rawRevision: string,
	scanVersion: number,
	scannedAt: Date | string,
): string {
	if (!/^(?:0|[1-9]\d*)$/u.test(rawRevision)) {
		throw new Error("Language-signal raw revision is invalid");
	}
	if (
		!Number.isSafeInteger(scanVersion) ||
		scanVersion < 0 ||
		scanVersion > 65_535
	) {
		throw new Error("Language-signal scan version is invalid");
	}
	const scannedAtMilliseconds = new Date(scannedAt).getTime();
	if (
		!Number.isSafeInteger(scannedAtMilliseconds) ||
		scannedAtMilliseconds < 0
	) {
		throw new Error("Language-signal scan timestamp is invalid");
	}
	return (
		(BigInt(rawRevision) << 64n) +
		(BigInt(scannedAtMilliseconds) << 16n) +
		BigInt(scanVersion)
	).toString();
}

const EMPTY_LANGUAGE_SIGNAL_MATCHES = {
	model_apology_counts: {},
	member_negative_counts: {},
	member_positive_counts: {},

	member_swear_matches: [],
	member_apology_matches: [],
	member_positive_matches: [],
	model_swear_matches: [],
	model_apology_matches: [],
	model_positive_matches: [],
} as const;

function hasLanguageSignalMatches(
	summary: LanguageSignalCounts | LanguageSignalSummary,
): summary is LanguageSignalSummary {
	return "member_swear_matches" in summary;
}

export async function insertSessionLanguageSignalRows(
	executor: ClickHouseExecutor,
	rows: readonly RudelSessionLanguageSignalsRow[],
): Promise<void> {
	if (rows.length === 0) return;
	await ingestRudelSessionLanguageSignals(
		{
			insert: ({ table, values }) => executor.insert({ table, values }),
		},
		[...rows],
	);
}

function toClickHouseDateTime(value: Date | string): string {
	const parsed = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error("Language-signal timestamp is invalid");
	}
	return parsed.toISOString().replace("T", " ").replace("Z", "");
}
