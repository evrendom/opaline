import type {
	SessionRunReadRange,
	SessionRunSeen,
	SessionRunStep,
} from "@rudel/api-routes";
import { SESSION_RUN_SEEN_LIMIT } from "@rudel/api-routes";
import { IconEyeFilled } from "@tabler/icons-react";
import { useMemo } from "react";
import { DiffView, languageForPath } from "@/components/pierre/diff-view";
import type { DiffHunk } from "@/components/pierre/line-diff";
import { formatPaddedTimeOfDay } from "@/lib/format";
import { wholeText } from "./session-files-model";
import { RunCrumbs } from "./session-reader-file-detail";
import {
	Crumb,
	ReaderPane,
	ReaderPaneHeader,
	ReaderPaneScroll,
} from "./session-reader-files-parts";

function splitByRanges(
	text: string,
	ranges: readonly SessionRunReadRange[],
): DiffHunk[] | null {
	if (ranges.length < 2 || ranges.some((range) => range.to === null))
		return null;
	const lines = text.replace(/\n$/u, "").split("\n");
	const sizes = ranges.map((range) => (range.to ?? 0) - range.from + 1);
	const read = sizes.reduce((sum, size) => sum + size, 0);
	const gap =
		read === lines.length
			? 0
			: read + ranges.length - 1 === lines.length
				? 1
				: -1;
	if (gap === -1) return null;
	let at = 0;
	return ranges.flatMap((range, index) => {
		const size = sizes[index] ?? 0;
		const part = lines.slice(at, at + size).join("\n");
		at += size + gap;
		return wholeText(part, range.from);
	});
}

export function SeenFile({
	agent,
	onClearAgent,
	onClearRead,
	onClearRun,
	path,
	run,
	seen,
	step,
}: {
	agent: string | null;
	onClearAgent: () => void;
	onClearRead: () => void;
	onClearRun: () => void;
	path: string;
	run: string | null;
	seen: SessionRunSeen;
	step: SessionRunStep;
}) {
	const ranges = useMemo(
		() => (step.ranges ?? []).filter((range) => range.path === path),
		[step.ranges, path],
	);
	const hunks = useMemo(
		() => splitByRanges(seen.text, ranges) ?? wholeText(seen.text, seen.line),
		[seen, ranges],
	);
	const outputLines = seen.text.split("\n").length;
	const said =
		step.paths.length > 1
			? `${outputLines.toLocaleString()} ${outputLines === 1 ? "line" : "lines"} of output`
			: ranges.length > 1 && hunks.length === ranges.length
				? `lines ${ranges.map((range) => `${range.from}–${range.to}`).join(", ")}`
				: (() => {
						const first = hunks[0]?.newStart ?? seen.line;
						const count = hunks.reduce(
							(sum, hunk) => sum + hunk.lines.length,
							0,
						);
						return count === 1
							? `line ${first}`
							: `lines ${first}–${first + count - 1}`;
					})();
	const name = path.split("/").at(-1) ?? path;
	const others = step.paths.length - 1;
	const time = formatPaddedTimeOfDay(step.at);
	return (
		<ReaderPane>
			<ReaderPaneHeader
				crumbs={
					<>
						{run ? (
							<RunCrumbs
								agent={agent}
								onClearAgent={onClearAgent}
								onClearRun={onClearRun}
								run={run}
							/>
						) : null}
						<Crumb onClear={onClearRead} title={path}>
							<span className="inline-flex items-center gap-xs">
								<IconEyeFilled
									aria-hidden="true"
									className="size-3.5 text-ink-3"
								/>
								{name}
							</span>
						</Crumb>
					</>
				}
			>
				<span className="text-body-m whitespace-nowrap text-ink-3 tabular-nums">
					{said}
					{others > 0
						? ` · read with ${others} other ${others === 1 ? "file" : "files"}`
						: ""}
					{` · seen at ${time}`}
				</span>
			</ReaderPaneHeader>
			<ReaderPaneScroll>
				<div className="flex flex-col gap-m pt-m pb-xl">
					<DiffView hunks={hunks} language={languageForPath(path)} />
					{seen.cut ? (
						// design-escape-ok(opacity): shipped value; muted-foreground/70
						<p className="text-body-m text-ink-3/70">
							Cut at {SESSION_RUN_SEEN_LIMIT.toLocaleString()} characters; the
							rest is in the transcript.
						</p>
					) : null}
				</div>
			</ReaderPaneScroll>
		</ReaderPane>
	);
}
