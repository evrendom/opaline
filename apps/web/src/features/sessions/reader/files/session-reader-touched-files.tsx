import type { SessionFile, SessionRunStep } from "@rudel/api-routes";
import { IconListTree, IconTimelineEvent } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { FileTree } from "@/components/pierre/file-tree";
import { PickStrip } from "../rail/session-reader-pick-strip";
import { useColumnSlide } from "../rail/use-column-slide";
import { type RunTouch, treeItems } from "./session-files-model";
import { ScrollColumn, ViewToggle } from "./session-reader-files-parts";
import { type EditsByCall, RunTrace } from "./session-reader-run-trace";

type Order = "timeline" | "tree";

type Kept = "changed" | "read" | "all";

const ORDERS = [
	{ icon: IconTimelineEvent, id: "timeline", label: "Timeline" },
	{ icon: IconListTree, id: "tree", label: "Tree" },
] as const;

export function TouchedFiles({
	agent,
	edits,
	extents,
	file,
	hidden,
	files,
	model,
	onPickFile,
	onPickStep,
	read,
	roots,
	run,
	steps,
}: {
	agent: string | null;
	edits: EditsByCall;
	extents: ReadonlyMap<string, number>;
	file: string | null;
	hidden: ReadonlySet<string>;
	files: readonly SessionFile[];
	model: string | null;
	onPickFile: (path: string) => void;
	onPickStep: (step: SessionRunStep, path?: string) => void;
	read: string | null;
	roots: readonly string[];
	run: string;
	steps: readonly SessionRunStep[];
}) {
	const [order, setOrder] = useState<Order>("timeline");
	const column = useColumnSlide<HTMLDivElement>();
	const own = useMemo(
		() => steps.filter((step) => isOwn(step, agent)),
		[agent, steps],
	);
	const touch = useMemo(() => touchOfSteps(own, edits), [edits, own]);
	const items = useMemo(() => {
		const byPath = new Map(files.map((each) => [each.path, each]));
		return treeItems(
			[...new Set([...touch.changed, ...touch.read])].map(
				(path) => byPath.get(path) ?? readOnly(path),
			),
			{
				agent: agent ?? "",
				run,
			},
		);
	}, [agent, files, run, touch]);
	const lastStep = useMemo(() => {
		const seen = new Map<string, SessionRunStep>();
		const last = new Map<string, SessionRunStep>();
		for (const step of own)
			for (const path of pathsOf(step, edits)) {
				last.set(path, step);
				if (step.kind === "read" && step.seen) seen.set(path, step);
			}
		return { last, seen };
	}, [edits, own]);
	const pickInTree = (path: string) => {
		const step = lastStep.seen.get(path) ?? lastStep.last.get(path);
		if (step) onPickStep(step, path);
		else onPickFile(path);
	};
	return (
		<div className="-mb-2 flex min-h-0 w-[280px] shrink-0 flex-col gap-1.5 pt-(--panes-top)">
			<PickStrip agent={agent} model={model} run={run}>
				<ViewToggle
					label="How to list the files"
					onPick={(next) => column.slide(next === "tree", () => setOrder(next))}
					options={ORDERS}
					value={order}
				/>
			</PickStrip>
			<div ref={column.ref} className="-mx-1 flex min-h-0 flex-1 flex-col">
				<ScrollColumn className="px-1 pb-8">
					{order === "timeline" ? (
						<RunTrace
							agent={agent}
							edits={edits}
							extents={extents}
							hidden={hidden}
							onPickStep={onPickStep}
							roots={roots}
							selected={read}
							selectedPath={file}
							steps={steps}
						/>
					) : items.length > 0 ? (
						<FileTree items={items} onSelect={pickInTree} selected={file} />
					) : (
						<p className="py-1 pl-2 text-[11px] text-muted-foreground">
							No files read or edited.
						</p>
					)}
				</ScrollColumn>
			</div>
		</div>
	);
}

export function SessionFiles({
	edits,
	extents,
	file,
	files,
	hidden,
	model,
	onPickFile,
	onPickStep,
	read,
	roots,
	steps,
}: {
	edits: EditsByCall;
	extents: ReadonlyMap<string, number>;
	file: string | null;
	files: readonly SessionFile[];
	hidden: ReadonlySet<string>;
	model: string | null;
	onPickFile: (path: string) => void;
	onPickStep: (step: SessionRunStep, path?: string) => void;
	read: string | null;
	roots: readonly string[];
	steps: readonly SessionRunStep[];
}) {
	const [order, setOrder] = useState<Order>("tree");
	const column = useColumnSlide<HTMLDivElement>();
	const [kept, setKept] = useState<Kept>("all");
	const shown = useMemo(
		() =>
			kept === "all"
				? files
				: files.filter(
						(each) => each.changes.length > 0 === (kept === "changed"),
					),
		[files, kept],
	);
	const items = useMemo(() => treeItems(shown, { run: null }), [shown]);
	const paths = useMemo(
		() =>
			kept === "all" ? undefined : new Set(shown.map((each) => each.path)),
		[kept, shown],
	);
	const changed = files.filter((each) => each.changes.length > 0).length;
	return (
		<div className="-mb-2 flex min-h-0 w-[280px] shrink-0 flex-col gap-1.5 pt-(--panes-top)">
			<PickStrip agent={null} model={model} run={null} untitled>
				<ViewToggle
					iconsOnly
					label="How to list the files"
					onPick={(next) => column.slide(next === "tree", () => setOrder(next))}
					options={ORDERS}
					value={order}
				/>
				<ViewToggle
					label="Which files to list"
					onPick={setKept}
					options={[
						{ count: changed, id: "changed", label: "Changed" },
						{ count: files.length - changed, id: "read", label: "Read" },
						{ count: files.length, id: "all", label: "All" },
					]}
					value={kept}
				/>
			</PickStrip>
			<div ref={column.ref} className="-mx-1 flex min-h-0 flex-1 flex-col">
				<ScrollColumn className="px-1 pb-8">
					{order === "timeline" ? (
						<RunTrace
							edits={edits}
							extents={extents}
							hidden={hidden}
							onPickStep={onPickStep}
							paths={paths}
							roots={roots}
							selected={read}
							selectedPath={file}
							steps={steps}
						/>
					) : (
						<FileTree items={items} onSelect={onPickFile} selected={file} />
					)}
				</ScrollColumn>
			</div>
		</div>
	);
}

function isOwn(step: SessionRunStep, agent: string | null): boolean {
	return (
		step.agentId === (agent ?? "") &&
		(step.kind === "read" || step.kind === "edit")
	);
}

function pathsOf(step: SessionRunStep, edits: EditsByCall): readonly string[] {
	if (step.kind !== "edit") return step.paths;
	const edited = edits.get(step.eventId)?.path;
	return edited ? [edited] : step.paths;
}

function touchOfSteps(
	steps: readonly SessionRunStep[],
	edits: EditsByCall,
): Pick<RunTouch, "changed" | "read"> {
	const changed = new Set<string>();
	const read = new Set<string>();
	for (const step of steps)
		for (const path of pathsOf(step, edits))
			(step.kind === "edit" ? changed : read).add(path);
	return { changed, read };
}

function readOnly(path: string): SessionFile {
	return {
		changes: [],
		content: null,
		contentCut: false,
		movedTo: null,
		path,
		readBy: [],
		readTurns: [],
		reads: 0,
	};
}
