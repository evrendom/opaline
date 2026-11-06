import { ORPCError } from "@orpc/server";
import type { AnalysisSqlOutput, MeasuresRunInput } from "@rudel/api-routes";
import { mergeRepeatedCommands } from "../../services/analysis/repeated-commands-merge.js";
import {
	drillLabel,
	drillOf,
	drillSql,
} from "../../services/analysis/retro-measure-drill.js";
import {
	COMMAND_PIECE_FAMILIES,
	COMMAND_PIECE_VARIANTS,
	repeatedCommandsPieceSql,
} from "../../services/analysis/retro-measure-sql.js";
import {
	cohortSelect,
	findRetroMeasure,
	listMeasures,
	measureHash,
	measureParams,
} from "../../services/analysis/retro-measures.js";
import type { SqlParts } from "../../services/analysis/sql-gateway.js";

export function badRequest(message: string): ORPCError<string, unknown> {
	return new ORPCError("BAD_REQUEST", {
		message: `error, recoverable: ${message}`,
		data: { kind: "recoverable" },
	});
}

export function measureStatement(
	input: MeasuresRunInput,
	today: Date,
): {
	query: string;
	title: string;
	cohort?: string;
	measure: NonNullable<AnalysisSqlOutput["measure"]>;
	analysis?: string;
	parts?: SqlParts;
} {
	const measure = findRetroMeasure(input.name);
	if (!measure)
		throw badRequest(
			listMeasures().some((item) => item.name === input.name)
				? `${input.name} is an aggregate: use it inside sql (measures action=describe shows how); run takes ${listMeasures()
						.filter((item) => item.kind === "query")
						.map((item) => item.name)
						.join(", ")}`
				: `${input.name} is not a measure; measures action=list names them`,
		);
	const params = measureParams(input, today);
	if ("error" in params) throw badRequest(params.error);
	const drill = input.drill ? drillOf(measure.name, input.drill) : null;
	if (drill && "error" in drill) throw badRequest(drill.error);
	const query = drill
		? drillSql(measure.name, params, drill)
		: measure.build(params);
	const parts: SqlParts | undefined =
		!drill && measure.name === "repeated_commands"
			? {
					queries: [
						{
							query,
							cohort: cohortSelect(params),
							split: {
								stage: "repeated_commands",
								window: params,
								build: (window) => ({
									query: repeatedCommandsPieceSql(window),
									cohort: cohortSelect(window),
								}),
								merge: (pieces) => mergeRepeatedCommands(pieces, params.limit),
								approximate: `calls, failed, group_call_time and sessions are summed over the windows and members counted by id; variants are counted by fingerprint over the windows; a variant's text is the one its window kept (each window keeps texts for the ${COMMAND_PIECE_VARIANTS} most common variants of its ${COMMAND_PIECE_FAMILIES} most-called families)`,
							},
						},
					],
					merge: (rows) => rows,
				}
			: undefined;
	return {
		query,
		title:
			`${drill ? `Sessions behind ${drillLabel(drill)} of ` : ""}${measure.title}, ${params.from}..${params.to}${params.repository ? `, ${params.repository}` : ""}${params.latest ? `, latest ${params.latest}` : ""}`.slice(
				0,
				120,
			),
		cohort: cohortSelect(params),
		measure: {
			name: measure.name,
			status: "approved",
			hash: measureHash(measure.name) ?? "",
			from: params.from,
			to: params.to,
			...(drill ? { drill } : {}),
		},
		...(input.analysis ? { analysis: input.analysis } : {}),
		...(parts ? { parts } : {}),
	};
}
