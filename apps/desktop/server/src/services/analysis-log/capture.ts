import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import type { AnalysisHost, AnalysisTrace } from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { recordQuery } from "./analysis-log.service.js";
import { loggableError } from "./errors.js";
import { describeSessions, referencedSessionIds } from "./sessions.js";
import type { AnalysisLog, QuerySession } from "./types.js";

const logger = getLogger(["rudel", "api", "analysis-log"]);
const TRACE_FIELDS = ["analysis"] as const;

/**
 * Stores a find, read or sql call in the analysis log. Best effort: the call's result
 * is returned even when the log cannot store it (then without a trace).
 * Trace input the log refuses (an unknown step, another author's analysis, a
 * full analysis named by id) fails the call, so the agent learns what to
 * change; a call without an analysis id never fails for a full analysis.
 * `owners` are the members whose sessions the call read, which account
 * deletion needs even when the output names none of their sessions.
 * `sessions` are the sessions the output names when the caller already
 * looked them up; otherwise they are found in the output. `quotes` is the
 * sql gateway's verdict on whether the rows it showed carry transcript text
 * (find and read are judged from their output).
 */
export async function captureCall(
	executor: ClickHouseExecutor,
	log: AnalysisLog | null,
	author: { workspaceId: string; userId: string; host: AnalysisHost },
	tool: "find" | "read" | "sql",
	input: Record<string, unknown>,
	output: unknown,
	owners: readonly string[],
	sessions?: readonly QuerySession[],
	quotes?: boolean,
): Promise<AnalysisTrace | undefined> {
	if (!log) return undefined;
	try {
		const args = Object.fromEntries(
			Object.entries(input).filter(
				([key]) => !(TRACE_FIELDS as readonly string[]).includes(key),
			),
		);
		const trace = Object.fromEntries(
			TRACE_FIELDS.flatMap((key) =>
				typeof input[key] === "string" ? [[key, input[key]]] : [],
			),
		);
		return await recordQuery(log, author, {
			tool,
			args,
			trace,
			output,
			outputChars: JSON.stringify(output).length,
			sessions: sessions
				? [...sessions]
				: await describeSessions(
						executor,
						author.workspaceId,
						referencedSessionIds(output),
					),
			owners,
			...(quotes === undefined ? {} : { quotes }),
		});
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		logger.warn("Analysis log could not store a {tool} call: {error}", {
			tool,
			error: loggableError(error),
		});
		return undefined;
	}
}

/** Where a request came from: the MCP plugin, the CLI (API key) or the web app (Home agent). */
export function hostOf(context: {
	session: { id: string } | null;
	apiKeyId: string | null;
}): AnalysisHost {
	if (context.session?.id.startsWith("mcp:")) return "plugin";
	return context.apiKeyId ? "cli" : "home";
}
