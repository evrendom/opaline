import type {
	SessionFile,
	SessionFileChange,
	SessionRunReadRange,
	SessionRunStep,
} from "@rudel/api-routes";
import {
	type Icon,
	IconBrandGithubFilled,
	IconCircleCheckFilled,
	IconCircleXFilled,
	IconEyeFilled,
	IconFolderOpenFilled,
	IconGitBranch,
	IconPencilFilled,
	IconPuzzleFilled,
	IconTerminal2,
	IconZoomFilled,
} from "@tabler/icons-react";
import { type ReactNode, useMemo, useRef } from "react";
import { countChanges, diffLines } from "@/components/pierre/line-diff";
import { revealInList } from "@/lib/reveal-in-list";
import { cn } from "@/lib/utils";
import { getFileLanguage } from "./session-reader-file-tag";

const FILE_KINDS = new Set(["read", "edit"]);

const ICON: Record<Exclude<SessionRunStep["kind"], "subagent">, Icon> = {
	check: IconCircleCheckFilled,
	edit: IconPencilFilled,
	git: IconGitBranch,
	github: IconBrandGithubFilled,
	read: IconEyeFilled,
	search: IconZoomFilled,
	shell: IconTerminal2,
	tool: IconPuzzleFilled,
};

type EditEntry = {
	added: number;
	changes: SessionFileChange[];
	path: string;
	removed: number;
};

const editsOfFiles = new WeakMap<
	readonly SessionFile[],
	ReadonlyMap<string, EditEntry>
>();

export function useEditsByCall(
	files: readonly SessionFile[],
): ReadonlyMap<string, EditEntry> {
	return useMemo(() => {
		const held = editsOfFiles.get(files);
		if (held) return held;
		const byCall = new Map<string, EditEntry>();
		for (const file of files)
			for (const change of file.changes) {
				const entry = byCall.get(change.eventId) ?? {
					added: 0,
					changes: [],
					path: file.path,
					removed: 0,
				};
				const counted = countChanges(
					diffLines(change.before, change.after, {
						lineOffset: change.line ?? 1,
					}),
				);
				entry.added += counted.added;
				entry.removed += counted.removed;
				entry.changes.push(change);
				byCall.set(change.eventId, entry);
			}
		editsOfFiles.set(files, byCall);
		return byCall;
	}, [files]);
}

export type EditsByCall = ReadonlyMap<string, EditEntry>;

export function RunTrace({
	agent,
	edits,
	extents,
	hidden,
	onPickStep,
	paths,
	roots = [],
	selected = null,
	selectedPath = null,
	steps,
}: {
	agent?: string | null;
	edits: EditsByCall;
	onPickStep: (step: SessionRunStep, path?: string) => void;
	extents?: ReadonlyMap<string, number>;
	paths?: ReadonlySet<string>;
	hidden?: ReadonlySet<string>;
	roots?: readonly string[];
	selected?: string | null;
	selectedPath?: string | null;
	steps: readonly SessionRunStep[];
}) {
	const shown = useRef<string | null>(null);
	const rows = steps.flatMap((step) => {
		if (agent !== undefined && step.agentId !== (agent ?? "")) return [];
		if (!FILE_KINDS.has(step.kind)) return [];
		if (hidden?.has(tagOf(step, edits))) return [];
		const each =
			step.kind === "read" && step.paths.length > 1
				? step.paths.map((path) => ({ path, step }))
				: [{ path: step.paths.length === 1 ? step.paths[0] : undefined, step }];
		return paths
			? each.filter(({ path }) => path !== undefined && paths.has(path))
			: each;
	});
	if (rows.length === 0)
		return (
			<p className="py-xs pl-m text-body-s text-ink-3">
				No files read or edited.
			</p>
		);
	const entries = rows.map(({ path, step }) => ({
		path,
		place: path ? placeOf(path, roots) : null,
		step,
	}));
	let repo: string | null | undefined;
	let folder: Place | null = null;
	const items: ReactNode[] = [];
	const isPicked = (step: SessionRunStep, path: string | undefined) =>
		step.eventId === selected &&
		(step.paths.length < 2 || path === selectedPath);
	const isLit = (step: SessionRunStep, path: string | undefined) =>
		selected
			? isPicked(step, path)
			: path !== undefined && path === selectedPath;
	const revealAt = entries.findIndex(({ path, step }) => isLit(step, path));
	const revealKey = `${selected}:${selectedPath}`;
	const reveal = (row: HTMLElement | null) => {
		if (!row || shown.current === revealKey) return;
		shown.current = revealKey;
		revealInList(row);
	};
	for (const [index, { path, place, step }] of entries.entries()) {
		if (place && place.root !== repo) {
			if (place.root)
				items.push(
					<RepoRow key={`repo:${step.eventId}:${path}`} root={place.root} />,
				);
			repo = place.root;
			folder = null;
		}
		if (place?.shown && place.folder !== folder?.folder)
			items.push(
				<FolderRow
					key={`folder:${step.eventId}:${path}`}
					after={folder}
					inRepo={place.root !== null}
					place={place}
				/>,
			);
		if (place) folder = place;
		const depth = !place ? 0 : (place.root ? 1 : 0) + (place.shown ? 1 : 0);
		items.push(
			<StepRow
				key={`${step.eventId}:${path ?? ""}`}
				depth={depth}
				edit={edits.get(step.eventId)}
				extents={extents}
				onPick={() => onPickStep(step, path)}
				path={path}
				rowRef={index === revealAt ? reveal : undefined}
				selected={isLit(step, path)}
				step={step}
			/>,
		);
	}
	return <ol className="flex flex-col pt-xs pb-m">{items}</ol>;
}

type Place = { folder: string; root: string | null; shown: string };

const HOME = /^\/(?:Users|home)\/[^/]+$/u;

function placeOf(path: string, roots: readonly string[]): Place {
	const folder = path.slice(0, path.lastIndexOf("/"));
	let root: string | null = null;
	for (const each of roots)
		if (
			each !== "/" &&
			!HOME.test(each) &&
			(folder === each || folder.startsWith(`${each}/`)) &&
			(root === null || each.length < root.length)
		)
			root = each;
	if (root)
		return {
			folder,
			root,
			shown: folder.slice(root.length + 1),
		};
	return {
		folder,
		root: null,
		shown: folder.replace(/^\/(?:Users|home)\/[^/]+/u, "~") || "/",
	};
}

function tagOf(step: SessionRunStep, edits: EditsByCall): string {
	if (step.kind === "read") return "read";
	const made = edits
		.get(step.eventId)
		?.changes.some((change) => change.operation === "created");
	return made ? "write" : "edit";
}

export function getReadExtents(
	files: readonly { content: string | null; path: string }[],
	steps: Iterable<SessionRunStep>,
): Map<string, number> {
	const extents = new Map<string, number>();
	const reach = (path: string, line: number) =>
		extents.set(path, Math.max(extents.get(path) ?? 0, line));
	for (const file of files)
		if (file.content !== null)
			reach(file.path, file.content.replace(/\n$/u, "").split("\n").length);
	for (const step of steps)
		for (const range of step.ranges ?? [])
			if (range.to !== null) reach(range.path, range.to);
	return extents;
}

function linesRead(
	ranges: readonly SessionRunReadRange[],
	extent: number | undefined,
): number | null {
	let lines = 0;
	for (const range of ranges) {
		const to = range.to ?? extent;
		if (to === undefined) return null;
		lines += Math.max(to - range.from + 1, 0);
	}
	return lines;
}

function ReadRuler({
	extent,
	ranges: given,
}: {
	extent: number | undefined;
	ranges: readonly SessionRunReadRange[];
}) {
	const ranges = given.filter(
		(range) =>
			Number.isFinite(range.from) &&
			range.from >= 1 &&
			(range.to === null || range.to >= range.from),
	);
	if (ranges.length === 0) return null;
	const total = Math.max(
		1,
		extent ?? 0,
		...ranges.map((range) => range.to ?? range.from),
	);
	const share = (value: number) =>
		`${Math.min(Math.max(value / total, 0), 1) * 100}%`;
	const said = ranges
		.map((range) =>
			range.to === null
				? range.from === 1
					? "all"
					: `${range.from}–end`
				: range.to === range.from
					? `${range.from}`
					: `${range.from}–${range.to}`,
		)
		.join(", ");
	const title = `Lines ${said}${extent ? ` of ${extent.toLocaleString()}` : ""}`;
	const count = linesRead(ranges, extent);
	return (
		<span
			role="img"
			aria-label={title}
			title={title}
			className="flex w-10 shrink-0 flex-col items-end gap-xxs"
		>
			<span className="text-body-xs line-solid text-ink-disabled tabular-nums">
				{count === null
					? "all lines"
					: `${count.toLocaleString()} ${count === 1 ? "line" : "lines"}`}
			</span>
			<span className="relative h-1 w-full overflow-hidden corner-full bg-hover-strong">
				{ranges.map((range) => {
					const to = range.to ?? total;
					return (
						<span
							key={`${range.from}-${range.to}`}
							// design-escape-ok(opacity): no role renders this; bg-ink-3/55
							className="absolute inset-y-0 min-w-0.5 corner-full bg-ink-3/55"
							style={{
								left: share(range.from - 1),
								width: share(to - range.from + 1),
							}}
						/>
					);
				})}
			</span>
		</span>
	);
}

function RepoRow({ root }: { root: string }) {
	return (
		<li
			className={cn(
				"flex h-6 items-center gap-s",
				"px-m pt-xs",
				"text-body-s font-medium",
				"text-ink-disabled",
			)}
		>
			<IconFolderOpenFilled
				aria-hidden="true"
				// design-escape-ok(opacity): no role renders this; text-ink-3/40
				className="size-3 shrink-0 text-ink-3/40"
			/>
			<span className="min-w-0 truncate">{root.split("/").at(-1)}</span>
		</li>
	);
}

function FolderRow({
	after,
	inRepo,
	place,
}: {
	after: Place | null;
	inRepo: boolean;
	place: Place;
}) {
	const parts = place.shown.split("/").filter(Boolean);
	const before =
		after && after.root === place.root
			? after.shown.split("/").filter(Boolean)
			: [];
	let shared = 0;
	while (
		shared < parts.length - 1 &&
		shared < before.length &&
		parts[shared] === before[shared]
	)
		shared++;
	const same = parts.slice(0, shared).join(" / ");
	const fresh = parts.slice(shared).join(" / ");
	return (
		<li
			className={cn(
				"flex min-h-6 items-start gap-s",
				"pt-s pr-m pb-xxs",
				"text-body-s",
				"text-ink-disabled",
				inRepo ? "pl-xxl" : "pl-m",
			)}
		>
			<IconFolderOpenFilled
				aria-hidden="true"
				// design-escape-ok(opacity): no role renders this; text-ink-3/40
				className="mt-xxs size-3 shrink-0 text-ink-3/40"
			/>
			<span className="min-w-0 [overflow-wrap:anywhere]">
				{/* design-escape-ok(opacity): no role renders this; text-ink-3/40 */}
				{same ? <span className="text-ink-3/40">{`${same} / `}</span> : null}
				{fresh}
			</span>
		</li>
	);
}

function StepRow({
	depth = 0,
	edit,
	extents,
	onPick,
	path,
	rowRef,
	selected,
	step,
}: {
	depth?: number;
	edit: EditEntry | undefined;
	extents: ReadonlyMap<string, number> | undefined;
	onPick: () => void;
	path: string | undefined;
	rowRef?: (row: HTMLElement | null) => void;
	selected: boolean;
	step: SessionRunStep;
}) {
	const onePath = path ?? (step.paths.length === 1 ? step.paths[0] : undefined);
	const fileName = onePath ? (onePath.split("/").at(-1) ?? onePath) : null;
	const FileIcon = getFileLanguage(fileName ?? "").Icon;
	const ranges =
		step.kind === "read" && onePath
			? (step.ranges ?? []).filter((range) => range.path === onePath)
			: [];
	const failedCheck = step.kind === "check" && step.failed;
	const Glyph =
		step.kind === "subagent"
			? IconPuzzleFilled
			: failedCheck
				? IconCircleXFilled
				: ICON[step.kind];
	return (
		<li ref={rowRef}>
			<button
				type="button"
				onClick={onPick}
				aria-current={selected || undefined}
				className={cn(
					"relative isolate flex h-6 w-full items-center gap-s",
					"px-m",
					"text-left text-body-m",
					"before:absolute before:inset-x-0 before:inset-y-px before:-z-10 before:corner-s before:transition-colors",
					depth === 1 && "pl-xxl",
					depth === 2 && "pl-[calc(var(--space-xxl)*4/3)]",
					// design-escape-ok(opacity): no role renders this; hover:before:bg-hover/50
					selected ? "before:bg-field" : "hover:before:bg-hover/50",
					step.failed
						? "text-error"
						: selected
							? "font-medium text-ink"
							: "text-ink-3",
				)}
			>
				<Glyph
					aria-hidden="true"
					className={cn(
						"size-3 shrink-0",
						step.kind === "check" &&
							!step.failed &&
							// design-escape-ok(colour): deliberate exception, dark lifts a passed check to green-400 for contrast; dark's success is emerald-500, a visibly different green
							"text-success dark:text-green-400",
						// design-escape-ok(base): a category colour from the opal sheen (data paint)
						step.kind === "edit" && "text-color-3",
						!failedCheck &&
							step.kind !== "check" &&
							step.kind !== "edit" &&
							"opacity-60",
					)}
				/>
				{fileName ? (
					<FileIcon
						aria-hidden="true"
						className={cn(
							"size-3.5 shrink-0 transition-colors",
							// design-escape-ok(opacity): no role renders this; text-ink-3/50
							selected ? "text-ink" : "text-ink-3/50",
						)}
					/>
				) : null}
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						step.kind === "edit" || step.kind === "check"
							? "text-ink"
							: undefined,
						(step.kind === "search" ||
							step.kind === "shell" ||
							step.kind === "git") &&
							"font-mono text-body-s",
					)}
				>
					{step.kind === "check" && step.check ? `${step.check} · ` : ""}
					{fileName ?? step.label ?? step.verb}
				</span>
				{ranges.length > 0 ? (
					<ReadRuler
						extent={onePath ? extents?.get(onePath) : undefined}
						ranges={ranges}
					/>
				) : null}
				{edit ? (
					<span className="shrink-0 text-body-s tabular-nums">
						{/* design-escape-ok(colour): diff paint: added lines */}
						<span className="text-success dark:text-green-400">
							+{edit.added}
						</span>{" "}
						{/* design-escape-ok(colour): diff paint: removed lines */}
						<span className="text-error dark:text-red-400">
							−{edit.removed}
						</span>
					</span>
				) : null}
			</button>
		</li>
	);
}
