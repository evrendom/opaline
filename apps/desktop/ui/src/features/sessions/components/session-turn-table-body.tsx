import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { KeyboardEvent, RefObject } from "react";
import { FluidHoverHighlight } from "@/app/ui/fluid-hover-highlight";
import { useFluidHover } from "@/hooks/use-fluid-hover";
import type { SessionTurnEpisode } from "./session-turn-episodes";
import type { SessionTurnTableRow } from "./session-turn-table";
import type { TurnTableColumn } from "./session-turn-table-columns";
import type { SessionTurnViewedGroup } from "./session-turn-table-geometry";
import { SessionTurnTableRowView } from "./session-turn-table-row";
import {
	isSessionTurnTableRowInViewport,
	type SessionTurnSelection,
} from "./session-turn-table-selection";

export function SessionTurnTableBody({
	bodyRef,
	collapsedEpisodeKeys,
	episodeByStartIndex,
	matchedIndices,
	memberColumns,
	memberGridTemplate,
	model,
	modelColumns,
	modelGridTemplate,
	onEpisodeToggle,
	onKeyDown,
	onPrefetchTurn,
	onSelect,
	primarySpeaker,
	rows,
	selectedRowKey,
	showSpeakerColumn,
	showSpeakerHighlights,
	userImageUrl,
	userLabel,
	viewedRowKeys,
	viewedIndicatorGroups,
	viewportRange,
}: {
	bodyRef: RefObject<HTMLTableSectionElement | null>;
	viewedIndicatorGroups: readonly SessionTurnViewedGroup[];
	collapsedEpisodeKeys: ReadonlySet<string> | undefined;
	episodeByStartIndex: ReadonlyMap<number, SessionTurnEpisode>;
	matchedIndices: ReadonlySet<number> | undefined;
	memberColumns: readonly TurnTableColumn[];
	memberGridTemplate: string;
	model: string | undefined;
	modelColumns: readonly TurnTableColumn[];
	modelGridTemplate: string;
	onEpisodeToggle: ((key: string) => void) | undefined;
	onKeyDown: (
		event: KeyboardEvent<HTMLTableRowElement>,
		visibleIndex: number,
	) => void;
	onPrefetchTurn: ((turnId: string, immediate: boolean) => void) | undefined;
	onSelect: (selection: SessionTurnSelection) => void;
	primarySpeaker: SessionTurnTableRow["speaker"];
	rows: readonly SessionTurnTableRow[];
	selectedRowKey: string | undefined;
	showSpeakerColumn: boolean;
	showSpeakerHighlights: boolean;
	userImageUrl: string | undefined;
	userLabel: string;
	viewedRowKeys: ReadonlySet<string>;
	viewportRange: readonly [number, number] | undefined;
}) {
	const hover = useFluidHover(bodyRef, {
		axis: "y",
		// Ledger selection happens on pointer-down; separators and whitespace
		// must not synthesize clicks or select neighboring turns.
		gapClick: false,
	});

	return (
		<tbody
			ref={bodyRef}
			className="relative isolate block min-w-full bg-(--session-turn-table-surface)"
			data-session-turn-table-body
			{...hover.handlers}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					hover.setActiveIndex(null);
				}
			}}
		>
			{/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: This inert, non-tabbed row only hosts the decorative highlight. */}
			<tr
				aria-hidden="true"
				inert
				className="pointer-events-none absolute inset-0 z-0 block"
			>
				<td className="block size-full p-zero">
					<FluidHoverHighlight hover={hover} className="corner-zero bg-hover" />
				</td>
			</tr>
			{/* Loaded pages intentionally stay in the DOM, even for ~2,000-row whale searches. */}
			{rows.map((row, visibleIndex) => {
				const { match } = row;
				const columns = row.speaker === "member" ? memberColumns : modelColumns;
				const gridTemplate =
					row.speaker === "member" ? memberGridTemplate : modelGridTemplate;
				const beginsTurn =
					visibleIndex === 0 ||
					rows[visibleIndex - 1]?.match.option.key !== match.option.key;
				return (
					<SessionTurnTableRowView
						key={row.key}
						beginsTurn={beginsTurn}
						collapsedEpisodeKeys={collapsedEpisodeKeys}
						columns={columns}
						episode={
							beginsTurn ? episodeByStartIndex.get(match.index) : undefined
						}
						inViewport={isSessionTurnTableRowInViewport({
							turnIndex: match.index,
							viewportRange,
						})}
						matchesLens={matchedIndices?.has(match.index) ?? false}
						model={model}
						gridTemplate={gridTemplate}
						emphasized={showSpeakerHighlights && row.speaker === primarySpeaker}
						onEpisodeToggle={onEpisodeToggle}
						onKeyDown={onKeyDown}
						onPrefetchTurn={onPrefetchTurn}
						onSelect={onSelect}
						row={row}
						registerHoverItem={hover.registerItem}
						setHoverActiveIndex={hover.setActiveIndex}
						selected={row.key === selectedRowKey}
						showSpeakerColumn={showSpeakerColumn}
						userImageUrl={userImageUrl}
						userLabel={userLabel}
						viewed={viewedRowKeys.has(row.key)}
						visibleIndex={visibleIndex}
					/>
				);
			})}
			<MotionConfig reducedMotion="user">
				<AnimatePresence initial={false}>
					{viewedIndicatorGroups.map((group, index) => (
						<motion.tr
							// biome-ignore lint/suspicious/noArrayIndexKey: groups intentionally morph by ordinal position
							key={`viewed-group-${index}`}
							animate={{
								height: Math.max(0, group.height - 2),
								opacity: 1,
								top: group.top + 1,
							}}
							className="pointer-events-none absolute left-0.5 z-2 block w-1"
							data-first-visible-index={group.firstVisibleIndex}
							data-last-visible-index={group.lastVisibleIndex}
							data-pressed="true"
							data-row-count={group.rowCount}
							data-viewed-indicator-group
							exit={{ opacity: 0 }}
							initial={index === 0 ? false : { opacity: 0 }}
							transition={{
								default: {
									damping: 45,
									stiffness: 550,
									type: "spring",
								},
								opacity: { duration: 0.12, ease: "easeOut" },
							}}
						>
							<td
								aria-hidden="true"
								// design-escape-ok(shadow): artwork; the progress dot's bevel
								className="block size-full corner-full bg-accent shadow-[inset_0_0_1px_#00000012,inset_0_1px_1px_#00000012,inset_0_-1px_0_#ffffff0a] dark:shadow-none"
							/>
						</motion.tr>
					))}
				</AnimatePresence>
			</MotionConfig>
		</tbody>
	);
}
