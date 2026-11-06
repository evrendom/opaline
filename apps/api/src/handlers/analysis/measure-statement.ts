import { ORPCError } from "@orpc/server";
import type { AnalysisSqlOutput, MeasuresRunInput } from "@rudel/api-routes";
import {
	drillLabel,
	drillOf,
	drillSql,
} from "../../services/analysis/retro-measure-drill.js";
import {
	cohortSelect,
	findRetroMeasure,
	listMeasures,
	measureHash,
	measureParams,
} from "../../services/analysis/retro-measures.js";

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
	return {
		query: drill
			? drillSql(measure.name, params, drill)
			: measure.build(params),
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
	};
}
