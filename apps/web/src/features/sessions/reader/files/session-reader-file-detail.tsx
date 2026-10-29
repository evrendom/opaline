import type { SessionFile } from "@rudel/api-routes";
import {
	IconCode,
	IconFileCodeFilled,
	IconFileDiff,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/dashboard/page-parts";
import { DiffView, languageForPath } from "@/components/pierre/diff-view";
import { countChanges, diffLines } from "@/components/pierre/line-diff";
import { shortRunId } from "@/features/sessions/run-id";
import { SubagentTag } from "../subagents/session-reader-subagent-chip";
import type { OpenPlace } from "../summary/session-reader-summary-sections";
import { changesOf, wholeText } from "./session-files-model";
import { ChangeBlock, Cut } from "./session-reader-file-change";
import {
	Crumb,
	CrumbSeparator,
	ScrollColumn,
	ViewToggle,
} from "./session-reader-files-parts";

export function RunCrumbs({
	agent,
	onClearAgent,
	onClearRun,
	run,
}: {
	agent: string | null;
	onClearAgent: () => void;
	onClearRun: () => void;
	run: string;
}) {
	return (
		<>
			<Crumb onClear={onClearRun}>Run {shortRunId(run)}</Crumb>
			<CrumbSeparator />
			{agent ? (
				<>
					<Crumb onClear={onClearAgent}>
						<SubagentTag
							className="inline-flex shrink gap-1"
							subagentId={agent}
						/>
					</Crumb>
					<CrumbSeparator />
				</>
			) : null}
		</>
	);
}

function splitPath(path: string) {
	const name = path.split("/").at(-1) ?? path;
	return { directory: path.slice(0, path.length - name.length), name };
}

function useDiffs(changes: SessionFile["changes"]) {
	return useMemo(() => {
		const diffs = changes.map((change) =>
			diffLines(change.before, change.after, { lineOffset: change.line ?? 1 }),
		);
		const totals = { added: 0, removed: 0 };
		diffs.forEach((hunks, index) => {
			if (changes[index]?.failed) return;
			const counted = countChanges(hunks);
			totals.added += counted.added;
			totals.removed += counted.removed;
		});
		return { diffs, totals };
	}, [changes]);
}

export function LineCounts({
	added,
	removed,
}: {
	added: number;
	removed: number;
}) {
	return (
		<>
			<span className="text-green-600 dark:text-green-400">+{added}</span>{" "}
			<span className="text-red-600 dark:text-red-400">−{removed}</span>
		</>
	);
}

export function FileDetail({
	agent,
	file,
	onClearAgent,
	onClearFile,
	onClearRun,
	onOpenTurn,
	run,
}: {
	agent: string | null;
	file: SessionFile;
	onClearAgent: () => void;
	onClearFile: () => void;
	onClearRun: () => void;
	onOpenTurn: OpenPlace;
	run: string | null;
}) {
	const changes = useMemo(
		() => changesOf(file, run, agent),
		[file, run, agent],
	);
	const [view, setView] = useState<"changes" | "file">(
		changes.length > 0 ? "changes" : "file",
	);
	const { diffs, totals } = useDiffs(changes);
	const language = languageForPath(file.path);
	const { directory, name } = splitPath(file.path);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 py-4 pr-4 pl-5">
			<div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
				<div className="flex min-w-0 flex-1 items-center gap-1.5">
					{run ? (
						<RunCrumbs
							agent={agent}
							onClearAgent={onClearAgent}
							onClearRun={onClearRun}
							run={run}
						/>
					) : null}
					<Crumb onClear={run ? onClearFile : undefined} title={file.path}>
						{name}
						{file.movedTo ? (
							<span className="font-normal text-muted-foreground">
								{" "}
								→ {file.movedTo.split("/").at(-1)}
							</span>
						) : null}
					</Crumb>
				</div>
				<span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
					<LineCounts {...totals} />
					{" · "}
					{run
						? `${changes.length} of ${file.changes.length} changes`
						: `${file.changes.length} ${file.changes.length === 1 ? "change" : "changes"}`}
					{file.reads > 0 ? ` · read ${file.reads}×` : ""}
				</span>
				<ViewToggle
					label="The file's changes, or its text"
					onPick={setView}
					options={[
						{
							icon: IconFileDiff,
							id: "changes",
							label: "Changes",
							off: changes.length === 0,
						},
						{ icon: IconCode, id: "file", label: "File" },
					]}
					value={view}
				/>
			</div>
			<span
				className="-mt-1 truncate pl-2 text-left text-xs text-muted-foreground/70 [direction:rtl]"
				title={directory}
			>
				{`‎${directory}‎`}
			</span>
			{view === "file" && file.content === null ? (
				<EmptyState
					icon={IconFileCodeFilled}
					title="Never seen whole"
					description="The session never read or wrote this file in full, or made an edit it couldn't place, so its text isn't known."
					className="mt-3"
				/>
			) : (
				<ScrollColumn className="-mr-4 -ml-1.5 pr-4 pl-1.5">
					{view === "file" && file.content !== null ? (
						<div className="flex flex-col gap-2 pt-2 pb-4">
							<DiffView hunks={wholeText(file.content)} language={language} />
							{file.contentCut ? <Cut /> : null}
						</div>
					) : (
						<ol className="flex flex-col divide-y divide-border/40">
							{changes.map((change, index) => (
								<ChangeBlock
									// biome-ignore lint/suspicious/noArrayIndexKey: their place tells them apart
									key={`${change.eventId}:${index}`}
									change={change}
									hunks={diffs[index] ?? []}
									language={language}
									onOpenTurn={onOpenTurn}
								/>
							))}
						</ol>
					)}
				</ScrollColumn>
			)}
		</div>
	);
}
