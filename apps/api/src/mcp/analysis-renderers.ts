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
		`minutes=${header.minutes} activeMinutes=${header.activeMinutes} costUsd=${header.pricedCostUsd} unattributedCostUsd=${header.unattributedCostUsd} unpricedRuns=${header.unpricedRuns} rawChars=${header.rawChars} truncated=${header.truncated}`,
		...header.notes.map((note) => `note: ${cell(note)}`),
		...(output.source === "git" ? linksLine(output.events) : []),
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
	} else if (output.source === "git") {
		lines.push(
			table(
				[
					"ref",
					"at",
					"kind",
					"label",
					"literal",
					"generation",
					"repository",
					"github",
					"sha",
					"pullRequests",
					"ciRunCount",
					"ciRunsObserved",
					"ciConclusions",
					"ciRuns",
					"checksAfter",
					"parentSessionId",
				],
				output.events.map((event) => [
					gitEventAddress(event),
					event.at,
					event.kind,
					event.label,
					[
						event.call && `call=${event.call}`,
						event.branch && `branch=${event.branch}`,
						event.sourceBranch && `from=${event.sourceBranch}`,
						event.shortSha && `commit=${event.shortSha}`,
						event.kind === "push_range" &&
							`push=${event.pushFrom || "new"}..${event.pushTo || "new"}`,
						event.remote && `remote=${event.remote}`,
						event.prRepo && `repo=${event.prRepo}`,
						event.prNumber !== null && `pr=${event.prNumber}`,
						event.runId && `run=${event.runId}`,
						event.baseCommit && `base=${event.baseCommit}`,
						event.commitHash && `head=${event.commitHash}`,
					]
						.filter(Boolean)
						.join(" "),
					event.generation
						? `${event.generation.revision}/${event.generation.parserVersion}${event.generation.current ? "" : " not-current"}`
						: null,
					event.repository
						? `${event.repository.fullName} id=${event.repository.id} (${event.repository.basis}: ${event.repository.value})`
						: null,
					[
						event.github.status,
						event.github.reason && `reason=${event.github.reason}`,
						event.github.prFrom && `prFrom=${event.github.prFrom}`,
						event.github.ciFrom && `ciFrom=${event.github.ciFrom}`,
						event.github.coveredThrough &&
							`coveredThrough=${event.github.coveredThrough}`,
						linksCell(event.edges),
					]
						.filter(Boolean)
						.join(" "),
					event.sha
						? `${event.sha.value ?? "unresolved"} candidates=${event.sha.candidates ?? "unknown"}${event.sha.complete ? "" : " (collection incomplete)"}`
						: null,
					event.pullRequests
						.map(
							(pr) =>
								`repo=${pr.repositoryId}#${pr.number} ${pr.state}${pr.draft ? " draft" : ""}${pr.mergedAt ? ` merged=${pr.mergedAt} merge=${pr.mergeCommitSha}` : ""} head=${pr.headRef}@${pr.headSha}${pr.headRepositoryId !== pr.repositoryId ? ` headRepo=${pr.headRepositoryId}` : ""} [${pr.bases.join(",")}]${pr.commitInHead === null ? "" : ` commitInHead=${pr.commitInHead}`} ${pr.title}`,
						)
						.join("; "),
					event.ciRunCount === null
						? `unknown (${event.ciRunCountUnknown})`
						: `${event.ciRunCount} before ${event.ciRunCountThrough}`,
					event.ciRunsObserved,
					Object.entries(event.ciConclusions)
						.map(([conclusion, count]) => `${conclusion}=${count}`)
						.join(" "),
					event.ciRuns
						.map(
							(run) =>
								`repo=${run.repositoryId} ${run.kind}#${run.runId}.${run.attempt} ${run.workflow} ${run.status}/${run.conclusion ?? "none"} ${run.event} ${run.branch}@${run.headSha} created=${run.createdAt}${run.startedAt && run.startedAt !== run.createdAt ? ` started=${run.startedAt}` : ""} completed=${run.completedAt ?? "unknown"} [${run.edges.map((edge) => `${edge.basis}${edge.linkBasis ? `:${edge.linkBasis}` : ""}${edge.prNumber ? `#${edge.prNumber}` : ""}`).join(",")}]`,
						)
						.join("; "),
					event.checksAfter
						? `ran=${event.checksAfter.count} unconfirmed=${event.checksAfter.unconfirmed} sameCall=${event.checksAfter.sameCall}${event.checksAfter.first ? ` first@${event.checksAfter.first.record} ${event.checksAfter.first.at}` : ""}`
						: null,
					event.parentSessionId,
				]),
			),
		);
		if (output.witnesses?.length)
			lines.push(
				"witnesses: retained edges whose evidence row is not readable",
				table(
					["session", "at", "relation", "matched", "evidence", "reason"],
					output.witnesses.map((witness) => [
						`${witness.sessionId}/${witness.agentId || "main"}${witness.turn === null ? " (no run)" : ` turn ${witness.turn}`}`,
						witness.at,
						witness.relation,
						witness.matchedValue,
						`${witness.evidenceId}@${witness.generation.revision}/${witness.generation.parserVersion}`,
						witness.reason,
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

type GitEvent = Extract<
	AnalysisFindOutput,
	{ source: "git" }
>["events"][number];

/**
 * How a page's links were made, when edges were consulted: events linked
 * from the stored edges and at query time, with the reasons.
 */
function linksLine(events: readonly GitEvent[]): string[] {
	const consulted = events.flatMap((event) =>
		event.edges ? [event.edges] : [],
	);
	if (consulted.length === 0) return [];
	const count = (statuses: readonly string[]) => {
		const counts = new Map<string, number>();
		for (const status of statuses)
			counts.set(status, (counts.get(status) ?? 0) + 1);
		return [...counts]
			.map(([status, n]) => `${n} ${status.replace("_", " ")}`)
			.join(", ");
	};
	const fromEdges = consulted.filter((edges) => edges.linkedBy === "edges");
	const atQuery = consulted.filter((edges) => edges.linkedBy === "query");
	const frozen = fromEdges.filter((edges) => edges.status === "frozen");
	return [
		`links: ${fromEdges.length} events from edges${frozen.length ? ` (${frozen.length} frozen)` : ""}, ${atQuery.length} linked at query time${atQuery.length ? ` (${count(atQuery.map((edges) => edges.status))})` : ""}`,
	];
}

/** An event's link source, only when it is not current edges. */
function linksCell(edges: GitEvent["edges"]): string | null {
	if (!edges || (edges.linkedBy === "edges" && edges.status === "current"))
		return null;
	return `links=${edges.linkedBy}:${edges.status}${edges.builtAt ? ` builtAt=${edges.builtAt}` : ""}`;
}

/**
 * Where an event can be read: a transcript event as `ref@record.block` with the
 * native content block `read` takes (and the match ordinal within it), an
 * evidence event as its origin.
 */
function gitEventAddress(event: GitEvent): string {
	if (event.record === 0)
		return `${event.sessionId}/${event.agentId || "main"} ${event.call}`;
	const block = Math.floor(event.block / 65_536);
	const ordinal = event.block % 65_536;
	const at = `@${event.record}.${block}${ordinal ? ` match ${ordinal}` : ""}`;
	return event.turn === null
		? `${event.sessionId}/${event.agentId || "main"}${at} (no run)`
		: `${refText({ sessionId: event.sessionId, agentId: event.agentId, turn: event.turn })}${at}`;
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
			"cutoff",
			"updates",
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
			analysis.cutoff,
			analysis.updates ?? "",
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
		`analysis ${output.id} status=${output.status} mine=${output.mine} shared=${output.shared} cutoff=${output.cutoff} updates=${output.updates ?? "none"} updatedBy=${output.updatedBy.join(",") || "none"}`,
		`scope ${scopeText(output.scope)}`,
		`question: ${cell(output.question)}`,
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
	if (output.changes.length)
		lines.push(
			`changes against ${output.updates}:`,
			...output.changes.map(
				(change) =>
					`  ${change.change}: step ${change.step}: ${cell(change.finding)} (${cell(change.evidence)})`,
			),
		);
	lines.push(
		`final answer: ${output.finalAnswer === null ? "(none yet)" : cell(output.finalAnswer)}`,
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
