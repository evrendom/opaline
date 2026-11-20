import { scanMemberLanguageSignals } from "@rudel/language-signals";
import type { CSSProperties } from "react";
import { Skeleton } from "@/app/ui/skeleton";
import { ConversationTraceTreeItem } from "@/components/conversation/ConversationTrace";
import { SignalText } from "@/components/signal-text";
import { cn } from "@/lib/utils";
import { getStableSessionSkeletonWidth } from "./session-detail-skeleton-debug";
import type { SessionTurnTablePaneOption } from "./session-turn-table-pane";

const SESSION_DETAIL_PREVIEW_CODE_POINT_LIMIT = 140;

type SkeletonTraceRow = {
	index: number;
	kind: "error" | "message" | "tool";
};

export function SessionContinuousTurnSkeleton({
	continuesThread,
	option,
	userLabel,
}: {
	continuesThread: boolean;
	option: SessionTurnTablePaneOption;
	userLabel: string;
}) {
	const hasMemberMessage = option.memberPreview !== "No member message";
	const previewTruncated =
		Array.from(option.memberPreview).length >=
		SESSION_DETAIL_PREVIEW_CODE_POINT_LIMIT;
	const rows = buildSkeletonTraceRows(option);

	return (
		<div aria-busy="true" className="min-w-0" data-session-turn-skeleton>
			<output className="sr-only">Loading turn</output>
			{hasMemberMessage ? (
				<>
					<ConversationTraceTreeItem continues depth={1} rowHeight={40}>
						<div className="flex min-h-10 min-w-0 items-center gap-m pr-l">
							<Skeleton className="size-5 shrink-0 corner-xs bg-field" />
							<p className="shrink-0 text-body-m font-medium text-ink">
								{userLabel}
							</p>
							<p className="min-w-0 flex-1 truncate text-body-l text-ink">
								<SignalText
									scanSignals={scanMemberLanguageSignals}
									text={option.memberPreview}
								/>
							</p>
						</div>
					</ConversationTraceTreeItem>
					<div className="grid min-w-0 gap-m py-m pr-l pl-[calc(var(--space-xxl)*2.25)]">
						<p className="line-clamp-3 whitespace-pre-wrap break-words text-body-l text-ink">
							<SignalText
								scanSignals={scanMemberLanguageSignals}
								text={option.memberPreview}
							/>
						</p>
						{previewTruncated ? (
							<Skeleton
								className="h-3 corner-xs bg-field"
								data-session-skeleton-preview-continuation
								style={getSkeletonWidthStyle(
									option.key,
									"member-continuation",
									0,
								)}
							/>
						) : null}
					</div>
				</>
			) : null}

			<ConversationTraceTreeItem
				continues={continuesThread}
				depth={1}
				descends={rows.length > 0}
				rowHeight={40}
			>
				<div className="flex min-h-10 min-w-0 items-center gap-m pr-l">
					<Skeleton className="size-5 shrink-0 corner-xs bg-field" />
					<Skeleton className="h-3 w-20 shrink-0 corner-xs bg-field" />
					<Skeleton
						className="h-3 max-w-72 flex-1 corner-xs bg-field"
						style={getSkeletonWidthStyle(option.key, "model-preview", 0)}
					/>
				</div>
			</ConversationTraceTreeItem>

			<ol className="list-none">
				{rows.map((row, rowIndex) => (
					<li key={`${row.kind}-${row.index}`}>
						<ConversationTraceTreeItem
							continues={rowIndex < rows.length - 1 || continuesThread}
							depth={2}
							rowHeight={row.kind === "message" ? 112 : 24}
						>
							<SkeletonTraceRowContent option={option} row={row} />
						</ConversationTraceTreeItem>
					</li>
				))}
			</ol>

			<SkeletonChipRows option={option} />
		</div>
	);
}

function SkeletonTraceRowContent({
	option,
	row,
}: {
	option: SessionTurnTablePaneOption;
	row: SkeletonTraceRow;
}) {
	if (row.kind === "message") {
		return (
			<div
				className="-ml-l grid min-h-28 min-w-0 content-center gap-m pr-l"
				data-session-skeleton-row-kind="message"
			>
				<Skeleton
					className="h-3 corner-xs bg-field"
					style={getSkeletonWidthStyle(option.key, row.kind, row.index)}
				/>
				<Skeleton
					className="h-3 corner-xs bg-field"
					style={getSkeletonWidthStyle(option.key, "message-tail", row.index)}
				/>
				<Skeleton
					className="h-3 corner-xs bg-field"
					style={getSkeletonWidthStyle(option.key, "message-detail", row.index)}
				/>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"-ml-l flex h-6 min-w-0 items-center gap-m pr-l",
				row.kind === "error" && "edge-l-l border-error bg-error-tint pl-m",
			)}
			data-session-skeleton-row-kind={row.kind}
		>
			<Skeleton
				className={cn(
					"size-4 shrink-0 corner-xs bg-field",
					row.kind === "error" && "bg-error/20",
				)}
			/>
			<Skeleton
				className="h-3 corner-xs bg-field"
				style={getSkeletonWidthStyle(option.key, row.kind, row.index)}
			/>
		</div>
	);
}

function SkeletonChipRows({ option }: { option: SessionTurnTablePaneOption }) {
	const groups = [
		{ kind: "skill", values: option.metrics.skills },
		{ kind: "file", values: option.metrics.editedFiles },
	] as const;

	return groups.map((group) =>
		group.values.length > 0 ? (
			<div
				key={group.kind}
				className="flex min-h-8 flex-wrap items-center gap-s pr-l pl-[calc(var(--space-xxl)*2.25)]"
				data-session-skeleton-row-kind={`${group.kind}-chips`}
			>
				{group.values.map((value, index) => (
					<Skeleton
						key={`${group.kind}-${value}`}
						className="h-5 corner-xs bg-field"
						style={getSkeletonChipWidthStyle(option.key, group.kind, index)}
					/>
				))}
			</div>
		) : null,
	);
}

function buildSkeletonTraceRows(
	option: SessionTurnTablePaneOption,
): SkeletonTraceRow[] {
	return [
		...Array.from(
			{ length: option.metrics.usageEvents.length },
			(_, index) => ({
				index,
				kind: "message" as const,
			}),
		),
		...Array.from({ length: option.toolCallCount }, (_, index) => ({
			index,
			kind: "tool" as const,
		})),
		...Array.from({ length: option.metrics.errorCount }, (_, index) => ({
			index,
			kind: "error" as const,
		})),
	];
}

type SkeletonWidthStyle = CSSProperties & {
	"--session-skeleton-width": string;
};

function getSkeletonWidthStyle(
	turnId: string,
	kind: string,
	index: number,
): SkeletonWidthStyle {
	return {
		"--session-skeleton-width": `${getStableSessionSkeletonWidth(turnId, kind, index)}%`,
		width: "var(--session-skeleton-width)",
	};
}

function getSkeletonChipWidthStyle(
	turnId: string,
	kind: string,
	index: number,
): SkeletonWidthStyle {
	return {
		"--session-skeleton-width": `${getStableSessionSkeletonWidth(turnId, kind, index)}px`,
		width: "var(--session-skeleton-width)",
	};
}
