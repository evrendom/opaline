import {
	type AnalysisHistoryReportOutput,
	AnalysisSqlOutputSchema,
	type RunRef,
} from "@rudel/api-routes";
import { z } from "zod";
import { getAnalysisTree } from "./analysis-log.service.js";
import type { AnalysisLog, AnalysisViewer } from "./types.js";

const MAX_CITED_RUNS_PER_STEP = 20;

const ReadRefsSchema = z.object({
	refs: z.array(
		z.object({
			sessionId: z.string(),
			agentId: z.string().default(""),
			turn: z.number(),
		}),
	),
});

export async function getAnalysisReport(
	log: AnalysisLog,
	viewer: AnalysisViewer,
	id: string,
): Promise<AnalysisHistoryReportOutput> {
	const tree = await getAnalysisTree(log, viewer, id);
	const sqlQueries = tree.steps.flatMap((step) =>
		step.queries.filter(
			(query) => query.tool === "sql" && query.unavailable === null,
		),
	);
	const stored = await Promise.all(
		sqlQueries.map(async (query) => {
			const found = await log.store.getQuery(query.id);
			const output = AnalysisSqlOutputSchema.safeParse(found?.output);
			return found?.analysisId === tree.id && output.success
				? { query: query.id, output: output.data }
				: null;
		}),
	);
	const sqlOutputs = new Map(
		stored.flatMap((entry) => (entry ? [[entry.query, entry.output]] : [])),
	);
	return {
		...tree,
		results: [...sqlOutputs].map(([query, output]) => ({
			query,
			title: output.title,
			columns: output.columns,
			rows: parsePipeRows(output.table),
			truncated: output.truncated,
		})),
		citedRuns: tree.steps.flatMap((step) => {
			const runs = uniqueRuns(
				step.queries.flatMap((query) =>
					query.tool === "read"
						? (ReadRefsSchema.safeParse(query.args).data?.refs ?? [])
						: (sqlOutputs.get(query.id)?.runs ?? []),
				),
			).slice(0, MAX_CITED_RUNS_PER_STEP);
			return runs.length ? [{ step: step.id, runs }] : [];
		}),
	};
}

export function parsePipeRows(table: string): string[][] {
	const [, ...lines] = table.split("\n");
	if (table === "(no rows)") return [];
	return lines.map((line) =>
		line.split(/(?<!\\) \| /u).map((cell) => cell.replaceAll("\\|", "|")),
	);
}

function uniqueRuns(runs: RunRef[]): RunRef[] {
	const seen = new Set<string>();
	return runs.filter((run) => {
		const key = `${run.sessionId}\u0000${run.agentId}\u0000${run.turn}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
