import { MCP_TOOL_CALLS_TABLE } from "@rudel/ch-schema/mcp-tool-calls";
import { z } from "zod";
import type { ClickHouseExecutor } from "../../clickhouse.js";

const CLAIM =
	/\b(?:never|none of|no sessions?\b|0 of \d|zero of \d|only \d[\d,]* of \d)/iu;
const STREAM_VIEW =
	/\b(?:from|join)\s+(?:calls|prompts|events|setup_files)\b/iu;
const MAIN_STREAM =
	/(?:\b(?:\w+\.)?agent_id\s*={1,2}\s*''|\bempty\s*\(\s*(?:\w+\.)?agent_id\s*\)|\blength\s*\(\s*(?:\w+\.)?agent_id\s*\)\s*=\s*0)/iu;
const EXACT_SEARCH =
	/\bsearch\s*\(\s*'(?:[^'\\]|\\.)*'\s*,\s*'(?:exact|regex)'/iu;
const CLAIM_CHARS = 120;

export interface DraftCall {
	readonly tool: string;
	readonly args: Readonly<Record<string, unknown>>;
}

export function absenceClaims(texts: readonly string[]): string[] {
	const claims = texts.flatMap((text) =>
		text
			.split(/(?<=[.!?])\s+|\n+/u)
			.map((sentence) => sentence.trim())
			.filter((sentence) => CLAIM.test(sentence)),
	);
	return [...new Set(claims)].map((claim) =>
		claim.length > CLAIM_CHARS ? `${claim.slice(0, CLAIM_CHARS - 1)}…` : claim,
	);
}

export function confirmsAcrossStreams(call: DraftCall): boolean {
	if (call.tool !== "sql" || typeof call.args.query !== "string") return false;
	const query = call.args.query;
	return (
		EXACT_SEARCH.test(query) ||
		(STREAM_VIEW.test(query) && !MAIN_STREAM.test(query))
	);
}

export function absenceWarnings(input: {
	readonly finalAnswer: string;
	readonly findings: readonly { readonly finding: string }[];
	readonly calls: readonly DraftCall[];
	readonly runOpened: boolean;
}): string[] {
	const claims = absenceClaims([
		input.finalAnswer,
		...input.findings.map((item) => item.finding),
	]);
	if (claims.length === 0) return [];
	const counted = input.calls.some(confirmsAcrossStreams);
	const read =
		input.runOpened || input.calls.some((call) => call.tool === "read");
	if (counted && read) return [];
	const missing = [
		...(counted
			? []
			: [
					"no step that counted every stream (sql over calls, prompts, events or setup_files without agent_id = '', or search('…', 'exact'))",
				]),
		...(read ? [] : ["no run that was read (run or read)"]),
	].join(" and ");
	return claims.map(
		(claim) =>
			`warning: "${claim}" says something never or rarely happened, but this answer has ${missing}. It is saved; confirm the claim that way and save an update if it changes.`,
	);
}

const OPENED = z.object({ opened: z.coerce.number() });

export function runOpenedSince(
	executor: Pick<ClickHouseExecutor, "query">,
): (workspaceId: string, userId: string, since: string) => Promise<boolean> {
	return async (workspaceId, userId, since) => {
		const rows = await executor.query<unknown>({
			query: `SELECT count() > 0 AS opened FROM ${MCP_TOOL_CALLS_TABLE}
				WHERE tool IN ('run', 'read') AND called_at >= parseDateTime64BestEffort({since:String}, 3, 'UTC')
					AND organization_id = {workspaceId:String} AND user_id = {userId:String} AND is_error = 0`,
			query_params: { since, workspaceId, userId },
			clickhouse_settings: { readonly: "1", max_execution_time: 5 },
		});
		return rows.some((row) => OPENED.parse(row).opened > 0);
	};
}
