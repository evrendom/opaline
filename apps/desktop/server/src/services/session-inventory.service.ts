import type {
	CliSessionInventoryEntry,
	CliSessionInventoryInput,
} from "@rudel/api-routes";
import type { RudelSessionInventoryRow } from "@rudel/ch-schema/generated";
import { SESSION_INVENTORY_TABLE } from "@rudel/ch-schema/session-inventory";
import type { ClickHouseExecutor } from "../clickhouse.js";

export interface SessionInventoryOwner {
	readonly organizationId: string;
	readonly userId: string;
}

const INSERT_BATCH_ROWS = 5_000;

export function sessionInventoryRows(
	owner: SessionInventoryOwner,
	input: CliSessionInventoryInput,
	reportedAt: Date,
): RudelSessionInventoryRow[] {
	const at = clickHouseTime(reportedAt);
	const report: RudelSessionInventoryRow = {
		organization_id: owner.organizationId,
		user_id: owner.userId,
		row_kind: "report",
		source: "",
		session_id: "",
		reported_at: at,
		main_lines: 0,
		subagent_lines: 0,
		subagent_files: 0,
		main_bytes: "0",
		subagent_bytes: "0",
		modified_at: at,
		started_at: null,
		cli_version: input.cliVersion ?? "",
		session_count: input.sessions.length,
		omitted_count: input.omitted ?? 0,
	};
	return [
		...input.sessions.map((session) => sessionRow(owner, session, at)),
		report,
	];
}

export async function recordSessionInventory(
	executor: ClickHouseExecutor,
	owner: SessionInventoryOwner,
	input: CliSessionInventoryInput,
	options: { reportedAt: Date; assertWritable: () => Promise<void> },
): Promise<number> {
	const rows = sessionInventoryRows(owner, input, options.reportedAt);
	for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_ROWS) {
		await options.assertWritable();
		await executor.insert({
			table: SESSION_INVENTORY_TABLE,
			values: rows.slice(offset, offset + INSERT_BATCH_ROWS),
			asyncInsert: false,
		});
	}
	return input.sessions.length;
}

function sessionRow(
	owner: SessionInventoryOwner,
	session: CliSessionInventoryEntry,
	reportedAt: string,
): RudelSessionInventoryRow {
	return {
		organization_id: owner.organizationId,
		user_id: owner.userId,
		row_kind: "session",
		source: session.source,
		session_id: session.sessionId,
		reported_at: reportedAt,
		main_lines: session.mainLines,
		subagent_lines: session.subagentLines,
		subagent_files: session.subagentFiles,
		main_bytes: String(session.mainBytes),
		subagent_bytes: String(session.subagentBytes),
		modified_at: clickHouseTime(new Date(session.modifiedAt)),
		started_at: session.startedAt
			? clickHouseTime(new Date(session.startedAt))
			: null,
		cli_version: "",
		session_count: 0,
		omitted_count: 0,
	};
}

function clickHouseTime(value: Date): string {
	return value.toISOString().replace("T", " ").slice(0, 23);
}
