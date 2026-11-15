import { Bones } from "@/app/ui/bones";
import { DiffView } from "./diff-view";
import type { DiffHunk } from "./line-diff";

const SAMPLE = [
	'import { useMemo } from "react";',
	'import { formatDuration } from "@/lib/format";',
	'import type { SessionSummary } from "./session-model";',
	"",
	"export function useSessionFigures(session: SessionSummary) {",
	"\treturn useMemo(() => {",
	"\t\tconst started = new Date(session.startedAt).getTime();",
	"\t\tconst ended = new Date(session.endedAt).getTime();",
	"\t\treturn {",
	"\t\t\tcost: session.estimatedCost,",
	"\t\t\tduration: formatDuration(ended - started),",
	"\t\t\tturns: session.turnCount,",
	"\t\t};",
	"\t}, [session]);",
	"}",
	"",
	"export function figureLabel(kind: string) {",
	'\tif (kind === "cost") return "Cost";',
	'\tif (kind === "duration") return "Duration";',
	'\treturn "Turns";',
	"}",
	"",
	"export const FIGURE_ORDER = [",
	'\t"cost",',
	'\t"duration",',
	'\t"turns",',
	"] as const;",
	"",
	"export function sortFigures<T extends { kind: string }>(figures: T[]) {",
	"\treturn [...figures].sort(",
	"\t\t(a, b) =>",
	"\t\t\tFIGURE_ORDER.indexOf(a.kind as never) -",
	"\t\t\tFIGURE_ORDER.indexOf(b.kind as never),",
	"\t);",
	"}",
	"",
	"export function totalCost(figures: { cost: number }[]) {",
	"\treturn figures.reduce((sum, each) => sum + each.cost, 0);",
	"}",
];

function sampleHunks(count: number): DiffHunk[] {
	const shown = SAMPLE.slice(0, count);
	return [
		{
			lines: shown.map((text, index) => ({
				kind: "context",
				newNumber: index + 1,
				oldNumber: index + 1,
				text,
			})),
			newLines: shown.length,
			newStart: 1,
			oldLines: shown.length,
			oldStart: 1,
		},
	];
}

export function CodeSample({ lines = SAMPLE.length }: { lines?: number }) {
	return <DiffView hunks={sampleHunks(lines)} language={null} />;
}

export function CodeSkeleton({
	label = "Loading code",
	lines = SAMPLE.length,
}: {
	label?: string;
	lines?: number;
}) {
	return (
		<Bones label={label}>
			<CodeSample lines={lines} />
		</Bones>
	);
}
