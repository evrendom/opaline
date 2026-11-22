import type {
	ExplainedStep,
	Segment,
} from "@rudel/api-routes/command-glossary";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { FileTag } from "../../files/session-reader-file-tag";
import { explainCommandQuery } from "./explain-command-query";
import { JsonTree } from "./session-reader-json-tree";
import { dedent, type OutputPart, outputParts } from "./session-reader-output";
import { printedBlocks, printRange } from "./session-reader-printed-lines";
import { HighlightedCode, languageOf } from "./session-reader-step-payloads";

const PRINTS = new Set(["cat", "head", "tail", "sed", "nl", "bat"]);
const SEARCHES = new Set(["grep", "rg", "git"]);

const filesOf = (sentence: readonly Segment[]) =>
	sentence.flatMap((segment) => ("file" in segment ? [segment.file] : []));

function searchedFile(steps: readonly ExplainedStep[]): string | null {
	const files = steps
		.filter((step) => SEARCHES.has(step.program) || PRINTS.has(step.program))
		.flatMap((step) => filesOf(step.sentence));
	return new Set(files).size === 1 ? (files[0] ?? null) : null;
}

const READS = new Set([...PRINTS, "grep", "rg"]);

function readFile(steps: readonly ExplainedStep[]): string | null {
	const loud = steps.filter((step) => !step.quiet);
	if (!loud.some((step) => PRINTS.has(step.program))) return null;
	if (!loud.every((step) => READS.has(step.program))) return null;
	const files = new Set(loud.flatMap((step) => filesOf(step.sentence)));
	const [file] = files;
	return files.size === 1 && file ? file : null;
}

type Section = {
	label: string | null;
	numbers: number[] | null;
	part: OutputPart;
};

const KEPT = /^\w+=\$\(/u;

function sectionsOf(
	steps: readonly ExplainedStep[],
	shown: readonly OutputPart[],
	code: string | null,
): Section[] {
	const loud = steps.filter((step) => !step.quiet);
	const searches = loud.filter((step) => !PRINTS.has(step.program));
	const printing = searches.filter((step) => !KEPT.test(step.raw));
	const [search] = printing;
	const found = (part: OutputPart): string | null => {
		if (part.kind !== "numbered" || !search || printing.length !== 1)
			return null;
		const count = part.lines.filter(Boolean).length;
		const noun = /\s-\w*[ABC]\b/u.test(search.raw)
			? count === 1
				? "line"
				: "lines"
			: count === 1
				? "match"
				: "matches";
		return `${count} ${noun} from ${search.program}`;
	};
	const asIs = shown.map((part) => ({
		label: found(part),
		numbers: null,
		part,
	}));
	if (
		!code ||
		!shown.every((part) => part.kind === "text" || part.kind === "numbered") ||
		!searches.every(
			(step) => KEPT.test(step.raw) || /\s-\w*n\b/u.test(step.raw),
		)
	)
		return asIs;
	const printSteps = loud.filter((step) => PRINTS.has(step.program));
	const blocks = printedBlocks(
		shown.flatMap((part) =>
			part.kind === "text" ? part.text.split("\n") : [],
		),
		printSteps.map(printRange),
		shown.flatMap((part) => (part.kind === "numbered" ? part.lines : [])),
	);
	if (!blocks) return asIs;
	let block = 0;
	let taken = 0;
	return shown.flatMap((part, index) => {
		if (part.kind !== "text") return [asIs[index] as Section];
		const lines = part.text.split("\n");
		const sections: Section[] = [];
		while (lines.length > 0 && block < blocks.length) {
			const { length, start } = blocks[block] as (typeof blocks)[number];
			const chunk = lines.splice(0, length - taken);
			const from = start === undefined ? undefined : start + taken;
			const program = printSteps[block]?.program ?? "";
			sections.push({
				label:
					from === undefined
						? `${chunk.length} line${chunk.length === 1 ? "" : "s"} from ${program}`
						: `Lines ${from}–${from + chunk.length - 1} from ${program}`,
				numbers:
					from === undefined ? null : chunk.map((_, line) => from + line),
				part: { kind: "text", text: chunk.join("\n") },
			});
			taken += chunk.length;
			if (taken >= length) {
				block++;
				taken = 0;
			}
		}
		return sections;
	});
}

const PATH = /[./]/u;

function Counts({ rows }: { rows: { count: string; name: string }[] }) {
	return (
		<table className="mx-l border-collapse font-mono text-body-m">
			<tbody>
				{rows.map((row) => {
					const total = row.name === "total";
					return (
						<tr
							key={`${row.name}:${row.count}`}
							// design-escape-ok(opacity): shipped value; border/60
							className={cn(total && "edge-t-m border-line/60")}
						>
							<td className="pr-l text-right tabular-nums">{row.count}</td>
							<td>
								{total ? (
									<span className="text-ink-3">total</span>
								) : PATH.test(row.name) ? (
									<FileTag className="align-middle" path={row.name} />
								) : (
									row.name
								)}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

const NUMBER = /^-?[\d,]+(?:\.\d+)?%?$/u;

function Table({
	header,
	rows,
	wrap,
}: {
	header: string[];
	rows: string[][];
	wrap: boolean;
}) {
	const numeric = header.map(
		(_, column) =>
			rows.some((row) => row[column]) &&
			rows.every((row) => !row[column] || NUMBER.test(row[column] ?? "")),
	);
	const names = new Map<string, number>();
	const columns = header.map((name) => {
		const repeat = names.get(name) ?? 0;
		names.set(name, repeat + 1);
		return `${name}#${repeat}`;
	});
	const seen = new Map<string, number>();
	return (
		<div className="overflow-x-auto px-l">
			<table className="w-full border-collapse font-mono text-body-m">
				<thead>
					{/* design-escape-ok(opacity): shipped value; border/60 */}
					<tr className="edge-b-m border-line/60 text-ink-3">
						{header.map((cell, column) => (
							<th
								key={columns[column]}
								className={cn(
									"py-xs pr-xl text-left font-regular whitespace-nowrap last:pr-zero",
									numeric[column] && "text-right",
								)}
							>
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const id = row.join("|");
						const repeat = seen.get(id) ?? 0;
						seen.set(id, repeat + 1);
						return (
							<tr
								key={`${id}#${repeat}`}
								// design-escape-ok(opacity): shipped value; border/30
								className="edge-b-m border-line/30 last:edge-b-none"
							>
								{columns.map((columnKey, column) => (
									<td
										key={columnKey}
										className={cn(
											"py-xs pr-xl align-top last:pr-zero",
											numeric[column] && "text-right tabular-nums",
											wrap ? "[overflow-wrap:anywhere]" : "whitespace-nowrap",
										)}
									>
										{row[column] || <span className="text-ink-4">—</span>}
									</td>
								))}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

const UNWRAPPED = "overflow-auto whitespace-pre [overflow-wrap:normal]";

function Part({
	code,
	numbers,
	part,
	searched,
	wrap,
}: {
	code: string | null;
	numbers: number[] | null;
	part: OutputPart;
	searched: string | null;
	wrap: boolean;
}) {
	if (part.kind === "json")
		return (
			<div className="px-l">
				<JsonTree value={part.value} />
			</div>
		);
	if (part.kind === "counts") return <Counts rows={part.rows} />;
	if (part.kind === "table")
		return <Table header={part.header} rows={part.rows} wrap={wrap} />;
	if (part.kind === "numbered") {
		const file = part.file ?? searched;
		return (
			<div className="flex flex-col gap-xs">
				{part.file ? (
					<div className="px-l">
						<FileTag className="align-middle" path={part.file} />
					</div>
				) : null}
				<HighlightedCode
					className={cn(
						"corner-zero bg-transparent py-zero",
						!wrap && UNWRAPPED,
					)}
					code={dedent(part.lines.map((line) => line?.text ?? "")).join("\n")}
					language={languageOf(file)}
					lineNumbers={part.lines.map((line) => line?.number ?? null)}
				/>
			</div>
		);
	}
	if (part.kind === "note") return null;
	return (
		<HighlightedCode
			className={cn("corner-zero bg-transparent py-zero", !wrap && UNWRAPPED)}
			code={code ? dedent(part.text.split("\n")).join("\n") : part.text}
			language={code ? languageOf(code) : "text"}
			lineNumbers={numbers ?? undefined}
		/>
	);
}

export function ShellOutput({
	command,
	output,
	wrap,
}: {
	command: string;
	output: string;
	wrap: boolean;
}) {
	const explained = useQuery(explainCommandQuery(command));
	const steps = explained.data ?? [];
	const parts = outputParts(output.trim());
	const shown = parts.filter((part) => part.kind !== "note");
	const code = readFile(steps);
	const sections = sectionsOf(steps, shown, code);
	const searched = searchedFile(steps);
	const seen = new Map<string, number>();
	if (sections.length === 0) return null;
	const several = sections.length > 1;
	return (
		<div className="flex flex-col">
			{sections.map(({ label, numbers, part }, index) => {
				const repeat = seen.get(part.text) ?? 0;
				seen.set(part.text, repeat + 1);
				return (
					<div
						key={`${part.text}#${repeat}`}
						className={cn(
							"flex flex-col gap-xs",
							// design-escape-ok(opacity): shipped value; border/60
							index > 0 && "mt-m edge-t-m border-line/60 pt-m",
						)}
					>
						{several && label ? (
							<p className="px-l text-body-s text-ink-3">{label}</p>
						) : null}
						<Part
							code={code}
							numbers={numbers}
							part={part}
							searched={searched}
							wrap={wrap}
						/>
					</div>
				);
			})}
		</div>
	);
}
