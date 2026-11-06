import type { AnalysisReadOutput } from "@rudel/api-routes";
import { cell, omittedMarker, truncatedMarker } from "./compact.js";

export { cell };

type Read = AnalysisReadOutput["reads"][number];
type Section = Read["sections"][number];
const HEAD = "read truncated=false";
const TEXT_MARKER_RESERVE = truncatedMarker(99_999_999, 99_999_999).length;
const MARKER_RESERVE =
	TEXT_MARKER_RESERVE +
	`\n${omittedMarker(99_999, "sections")}`.length +
	`\n${omittedMarker(99, "runs")}`.length;

export function budgetReadOutput(
	output: AnalysisReadOutput,
	maxChars: number,
): AnalysisReadOutput {
	let remaining = Math.max(0, maxChars - HEAD.length - MARKER_RESERVE);
	let truncated = output.truncated;
	let omittedSections = output.omitted?.sections ?? 0;
	let omittedRuns = output.omitted?.runs ?? 0;
	const reads: Read[] = [];
	for (const [index, read] of output.reads.entries()) {
		const framing = readHeading(read);
		if (framing.length > remaining) {
			truncated = true;
			omittedRuns += output.reads.length - index;
			break;
		}
		remaining -= framing.length;
		const fitted: Read = { ...read, sections: [] };
		const sections = read.sections.filter((section) => {
			if (section.name !== "cut") return true;
			truncated = true;
			return false;
		});
		for (const [position, section] of sections.entries()) {
			const prefix = sectionPrefix(section);
			if (prefix.length > remaining) {
				fitted.truncated = true;
				truncated = true;
				omittedSections += sections.length - position;
				break;
			}
			remaining -= prefix.length;
			const shown = fitText(section.text, remaining);
			remaining = shown.cut ? 0 : remaining - shown.cost;
			fitted.sections.push({
				...section,
				text: shown.text,
				...(section.record
					? {
							record: {
								...section.record,
								cut: section.record.cut || shown.cut,
							},
						}
					: {}),
			});
			if (shown.cut) {
				fitted.truncated = true;
				truncated = true;
				omittedSections += sections.length - position - 1;
				break;
			}
		}
		reads.push(fitted);
	}
	truncated ||= reads.some((read) => read.truncated);
	return {
		maxChars,
		reads,
		truncated,
		...(omittedSections || omittedRuns
			? { omitted: { runs: omittedRuns, sections: omittedSections } }
			: {}),
	};
}

function fitText(
	text: string,
	remaining: number,
): { text: string; cost: number; cut: boolean } {
	const full = cell(text).length;
	if (full <= remaining) return { text, cost: full, cut: false };
	const room =
		remaining +
		TEXT_MARKER_RESERVE -
		truncatedMarker(text.length, text.length).length;
	let kept = "";
	let cost = 0;
	for (const character of text) {
		const next = cell(character).length;
		if (cost + next > room) break;
		kept += character;
		cost += next;
	}
	return {
		text: `${kept}${truncatedMarker(text.length - kept.length, text.length)}`,
		cost: remaining + TEXT_MARKER_RESERVE,
		cut: true,
	};
}

export function formatReadOutput(output: AnalysisReadOutput): string {
	const lines = [`read truncated=${output.truncated}`];
	for (const read of output.reads) {
		lines.push(readHeading(read).slice(1));
		for (const section of read.sections)
			lines.push(`${sectionPrefix(section).slice(1)}${cell(section.text)}`);
	}
	if (output.omitted?.sections)
		lines.push(omittedMarker(output.omitted.sections, "sections"));
	if (output.omitted?.runs)
		lines.push(omittedMarker(output.omitted.runs, "runs"));
	const text = lines.join("\n");
	return output.maxChars !== undefined && text.length > output.maxChars
		? "…"
		: text;
}

function readHeading(read: Read): string {
	return `\nref ${cell(JSON.stringify(read.ref))} found=${read.found} truncated=${read.truncated}\n${cell(read.header)}\nsection\ttext (record rows: id, kind, tool, call, path, class, error, exit, cut, text)`;
}

function sectionPrefix(section: Section): string {
	const record = section.record;
	return `\n${record ? [`${record.index}.${record.block}`, record.kind, record.tool, record.callId, record.path, record.commandClass, record.isError, record.exitCode, record.cut].map(cell).join("\t") : cell(section.name)}\t`;
}
