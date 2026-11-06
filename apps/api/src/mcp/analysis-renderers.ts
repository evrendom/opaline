import type {
	AnalysisHistoryGetOutput,
	AnalysisHistoryQueryOutput,
	AnalysisHistorySearchOutput,
	AnalysisHistorySqlResultOutput,
	AnalysisReadOutput,
	AnalysisRunOutput,
	AnalysisSchemaOutput,
	AnalysisScope,
	AnalysisSqlOutput,
	RunQuestionsEstimate,
	RunQuestionsRun,
} from "@rudel/api-routes";
import {
	renderFind,
	table,
	traceLine,
} from "../services/analysis/find-text.js";
import { cell, formatReadOutput } from "../services/analysis/read-output.js";
import { RUN_CUT_NOTE } from "./json-output.js";

export { renderFind };

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
			? `${head}\n${renderFind(output.call.output, output.call.args.verbosity)}`
			: head;
	if (output.call.tool === "sql")
		return output.call.output
			? `${head}\n${renderSql(output.call.output)}`
			: head;
	return output.call.output
		? `${head}\n${renderRead(output.call.output)}`
		: head;
}

/** A stored sql result opened by its id: title and SQL always, the rows unless they are gone. */
export function renderStoredSqlResult(
	output: AnalysisHistorySqlResultOutput,
): string {
	return [
		`sql result=${output.id} title=${cell(output.title)} at=${output.createdAt}${output.unavailable ? ` unavailable=${output.unavailable}` : ""}`,
		`query ${cell(output.query)}`,
		...(output.output
			? [
					`rows=${output.output.rows} truncated=${output.output.truncated}`,
					output.output.table,
					...output.output.notices.map((notice) => `note: ${cell(notice)}`),
				]
			: []),
	].join("\n");
}

/** The run view as text; a cut view says how to see what it left out. */
export function renderRun(output: AnalysisRunOutput): string {
	return output.truncated ? `${output.text}\n${RUN_CUT_NOTE}` : output.text;
}

/** An sql result: its stored id, the table, then what was cut and the not-evidence notice. */
export function renderSql(output: AnalysisSqlOutput): string {
	return [
		`sql result=${output.id} title=${cell(output.title)} rows=${output.rows} truncated=${output.truncated}`,
		output.table,
		...output.notices.map((notice) => `note: ${cell(notice)}`),
		...(output.trace ? [traceLine(output.trace)] : []),
	].join("\n");
}

/** schema in its three steps: the views, one view's columns, one column's values. */
export function renderSchema(output: AnalysisSchemaOutput): string {
	if (output.level === "views")
		return [
			pipeTable(
				["view", "grain", "columns"],
				output.views.map((view) => [view.name, view.grain, view.columns]),
			),
			"approved measures:",
			pipeTable(
				["measure", "sql", "definition"],
				output.measures.map((measure) => [
					measure.name,
					measure.sql,
					measure.definition,
				]),
			),
			...output.notes.map((note) => `note: ${cell(note)}`),
			...(output.questions.length
				? [
						"run questions (answered for every new run where the workspace has run questions; filter run_answers with sql; estimate_questions, then run_questions, only for runs without answers):",
						pipeTable(
							["question_id", "question", "tested runs", "tested precision"],
							output.questions.map((question) => [
								question.id,
								question.question,
								question.testedRuns ?? "untested",
								question.testedPrecision === null
									? "unknown"
									: question.testedPrecision.toFixed(2),
							]),
						),
					]
				: ["note: no run questions are on yet."]),
		].join("\n");
	if (output.level === "columns")
		return [
			`view ${output.view}: ${cell(output.grain)}`,
			...output.traps.map((trap) => `trap: ${cell(trap)}`),
			pipeTable(
				["column", "type", "meaning", "traps"],
				output.columns.map((column) => [
					column.name,
					column.type,
					column.meaning,
					column.traps.join(" "),
				]),
			),
		].join("\n");
	return [
		`${output.view}.${output.column.name} ${output.column.type}: ${cell(output.column.meaning)}`,
		...output.column.traps.map((trap) => `trap: ${cell(trap)}`),
		`top values over ${output.over}:`,
		pipeTable(
			["value", "rows"],
			output.values.map((value) => [value.value, value.rows]),
		),
		...output.notices.map((notice) => `note: ${cell(notice)}`),
	].join("\n");
}

/** An estimate: what would be bought, at what cost, and what is reused. */
export function renderQuestionsEstimate(output: RunQuestionsEstimate): string {
	return [
		`estimate runs=${output.runs} to_answer=${output.toAnswer} cost_at_most=${output.costUsd === null ? "unknown" : usd(output.costUsd)} quota_remaining=${output.quota.remaining} of ${output.quota.answers} per ${output.quota.windowHours} hours available=${output.available}`,
		...(output.token
			? [`token=${output.token} expires_at=${output.tokenExpiresAt ?? ""}`]
			: []),
		pipeTable(
			["question_id", "question", "answered (reused)", "queued", "to answer"],
			output.questions.map((question) => [
				question.id,
				question.question,
				question.answered,
				question.queued,
				question.toAnswer,
			]),
		),
		...output.notices.map((notice) => `note: ${cell(notice)}`),
	].join("\n");
}

/** What run_questions queued, reused and will cost. */
export function renderQuestionsRun(output: RunQuestionsRun): string {
	return [
		`run_questions job=${output.job ?? "none"} runs=${output.runs} queued=${output.queued} reused=${output.reused} already_queued=${output.alreadyQueued} cost_at_most=${usd(output.costUsd)}`,
		...output.notices.map((notice) => `note: ${cell(notice)}`),
	].join("\n");
}

function usd(value: number): string {
	return `$${value.toFixed(4)}`;
}

function pipeTable(
	headers: readonly string[],
	rows: readonly (readonly unknown[])[],
): string {
	const line = (values: readonly unknown[]) =>
		values.map((value) => cell(value).replaceAll("|", "\\|")).join(" | ");
	return [line(headers), ...rows.map(line)].join("\n");
}

function scopeText(scope: AnalysisScope): string {
	const filters = Object.entries(scope.filters)
		.map(([key, value]) => `${key}=${value}`)
		.join(" ");
	return `${scope.from ?? "?"}..${scope.to ?? "?"}${filters ? ` ${filters}` : ""}`;
}
