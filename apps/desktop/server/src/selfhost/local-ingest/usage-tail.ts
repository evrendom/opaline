import { open } from "node:fs/promises";
import {
	calculateEstimatedCost,
	getLongContextThresholdTokens,
	resolveCanonicalModelIdentity,
} from "@rudel/api-routes/model-pricing";
import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import { USAGE_EVENTS_PENDING_TABLE } from "@rudel/ch-schema/usage-events-pending";
import { extractUsageEvents, type UsageEvent } from "@rudel/usage-events";
import type { ClickHouseExecutor } from "../../clickhouse.js";

/** One transcript file of a session, read from where the last import stopped. */
export interface UsageTailFile {
	readonly path: string;
	/** Bytes the last import covered; 0 for a file it did not see. */
	readonly fromByte: number;
	/** The subagent's ID, or null for the main transcript. */
	readonly agentId: string | null;
}

export interface UsageTailJob {
	readonly sessionId: string;
	readonly source: "claude_code";
	readonly files: readonly UsageTailFile[];
}

export interface UsageTailOwner {
	readonly organizationId: string;
	readonly userId: string;
}

/** Appended bytes read per file per tail; a larger backlog waits for the import. */
const MAX_TAIL_BYTES = 16 * 1024 * 1024;
const NEWLINE = 0x0a;

async function appendedLines(file: UsageTailFile): Promise<string> {
	const handle = await open(file.path, "r");
	try {
		const { size } = await handle.stat();
		if (size <= file.fromByte) return "";
		const length = Math.min(size - file.fromByte, MAX_TAIL_BYTES);
		const buffer = new Uint8Array(length);
		let read = 0;
		while (read < length) {
			const { bytesRead } = await handle.read(
				buffer,
				read,
				length - read,
				file.fromByte + read,
			);
			if (bytesRead === 0) break;
			read += bytesRead;
		}
		// Only complete lines: a partial last line is read on the next tail.
		const last = buffer.subarray(0, read).lastIndexOf(NEWLINE);
		return last === -1
			? ""
			: new TextDecoder().decode(buffer.subarray(0, last));
	} finally {
		await handle.close();
	}
}

function toTimestamp(value: string): string {
	return value.replace("T", " ").replace("Z", "");
}

/** A request as a `usage_events_pending` row, priced with the stored sessions' rate card. */
export function pendingUsageRow(
	event: UsageEvent,
	observedAt: Date,
): Record<string, unknown> | null {
	if (!event.occurredAt || !event.usageDate) return null;
	const model = event.resolvedModel || event.rawModel;
	const pricingModel = resolveCanonicalModelIdentity(model)?.model ?? model;
	const cacheWrite5m =
		event.cacheWrite5mInputTokens ?? event.cacheWriteInputTokens ?? 0;
	const cacheWrite1h = event.cacheWrite1hInputTokens ?? 0;
	const estimatedCost = model
		? calculateEstimatedCost({
				model,
				inputTokens: event.uncachedInputTokens,
				outputTokens: event.outputTokens,
				cacheReadInputTokens: event.cacheReadInputTokens,
				cacheCreationInputTokens: cacheWrite5m,
				cacheCreation1hInputTokens: cacheWrite1h,
				contextInputTokens: event.contextInputTokens,
				modelProvider: event.modelProvider,
				serviceTier: event.serviceTier,
				inferenceSpeed: event.inferenceSpeed,
				inferenceGeo: event.inferenceGeo,
				at: event.occurredAt,
				precision: 10,
			})
		: null;
	return {
		organization_id: event.organizationId,
		user_id: event.userId,
		source: event.source,
		session_id: event.sessionId,
		event_id: event.eventId,
		agent_id: event.agentId,
		occurred_at: toTimestamp(event.occurredAt),
		usage_date: event.usageDate,
		raw_model: event.rawModel,
		resolved_model: event.resolvedModel,
		model_status: event.modelStatus,
		service_tier: event.serviceTier,
		model_provider: event.modelProvider,
		inference_speed: event.inferenceSpeed,
		inference_geo: event.inferenceGeo,
		context_input_tokens: String(event.contextInputTokens),
		uncached_input_tokens: String(event.uncachedInputTokens),
		cache_read_input_tokens: String(event.cacheReadInputTokens),
		cache_write_5m_input_tokens: String(cacheWrite5m),
		cache_write_1h_input_tokens: String(cacheWrite1h),
		output_tokens: String(event.outputTokens),
		quality_flags: [...event.qualityFlags],
		pricing_model: pricingModel,
		context_band:
			event.contextInputTokens > getLongContextThresholdTokens(pricingModel)
				? "long"
				: "base",
		has_geo_gap: event.qualityFlags.includes("inference_geo_not_available")
			? 1
			: 0,
		estimated_cost: estimatedCost,
		observed_at: toTimestamp(observedAt.toISOString()),
	};
}

/**
 * The requests in a live session's transcript lines appended since its last
 * import, extracted with the same extractor (and slimming) as the import, so
 * each has the event_id the import will store it under.
 */
export async function readAppendedUsage(
	job: UsageTailJob,
	owner: UsageTailOwner,
	observedAt: Date = new Date(),
): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];
	for (const file of job.files) {
		let text: string;
		try {
			text = await appendedLines(file);
		} catch {
			continue; // A file that disappeared is the import's to handle.
		}
		if (!text) continue;
		const extract = (content: string) => {
			const result = extractUsageEvents({
				organizationId: owner.organizationId,
				userId: owner.userId,
				sessionId: job.sessionId,
				source: job.source,
				content: file.agentId === null ? content : "",
				subagents: file.agentId === null ? {} : { [file.agentId]: content },
			});
			return result.status === "complete" ? result.events : null;
		};
		const slimmed = slimTranscriptText(text);
		// One malformed record makes the whole extraction incomplete; then each
		// line is read on its own so the rest still count.
		const events =
			extract(slimmed) ??
			slimmed.split("\n").flatMap((line) => extract(line) ?? []);
		for (const event of events) {
			const row = pendingUsageRow(event, observedAt);
			if (row) rows.push(row);
		}
	}
	return rows;
}

export async function writePendingUsage(
	clickhouse: Pick<ClickHouseExecutor, "insert">,
	rows: readonly Record<string, unknown>[],
): Promise<void> {
	if (rows.length === 0) return;
	await clickhouse.insert({
		table: USAGE_EVENTS_PENDING_TABLE,
		values: [...rows],
	});
}
