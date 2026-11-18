import { CLI_DATA_LIMITS, type DataChunk } from "@rudel/api-routes/cli-data";
import {
	ChunkWriter,
	columnNames,
	compactRowToCsv,
	compactRowToJsonl,
	csvHeader,
	NARROW_EXPORT,
} from "./lines.js";
import {
	agentLines,
	asCliDataError,
	type CliDataContext,
} from "./statements.js";

export async function* exportSql(
	context: CliDataContext,
	query: string,
	format: "jsonl" | "csv",
): AsyncGenerator<DataChunk> {
	try {
		const { batches, notices } = await agentLines(
			context,
			query,
			"JSONCompactEachRowWithNames",
		);
		const writer = new ChunkWriter(CLI_DATA_LIMITS.exportBytes, NARROW_EXPORT);
		let names: string[] | null = null;
		for await (const batch of batches)
			for (const line of batch) {
				if (names === null) {
					names = columnNames(line);
					if (format === "csv") yield* writer.line(csvHeader(names), false);
					continue;
				}
				yield* writer.line(
					format === "csv"
						? compactRowToCsv(line)
						: compactRowToJsonl(names, line),
				);
			}
		yield* writer.flush();
		yield writer.done(names ?? [], notices);
	} catch (error) {
		throw asCliDataError(error, context);
	}
}
