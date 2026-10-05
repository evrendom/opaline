import type {
	AnalysisFindOutput,
	AnalysisHistoryGetOutput,
	AnalysisHistoryQueryOutput,
	AnalysisHistorySearchOutput,
	AnalysisReadOutput,
	AnalysisScope,
	AnalysisTrace,
	RunRef,
} from "@rudel/api-routes";
import { cell, formatReadOutput } from "../services/analysis/read-output.js";

export function renderFind(output: AnalysisFindOutput): string {
	const header = output.header;
	const lines = [
		`${output.source} ${header.from}..${header.to} sessions=${header.sessionsInScope} indexed=${header.indexedSessions} runs=${header.runsInScope}`,
		`minutes=${header.minutes} activeMinutes=${header.activeMinutes} costUsd=${header.pricedCostUsd} unattributedCostUsd=${header.unattributedCostUsd} unpricedRuns=${header.unpricedRuns} rawChars=${header.rawChars} classifier=${header.classifierVersion} truncated=${header.truncated}`,
		...header.notes.map((note) => `note: ${cell(note)}`),
		...(header.cursor
			? [
					`more: pass cursor=${header.cursor} with the same arguments to continue`,
				]
			: []),
		...(header.trace ? [traceLine(header.trace)] : []),
	];
	if (output.source === "runs") {
		if ("rows" in output) {
			lines.push(
				table(
					[
						"ref",
						"startedAt",
						"minutes",
						"activeMinutes",
						"costUsd",
						"model",
						"models",
						"repository",
						"agent",
						"edits",
						"toolCalls",
						"failedCalls",
						"readCalls",
						"searchCalls",
						"notFound",
						"nextReaction",
						"rawChars",
						"parentSessionId",
						"depth",
						"promptHead",
					],
					output.rows.map((row) => [
						refText(row.ref),
						row.startedAt,
						row.minutes,
						row.activeMinutes,
						row.costUsd,
						row.model,
						row.models.join(","),
						row.repository,
						row.agent,
						row.edits,
						row.toolCalls,
						row.failedCalls,
						row.readCalls,
						row.searchCalls,
						row.notFound,
						row.nextReaction,
						row.rawChars,
						row.parentSessionId,
						row.depth,
						row.promptHead,
					]),
				),
			);
		} else
			lines.push(
				table(
					["key", "runs", "sessions", "minutes", "activeMinutes", "costUsd"],
					output.groups.map((group) => [
						group.key,
						group.runs,
						group.sessions,
						group.minutes,
						group.activeMinutes,
						group.costUsd,
					]),
				),
			);
	} else if (output.source === "tool") {
		lines.push(
			table(
				[
					"toolGroup",
					"cause",
					"detail",
					"kind",
					"count",
					"sessions",
					"firstSeen",
					"lastSeen",
					"topCommands",
					"minutes",
					"costUsd",
					"examples",
				],
				output.groups.map((group) => [
					group.toolGroup,
					group.cause,
					group.detail,
					group.kind,
					group.count,
					group.sessions,
					group.firstSeen,
					group.lastSeen,
					group.topCommands.join("; "),
					group.minutes,
					group.costUsd,
					group.examples
						.map(
							(example) =>
								`${refText(example.ref)}@${example.record}${example.parentSessionId ? ` (subagent thread of ${example.parentSessionId})` : ""} ${example.errorLine}`,
						)
						.join("; "),
				]),
			),
		);
	} else {
		lines.push(
			table(
				[
					"type",
					"terms",
					"eventRef",
					"originRef",
					"originMinutes",
					"originCostUsd",
					"partial",
					"parentSessionId",
					"quote",
				],
				output.events.map((event) => [
					event.type,
					event.terms.join("; "),
					`${refText(event.eventRef)}@${event.eventRef.record}`,
					event.originRef ? refText(event.originRef) : null,
					event.originMinutes,
					event.originCostUsd,
					event.partial,
					event.parentSessionId,
					event.quote,
				]),
			),
		);
		lines.push(
			table(
				["type", "count", "sessions"],
				output.groups.map((group) => [group.type, group.count, group.sessions]),
			),
		);
	}
	return lines.join("\n");
}

/**
 * `analysis.read` already fitted the output to its budget; this only formats
 * it. The trace line is outside that budget (about 60 characters).
 */
export function renderRead(output: AnalysisReadOutput): string {
	const text = formatReadOutput(output);
	return output.trace ? `${traceLine(output.trace)}\n${text}` : text;
}

export function renderAnalysisSearch(
	output: AnalysisHistorySearchOutput,
): string {
	if (!output.analyses.length) return "no past analyses";
	return table(
		[
			"analysis",
			"status",
			"mine",
			"shared",
			"host",
			"cutoff",
			"scope",
			"match",
			"question",
			"answer",
		],
		output.analyses.map((analysis) => [
			analysis.id,
			analysis.status,
			analysis.mine,
			analysis.shared,
			analysis.host,
			analysis.cutoff,
			scopeText(analysis.scope),
			analysis.match.kind === "step"
				? `step ${analysis.match.step}: ${analysis.match.text}`
				: analysis.match.kind,
			analysis.question,
			analysis.answerHead,
		]),
	);
}

export function renderAnalysisTree(output: AnalysisHistoryGetOutput): string {
	const lines = [
		`analysis ${output.id} status=${output.status} mine=${output.mine} shared=${output.shared} host=${output.host} cutoff=${output.cutoff}${output.updates ? ` updates=${output.updates}` : ""}`,
		`scope ${scopeText(output.scope)}`,
		`question: ${cell(output.question)}`,
		output.cost
			? `cost ${output.cost.source} model=${output.cost.model} input=${output.cost.inputTokens} cached=${output.cost.cachedInputTokens} cacheWrite=${output.cost.cacheWriteTokens} output=${output.cost.outputTokens} reasoning=${output.cost.reasoningTokens} usd=${output.cost.costUsd ?? "unpriced"}`
			: "cost unavailable",
		...output.notes.map((note) => `note: ${cell(note)}`),
	];
	const depth = new Map<string, number>();
	for (const step of output.steps) {
		const level = step.parent ? (depth.get(step.parent) ?? 0) + 1 : 0;
		depth.set(step.id, level);
		const indent = "  ".repeat(level);
		lines.push(`${indent}step ${step.id}: ${cell(step.question)}`);
		if (step.reply) lines.push(`${indent}  reply: ${cell(step.reply)}`);
		for (const query of step.queries)
			lines.push(
				`${indent}  query ${query.id} ${query.tool} ${cell(JSON.stringify(query.args))} chars=${query.outputChars}${query.unavailable ? ` unavailable=${query.unavailable}` : ""}`,
			);
		if (step.finding) lines.push(`${indent}  finding: ${cell(step.finding)}`);
	}
	lines.push(
		`final answer: ${output.finalAnswer === null ? "(none yet)" : cell(output.finalAnswer)}`,
	);
	for (const chat of output.chatSessions)
		lines.push(
			`chat session ${chat.sessionId} source=${chat.source} uploaded=${chat.uploadedAt}`,
		);
	return lines.join("\n");
}

export function renderStoredQuery(output: AnalysisHistoryQueryOutput): string {
	const head = `query ${output.id} analysis=${output.analysis} step=${output.step} at=${output.createdAt} stale=${output.stale}${output.unavailable ? ` unavailable=${output.unavailable}` : ""}\nargs ${cell(JSON.stringify(output.call.args))}`;
	if (output.call.tool === "find")
		return output.call.output
			? `${head}\n${renderFind(output.call.output)}`
			: head;
	return output.call.output
		? `${head}\n${renderRead(output.call.output)}`
		: head;
}

function traceLine(trace: AnalysisTrace): string {
	return `trace analysis=${trace.analysis} step=${trace.step} query=${trace.query}`;
}

function scopeText(scope: AnalysisScope): string {
	const filters = Object.entries(scope.filters)
		.map(([key, value]) => `${key}=${value}`)
		.join(" ");
	return `${scope.from ?? "?"}..${scope.to ?? "?"}${filters ? ` ${filters}` : ""}`;
}

function table(
	headers: string[],
	rows: readonly (readonly unknown[])[],
): string {
	return [
		headers.join("\t"),
		...rows.map((row) => row.map(cell).join("\t")),
	].join("\n");
}

function refText(ref: RunRef): string {
	return JSON.stringify({
		sessionId: ref.sessionId,
		agentId: ref.agentId,
		turn: ref.turn,
	});
}
