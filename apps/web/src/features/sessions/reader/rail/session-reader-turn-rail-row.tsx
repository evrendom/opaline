import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { IconChevronDown } from "@tabler/icons-react";
import { memo, type ReactNode, type SyntheticEvent, useState } from "react";
import { shortRunId, shortSubagentId } from "@/features/sessions/run-id";
import {
	CopyIcon,
	useCopyFeedback,
} from "@/features/shell/components/copy-button";
import { cn } from "@/lib/utils";
import {
	ContextFill,
	type ContextUse,
} from "../context/session-reader-context-fill";
import {
	formatReaderCost,
	formatReaderDuration,
	getCostShade,
} from "../model/session-reader-model";
import { SubagentChip } from "../subagents/session-reader-subagent-chip";
import { useSubagentFigures } from "../subagents/session-reader-subagent-marks";
import { useSubagentTintById } from "../subagents/session-reader-subagent-tints";
import { RailGitMarks } from "./session-reader-rail-git-marks";
import { RailTags } from "./session-reader-rail-tags";

export function subagentIdsOf(turn: SessionDetailTurnSummary): string[] {
	const ids = (turn.subagentEvents ?? []).flatMap((event) =>
		event.subagentId ? [event.subagentId] : [],
	);
	return [...new Set(ids)];
}

const NO_IDS: readonly string[] = [];

export function railLineKey(turnId: string, subagentId: string | null) {
	return subagentId ? `${turnId}/${subagentId}` : turnId;
}

const IDLE = "opacity-40";

export const RailRow = memo(function RailRow({
	active,
	costThresholds,
	figure,
	figureMarks,
	focusedSubagent,
	idle,
	lineRef,
	marks,
	number,
	onPick,
	picked,
	rowRef,
	subagentOf,
	turn,
	withSubagents = true,
}: {
	active: boolean;
	costThresholds: readonly number[];
	figure: RailFigure;
	focusedSubagent: string | null;
	idle?: ReadonlySet<string>;
	lineRef: (subagentId: string) => (line: HTMLElement | null) => void;
	marks?: ReadonlyMap<string, ReactNode>;
	figureMarks?: ReadonlyMap<string, ReactNode>;
	number: number;
	onPick: (turn: SessionDetailTurnSummary, clientY: number) => void;
	picked: readonly string[];
	rowRef: (row: HTMLButtonElement | null) => void;
	subagentOf: ReadonlyMap<string, RailSubagent>;
	turn: SessionDetailTurnSummary;
	withSubagents?: boolean;
}) {
	const all = subagentIdsOf(turn);
	const ids = withSubagents ? all : NO_IDS;
	const [folded, setFolded] = useState(false);
	const open =
		!folded || (focusedSubagent !== null && ids.includes(focusedSubagent));
	const shown = open ? ids : NO_IDS;
	const cost =
		withSubagents || turn.estimatedCost === null
			? turn.estimatedCost
			: Math.max(
					0,
					all.reduce(
						(rest, id) => rest - (subagentOf.get(id)?.estimatedCost ?? 0),
						turn.estimatedCost,
					),
				);
	const isIdle = (subagentId: string | null) =>
		idle?.has(railLineKey(turn.turnId, subagentId)) ?? false;
	return (
		<button
			ref={rowRef}
			type="button"
			aria-current={active ? "true" : undefined}
			aria-label={`Turn ${number}`}
			onClick={(event) => onPick(turn, event.clientY)}
			className={cn(
				"group/row relative grid auto-rows-[minmax(var(--rail-line-height),auto)] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-(--rail-line-gap) rounded-md px-1.5 text-left text-xs corner-squircle squircle:rounded-xl",
				shown.length > 0 && "pb-(--rail-line-gap)",
			)}
		>
			{shown.length > 0 ? (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 -z-[5] rounded-md ring-1 ring-border/60 ring-inset corner-squircle squircle:rounded-xl"
				/>
			) : null}
			<span
				className={cn(
					"group/line flex min-w-0 flex-wrap items-center gap-1.5 tabular-nums",
					isIdle(null) && IDLE,
				)}
			>
				<span className="relative flex shrink-0 items-center">
					<span className={cn("font-medium", FADES_UNDER_COPY)}>
						{shortRunId(turn.turnId)}
					</span>
					<RowCopy label="Copy turn ID" value={turn.turnId} />
				</span>
				<span className="flex shrink-0 items-center -space-x-1 empty:hidden">
					{marks?.get(railLineKey(turn.turnId, null))}
					<RailGitMarks counts={turn.stepKinds} />
				</span>
				<RailTags picked={picked} turn={turn} />
				{ids.length > 0 ? (
					<GroupToggle
						count={ids.length}
						onToggle={() => setFolded(open)}
						open={open}
					/>
				) : null}
			</span>
			<TurnFigures
				className={
					isIdle(null) && ids.every((id) => isIdle(id)) ? IDLE : undefined
				}
				cost={cost}
				costThresholds={costThresholds}
				figure={figure}
				ids={shown}
				markOf={(subagentId) =>
					figureMarks?.get(railLineKey(turn.turnId, subagentId))
				}
				subagentOf={subagentOf}
				turn={turn}
			/>
			{shown.map((subagentId) => (
				<SubagentName
					key={subagentId}
					idle={isIdle(subagentId)}
					lineRef={lineRef(subagentId)}
					mark={marks?.get(railLineKey(turn.turnId, subagentId))}
					selected={subagentId === focusedSubagent}
					subagentId={subagentId}
				/>
			))}
			<RailLines count={1 + shown.length} />
		</button>
	);
});

function RailLines({ count }: { count: number }) {
	return Array.from({ length: count }, (_, line) => (
		<span
			// biome-ignore lint/suspicious/noArrayIndexKey: one empty strip per line, by its place; they never reorder
			key={line}
			data-rail-line=""
			style={{ gridRow: `${line + 1} / ${line + 2}` }}
			className={cn(
				"pointer-events-none absolute inset-y-0 col-span-full rounded-md corner-squircle squircle:rounded-xl",
				line === 0 ? "-inset-x-1.5" : "-right-(--rail-line-gap) left-2.5",
			)}
		/>
	));
}

const SUBAGENT_FIGURE = "pr-(--rail-line-gap)";

export type RailFigure = "context" | "cost" | "time";

export type RailSubagent = {
	context?: ContextUse | null;
	durationSeconds?: number | null;
	estimatedCost: number | null;
	mainThread?: ContextUse | null;
	subagentId: string;
};

const COPY_REVEAL =
	"duration-300 ease-out group-hover/line:delay-300 motion-reduce:transition-none";

const FADES_UNDER_COPY = cn(
	"[mask-image:linear-gradient(to_right,black_67.5%,transparent_82.5%)] [mask-position:0%_0] [mask-repeat:no-repeat] [mask-size:200%_100%] transition-[mask-position] group-hover/line:[mask-position:100%_0]",
	COPY_REVEAL,
);

function GroupToggle({
	count,
	onToggle,
	open,
}: {
	count: number;
	onToggle: () => void;
	open: boolean;
}) {
	const run = (event: SyntheticEvent) => {
		event.stopPropagation();
		event.preventDefault();
		onToggle();
	};
	const label = open ? "Fold its subagents" : `Show its ${count} subagents`;
	return (
		// biome-ignore lint/a11y/useSemanticElements: inside the row's button, which can't hold a <button>.
		<span
			role="button"
			tabIndex={0}
			title={label}
			aria-label={label}
			aria-expanded={open}
			onClick={run}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") run(event);
			}}
			className="-ml-1 inline-flex shrink-0 cursor-pointer items-center rounded px-0.5 text-muted-foreground transition-colors hover:text-foreground"
		>
			<IconChevronDown
				aria-hidden="true"
				className={cn(
					"size-3.5 transition-transform duration-200",
					!open && "-rotate-90",
				)}
			/>
		</span>
	);
}

function RowCopy({ label, value }: { label: string; value: string }) {
	const { copied, copy } = useCopyFeedback(value);
	const run = (event: SyntheticEvent) => {
		event.stopPropagation();
		event.preventDefault();
		void copy();
	};
	return (
		// biome-ignore lint/a11y/useSemanticElements: inside the row's button, which can't hold a <button>; the row itself is the keyboard's control.
		<span
			role="button"
			tabIndex={-1}
			title={label}
			aria-label={copied ? "Copied" : label}
			data-copied={copied ? "true" : undefined}
			onClick={run}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") run(event);
			}}
			className={cn(
				"copy-button absolute top-1/2 right-0 inline-flex -translate-y-1/2 cursor-pointer items-center justify-center rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/line:opacity-100 hover:text-foreground",
				COPY_REVEAL,
			)}
		>
			<CopyIcon className="size-3.5" />
		</span>
	);
}

function SubagentName({
	idle,
	lineRef,
	mark,
	selected,
	subagentId,
}: {
	idle: boolean;
	lineRef: (line: HTMLElement | null) => void;
	mark: ReactNode;
	selected: boolean;
	subagentId: string;
}) {
	const tint = useSubagentTintById()(subagentId);
	const gitActions = useSubagentFigures().get(subagentId)?.gitActions;
	return (
		<span
			ref={lineRef}
			data-rail-subagent=""
			className={cn(
				"group/line flex min-w-0 flex-wrap items-center gap-1.5 pl-4 tabular-nums",
				selected ? "text-foreground" : "text-muted-foreground",
				idle && IDLE,
			)}
		>
			<SubagentChip progress selected={selected} subagentId={subagentId} />
			<span className="relative flex shrink-0 items-center">
				<span
					className={FADES_UNDER_COPY}
					style={tint ? { color: tint } : undefined}
				>
					{shortSubagentId(subagentId)}
				</span>
				<RowCopy label="Copy subagent ID" value={subagentId} />
			</span>
			<span className="flex shrink-0 items-center -space-x-1 empty:hidden">
				{mark}
				<RailGitMarks counts={gitActions} />
			</span>
		</span>
	);
}

function OverFigure({ mark }: { mark: ReactNode }) {
	if (!mark) return null;
	return (
		<span className="relative flex h-1 w-full">
			<span className="absolute top-0 right-0 flex">{mark}</span>
		</span>
	);
}

function TurnFigures({
	className,
	costThresholds,
	figure,
	cost,
	ids,
	markOf,
	subagentOf,
	turn,
}: {
	className?: string;
	markOf?: (subagentId: string | null) => ReactNode;
	cost: number | null;
	costThresholds: readonly number[];
	figure: RailFigure;
	ids: readonly string[];
	subagentOf: ReadonlyMap<string, RailSubagent>;
	turn: SessionDetailTurnSummary;
}) {
	return (
		<span
			className={cn(
				"grid grid-rows-subgrid items-center justify-items-end gap-y-(--rail-line-gap) tabular-nums",
				className,
			)}
			style={{ gridRow: `span ${ids.length + 1}` }}
		>
			<span className="relative flex flex-col items-end gap-0.5">
				<OverFigure mark={markOf?.(null)} />
				{figure === "context" ? (
					<span className="flex w-16 items-center justify-end text-muted-foreground">
						<ContextFill compact tip={false} turn={turn} />
					</span>
				) : figure === "time" ? (
					<span className="w-14 text-right whitespace-nowrap text-muted-foreground">
						{formatReaderDuration(turn.durationSeconds)}
					</span>
				) : (
					<span
						className={cn(
							"w-11 text-right",
							getCostShade(cost, costThresholds) ?? "text-muted-foreground",
						)}
					>
						{formatReaderCost(cost)}
					</span>
				)}
			</span>
			{ids.map((id) => {
				const subagent = subagentOf.get(id);
				const mark = markOf?.(id);
				return figure === "context" ? (
					<span
						key={id}
						className={cn(
							"flex w-16 flex-col items-end justify-center gap-0.5 text-muted-foreground",
							SUBAGENT_FIGURE,
						)}
					>
						<OverFigure mark={mark} />
						<ContextFill compact tip={false} use={subagent?.context ?? null} />
					</span>
				) : figure === "time" ? (
					<span
						key={id}
						className={cn(
							"flex w-14 flex-col items-end gap-0.5 whitespace-nowrap text-muted-foreground",
							SUBAGENT_FIGURE,
						)}
					>
						<OverFigure mark={mark} />
						{formatReaderDuration(subagent?.durationSeconds ?? null)}
					</span>
				) : (
					<span
						key={id}
						className={cn(
							"flex w-11 flex-col items-end gap-0.5 text-muted-foreground",
							SUBAGENT_FIGURE,
						)}
					>
						<OverFigure mark={mark} />
						{formatReaderCost(subagent?.estimatedCost ?? null)}
					</span>
				);
			})}
		</span>
	);
}
