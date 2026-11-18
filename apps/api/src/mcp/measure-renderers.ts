import type {
	AnalysisSqlOutput,
	Check,
	CheckDefinition,
	ChecksCreateOutput,
	ChecksListOutput,
	ChecksResult,
	MeasuresDescribeOutput,
	MeasuresListOutput,
} from "@rudel/api-routes";
import { cell } from "../services/analysis/read-output.js";
import { renderSql } from "./analysis-renderers.js";

function lines(header: readonly string[], rows: readonly unknown[][]): string {
	return [header, ...rows]
		.map((row) => row.map((value) => cell(value)).join(" | "))
		.join("\n");
}

export function renderMeasureList(output: MeasuresListOutput): string {
	return [
		"approved measures: run the query ones with measures action=run; use the aggregates inside sql.",
		lines(
			["name", "kind", "status", "is_drifted", "unit", "description"],
			output.measures.map((measure) => [
				measure.name,
				measure.kind,
				measure.status,
				measure.isDrifted,
				measure.unit,
				measure.description,
			]),
		),
		`parameters of every query measure: ${output.measures.find((measure) => measure.kind === "query")?.parameters.join(", ") ?? ""}`,
	].join("\n");
}

export function renderMeasureDescribe(output: MeasuresDescribeOutput): string {
	return [
		`measure=${output.name} kind=${output.kind} status=${output.status} is_drifted=${output.isDrifted} unit=${output.unit} hash=${output.hash.slice(0, 12)}`,
		`title: ${cell(output.title)}`,
		`definition: ${cell(output.definition)}`,
		...(output.columns.length
			? [
					lines(
						["column", "meaning"],
						output.columns.map((column) => [column.name, column.meaning]),
					),
				]
			: []),
		...output.traps.map((trap) => `trap: ${cell(trap)}`),
		...(output.parameters.length
			? [`parameters: ${output.parameters.join(", ")}`]
			: []),
		"sql:",
		output.sql,
	].join("\n");
}

export function renderMeasureRun(output: AnalysisSqlOutput): string {
	const measure = output.measure;
	return [
		...(measure
			? [
					`measure=${measure.name} status=${measure.status} is_drifted=false window=${measure.from}..${measure.to}${measure.drill ? ` drill=${cell(JSON.stringify(measure.drill))}: one row per session behind that row` : ""}`,
				]
			: []),
		renderSql(output),
	].join("\n");
}

function describeDefinition(definition: CheckDefinition): string {
	return definition.kind === "runs"
		? `target=${definition.target} where ${cell(definition.where)}`
		: `measure=${definition.measure} ${definition.column} >= ${definition.min}${definition.repository ? ` repository=${definition.repository}` : ""}`;
}

export function renderCheckResult(output: ChecksResult): string {
	return [
		`check ${cell(output.check.name)} over ${output.over}: matches=${output.matches ?? "unknown"} (${describeDefinition(output.check.definition)})`,
		renderSql(output.result),
	].join("\n");
}

function checkLine(check: Check): string {
	return `check id=${check.id} name=${cell(check.name)} enabled=${check.enabled} created=${check.createdAt} ${describeDefinition(check.definition)}`;
}

export function renderCheckCreate(output: ChecksCreateOutput): string {
	return [
		checkLine(output.check),
		...output.notices.map((notice) => `note: ${cell(notice)}`),
	].join("\n");
}

export function renderCheckList(output: ChecksListOutput): string {
	return output.checks.length
		? output.checks.map(checkLine).join("\n")
		: "no checks yet: test a condition with checks action=test, then save it with action=create.";
}

function firstCell(output: AnalysisSqlOutput): string | null {
	const header = output.table.split("\n")[0]?.split(" | ") ?? [];
	const row = output.table.split("\n")[1]?.split(" | ") ?? [];
	const index = header.indexOf("id");
	return index === -1 ? null : (row[index] ?? null);
}

export function renderPatterns(
	action: "list" | "drill" | "verify",
	output: AnalysisSqlOutput,
	pull: (id: string) => string,
): string {
	const window = output.measure
		? `${output.measure.from}..${output.measure.to}`
		: "";
	if (action === "drill") {
		const id = output.measure?.drill?.id ?? "";
		return [
			`pattern ${id} window=${window}: one row per run, sessions in the order they first hit it; the first row's pattern cell says what it is and the fix.`,
			renderSql(output),
			`next: read two or three of these runs (read with session_id, agent_id and turn_idx as its turn), then write the fix as a diff. ${pull(id)} copies just these sessions.`,
		].join("\n");
	}
	if (action === "verify")
		return [
			`verify window=${window}: runs with each pattern per 100 runs of the cohort, before and after the change; no_change_yet when no instruction or skill file changed in the window or fewer than 10 runs fall on a side.`,
			renderSql(output),
		].join("\n");
	const top = firstCell(output);
	return [
		`patterns window=${window}: sections in order, each ranked by the sessions it hit, then minutes: failures (failing_call, retry_loop, wrong_route); incomplete; correction; theme (what the person keeps asking or reporting, whatever the tone). Each pattern is in 3+ sessions. detail: a failing_call's error variants with their calls; a correction's or theme's prompts with how the run before ended. weekly: runs per week, oldest first; examples: session#turn.`,
		renderSql(output),
		...(top
			? [
					`next: patterns action=drill id=${top} for its runs and evidence, or ${pull(top)}; then read the examples and write the fix as a diff.`,
				]
			: []),
	].join("\n");
}
