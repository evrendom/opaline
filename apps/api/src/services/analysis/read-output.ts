import type { AnalysisReadOutput } from "@rudel/api-routes";

type Read = AnalysisReadOutput["reads"][number];
type Section = Read["sections"][number];
const CUT = "\n[cut]";

export function budgetReadOutput(
	output: AnalysisReadOutput,
	maxChars: number,
): AnalysisReadOutput {
	let remaining = Math.max(
		0,
		maxChars - "read truncated=false".length - CUT.length,
	);
	let truncated = output.truncated;
	const reads: Read[] = [];
	for (const read of output.reads) {
		const framing = readHeading(read);
		if (framing.length > remaining) {
			truncated = true;
			break;
		}
		remaining -= framing.length;
		const fitted: Read = { ...read, sections: [] };
		for (const section of read.sections) {
			if (section.name === "cut") {
				truncated = true;
				continue;
			}
			const prefix = sectionPrefix(section);
			if (prefix.length > remaining) {
				fitted.truncated = true;
				truncated = true;
				break;
			}
			remaining -= prefix.length;
			let text = "";
			for (const character of section.text) {
				const cost = cell(character).length;
				if (cost > remaining) break;
				text += character;
				remaining -= cost;
			}
			const cut = text.length < section.text.length;
			fitted.sections.push({
				...section,
				text,
				...(section.record
					? { record: { ...section.record, cut: section.record.cut || cut } }
					: {}),
			});
			if (cut) {
				fitted.truncated = true;
				truncated = true;
				break;
			}
		}
		reads.push(fitted);
	}
	truncated ||= reads.some((read) => read.truncated);
	return { maxChars, reads, truncated };
}

export function formatReadOutput(output: AnalysisReadOutput): string {
	if ((output.maxChars ?? 12000) < "read truncated=false".length + CUT.length)
		return (output.maxChars ?? 12000) >= 5 ? "[cut]" : "…";
	const lines = [`read truncated=${output.truncated}`];
	for (const read of output.reads) {
		lines.push(readHeading(read).slice(1));
		for (const section of read.sections)
			lines.push(`${sectionPrefix(section).slice(1)}${cell(section.text)}`);
	}
	return `${lines.join("\n")}${output.truncated ? CUT : ""}`;
}

function readHeading(read: Read): string {
	return `\nref ${cell(JSON.stringify(read.ref))} found=${read.found} truncated=${read.truncated}\n${cell(read.header)}\nsection\ttext (record rows: id, kind, tool, call, path, class, error, exit, cut, text)`;
}

function sectionPrefix(section: Section): string {
	const record = section.record;
	return `\n${record ? [`${record.index}.${record.block}`, record.kind, record.tool, record.callId, record.path, record.commandClass, record.isError, record.exitCode, record.cut].map(cell).join("\t") : cell(section.name)}\t`;
}

export function cell(value: unknown): string {
	return value === null || value === undefined
		? "null"
		: String(value)
				.replaceAll("\\", "\\\\")
				.replaceAll("\t", "\\t")
				.replaceAll("\r", "\\r")
				.replaceAll("\n", "\\n");
}
