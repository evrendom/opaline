import type { SessionTurnStepKind } from "@rudel/api-routes";
import { type Icon, IconFileCode, IconSparkles } from "@tabler/icons-react";
import {
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link } from "react-router-dom";
import { ConversationSkillLink } from "@/components/conversation/conversation-skill-link";
import { EmptyState } from "@/components/dashboard/page-parts";
import { FileTree } from "@/components/pierre/file-tree";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { shortRunId, shortSubagentId } from "@/features/sessions/run-id";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LineCounts } from "../files/session-reader-file-detail";
import { ScrollColumn } from "../files/session-reader-files-parts";
import {
	formatReaderCost,
	formatReaderDuration,
} from "../model/session-reader-model";
import { useSessionPlaces } from "../session-places";
import { SubagentChip } from "../subagents/session-reader-subagent-chip";
import { SummarySection } from "./session-reader-summary-section";
import {
	getSummaryTreeItems,
	type SummaryActivity,
	type SummaryChanges,
	type SummaryFile,
	type SummaryPlace,
	type SummarySkill,
	type SummarySubagent,
} from "./session-summary-model";

export type OpenPlace = (turnId: string, agent?: string) => void;

export type OpenFiles = (picks: { file?: string; run?: string }) => void;

const LIST_LIMIT = 8;

export { SummarySection };

export function ShortList<T>({
	fill = false,
	items,
	maxHeight,
	onShowAll,
	render,
}: {
	fill?: boolean;
	items: readonly T[];
	maxHeight?: string;
	onShowAll?: () => void;
	render: (item: T) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const shown = open ? items : items.slice(0, LIST_LIMIT);
	if (fill && !open)
		return (
			<FitRows
				floor="8rem"
				onShowAll={onShowAll ?? (() => setOpen(true))}
				rows=":scope > ul > li"
				total={items.length}
			>
				<ul className="flex flex-col">{items.map(render)}</ul>
			</FitRows>
		);
	return (
		<>
			{maxHeight ? (
				<div className={cn("-mx-2 flex min-h-0 flex-col", maxHeight)}>
					<ScrollColumn>
						<ul className="flex flex-col">{shown.map(render)}</ul>
					</ScrollColumn>
				</div>
			) : (
				<ul className="-mx-2 flex flex-col">{shown.map(render)}</ul>
			)}
			{items.length > LIST_LIMIT ? (
				<ShowAll onClick={onShowAll ?? (() => setOpen(!open))}>
					{open ? "Show fewer" : `Show all ${items.length}`}
				</ShowAll>
			) : null}
		</>
	);
}

export function ShowAll({
	children,
	onClick,
}: {
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="w-fit text-xs text-muted-foreground tabular-nums hover:text-foreground"
		>
			{children}
		</button>
	);
}

function FitRows({
	children,
	floor,
	onShowAll,
	rows,
	total,
}: {
	children: ReactNode;
	floor: string;
	onShowAll: () => void;
	rows: string;
	total: number;
}) {
	const area = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState({ clipped: false, height: 0, least: 0 });
	useLayoutEffect(() => {
		const room = area.current;
		const content = list.current;
		if (!room || !content) return;
		const measure = () => {
			const space = room.getBoundingClientRect().height;
			const top = content.getBoundingClientRect().top;
			let height = 0;
			let clipped = false;
			let least = 0;
			content.querySelectorAll(rows).forEach((row, index) => {
				const bottom = row.getBoundingClientRect().bottom - top;
				if (index < LIST_LIMIT) least = Math.max(least, bottom);
				if (bottom <= space + 0.5) height = Math.max(height, bottom);
				else clipped = true;
			});
			setFit((had) =>
				had.height === height && had.clipped === clipped && had.least === least
					? had
					: { clipped, height, least },
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(room);
		observer.observe(content);
		return () => observer.disconnect();
	}, [rows]);
	return (
		<>
			<div
				ref={area}
				className="relative -mx-2 flex-1"
				style={{ minHeight: `max(${fit.least}px, ${floor})` }}
			>
				<div
					data-fade-bottom={fit.clipped ? "" : undefined}
					className="scroll-fade absolute inset-x-0 top-0 overflow-hidden"
					style={{ height: fit.height }}
				>
					<div ref={list}>{children}</div>
				</div>
			</div>
			{fit.clipped ? (
				<ShowAll onClick={onShowAll}>Show all {total}</ShowAll>
			) : null}
		</>
	);
}

export function Row({ children }: { children: ReactNode }) {
	return (
		<li className="flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-[13px] hover:bg-accent/60">
			{children}
		</li>
	);
}

export function Meta({ children }: { children: ReactNode }) {
	return (
		<span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
			{children}
		</span>
	);
}

export function Glyph({
	className,
	icon: Icon,
}: {
	className?: string;
	icon: Icon;
}) {
	return (
		<Icon
			aria-hidden="true"
			className={cn("size-4 shrink-0 text-muted-foreground", className)}
		/>
	);
}

export function PlaceLink({
	onOpen,
	places,
}: {
	onOpen: OpenPlace;
	places: readonly SummaryPlace[];
}) {
	const first = places[0];
	if (!first) return null;
	return (
		<button
			type="button"
			title={`Open turn ${shortRunId(first.turnId)} in the detail`}
			onClick={() => onOpen(first.turnId, first.agent)}
			className="shrink-0 rounded px-1 text-xs font-medium text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
		>
			{shortRunId(first.turnId)}
			{first.agent ? ` · ${shortSubagentId(first.agent)}` : ""}
			{places.length > 1 ? ` +${places.length - 1}` : ""}
		</button>
	);
}

const asPlaces = (turns: readonly string[]): SummaryPlace[] =>
	turns.map((turnId) => ({ turnId }));

const STEP_KIND_LABELS = {
	verify: "checks",
	search: "searches",
	shell: "shell",
	git: "git",
	github: "GitHub",
	mcp: "MCP",
} as const satisfies Record<SessionTurnStepKind, string>;

const STEP_KIND_LABEL_ORDER = Object.keys(
	STEP_KIND_LABELS,
) as SessionTurnStepKind[];

export function SummaryActivityLine({
	activity,
}: {
	activity: SummaryActivity;
}) {
	const { stepKinds } = activity;
	const parts: readonly (readonly [number, string])[] = [
		[activity.toolCalls, "tool calls"],
		...STEP_KIND_LABEL_ORDER.map(
			(kind) => [stepKinds[kind], STEP_KIND_LABELS[kind]] as const,
		),
		[activity.compactions, "compactions"],
		[activity.errors, "errors"],
	];
	return (
		<p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{parts
				.filter(([value]) => value > 0)
				.map(([value, label]) => (
					<span key={label} className="whitespace-nowrap">
						<span
							className={cn(
								"text-foreground tabular-nums",
								label === "errors" && "text-rose-600 dark:text-rose-400",
							)}
						>
							{formatCompactNumber(value)}
						</span>{" "}
						{label}
					</span>
				))}
			{activity.slashCommands.map((command) => (
				<span key={command} className="font-mono">
					{command}
				</span>
			))}
		</p>
	);
}

export const SUMMARY_TOP_HEIGHT = "max-h-56";

export function SkillRow({
	onOpen,
	skill,
}: {
	onOpen: OpenPlace;
	skill: SummarySkill;
}) {
	return (
		<Row>
			<Glyph icon={IconSparkles} className="text-amber-500" />
			<ConversationSkillLink
				name={skill.name}
				className="min-w-0 flex-1 truncate hover:underline"
			>
				<span className="truncate">{skill.name}</span>
			</ConversationSkillLink>
			<span className="flex-1" />
			<Meta>
				{skill.uses > 0 ? `${skill.uses}×` : "received"}
				{skill.subagents ? " · subagents" : ""}
			</Meta>
			<PlaceLink onOpen={onOpen} places={asPlaces(skill.turns)} />
		</Row>
	);
}

export function SummaryFiles({
	files,
	onOpenFiles,
}: {
	files: readonly SummaryFile[];
	onOpenFiles: OpenFiles;
}) {
	const changed = useMemo(
		() => files.filter((file) => file.created + file.edited > 0),
		[files],
	);
	const shown = changed.length > 0 ? changed : files;
	const items = useMemo(() => getSummaryTreeItems(shown), [shown]);
	if (files.length === 0)
		return (
			<div className="relative mt-2 min-h-26 flex-1">
				<EmptyState
					className="absolute inset-0 gap-2 p-4 py-0"
					icon={IconFileCode}
				/>
			</div>
		);
	return (
		<FitRows
			floor="17.5rem"
			onShowAll={() => onOpenFiles({})}
			rows='[role="treeitem"]'
			total={shown.length}
		>
			<FileTree
				items={items}
				onPickTag={(run) => onOpenFiles({ run })}
				onSelect={(file) => onOpenFiles({ file })}
				selected={null}
			/>
		</FitRows>
	);
}

export function SummaryChangesStrip({ changes }: { changes: SummaryChanges }) {
	const counts = [
		{ count: changes.edited, label: "edited" },
		{ count: changes.added, label: "added" },
		{ count: changes.deleted, label: "deleted" },
	].filter((each) => each.count > 0);
	return (
		<span className="flex min-w-0 items-baseline gap-3 text-sm text-muted-foreground tabular-nums">
			<span className="min-w-0 truncate">
				{counts.map((each, index) => (
					<span key={each.label}>
						{index > 0 ? " · " : null}
						<span className="text-foreground">
							{each.count.toLocaleString("en")}
						</span>{" "}
						{each.label}
					</span>
				))}
			</span>
			{changes.linesAdded + changes.linesRemoved > 0 ? (
				<span className="shrink-0">
					<LineCounts
						added={changes.linesAdded}
						removed={changes.linesRemoved}
					/>
				</span>
			) : null}
		</span>
	);
}

export function SummarySubagents({
	onOpen,
	subagents,
}: {
	onOpen: OpenPlace;
	subagents: readonly SummarySubagent[];
}) {
	const places = useSessionPlaces();
	if (subagents.length === 0) return <Empty>No subagents.</Empty>;
	return (
		<ShortList
			items={subagents}
			render={(subagent) => {
				const { turnId } = subagent;
				const label = (
					<>
						<SubagentChip selected={false} subagentId={subagent.subagentId} />
						<span className="font-mono text-xs">
							{shortSubagentId(subagent.subagentId)}
						</span>
						<span className="min-w-0 flex-1 truncate text-muted-foreground">
							{subagent.model ? formatModelDisplayLabel(subagent.model) : ""}
						</span>
					</>
				);
				return (
					<Row key={subagent.subagentId}>
						{places ? (
							<Link
								to={places.hrefs.subagent(subagent.subagentId)}
								title="Read its thread"
								className="flex min-w-0 flex-1 items-center gap-2.5 hover:underline"
							>
								{label}
							</Link>
						) : turnId ? (
							<button
								type="button"
								title="Open it in focus in the detail"
								onClick={() => onOpen(turnId, subagent.subagentId)}
								className="flex min-w-0 flex-1 items-center gap-2.5 text-left hover:underline"
							>
								{label}
							</button>
						) : (
							<span className="flex min-w-0 flex-1 items-center gap-2.5">
								{label}
							</span>
						)}
						<Meta>
							{formatReaderDuration(subagent.durationSeconds ?? null)} ·{" "}
							{formatCompactNumber(subagent.totalTokens ?? 0)} tokens ·{" "}
							{formatReaderCost(subagent.estimatedCost)}
						</Meta>
						{places && turnId ? (
							<PlaceLink
								onOpen={onOpen}
								places={[{ agent: subagent.subagentId, turnId }]}
							/>
						) : null}
					</Row>
				);
			}}
		/>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

export function Pending() {
	return <p className="text-[13px] text-muted-foreground">Loading…</p>;
}
