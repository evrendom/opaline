import {
	SESSION_FILE_TEXT_LIMIT,
	type SessionFileChange,
} from "@rudel/api-routes";
import { IconAlertTriangleFilled, IconArrowUpRight } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import { DiffView } from "@/components/pierre/diff-view";
import type { DiffHunk } from "@/components/pierre/line-diff";
import { shortRunId } from "@/features/sessions/run-id";
import { cn } from "@/lib/utils";
import { LazyBlock } from "../detail/session-reader-lazy-block";
import { SubagentTag } from "../subagents/session-reader-subagent-chip";
import type { OpenPlace } from "../summary/session-reader-summary-sections";

const OPERATION_LABEL = {
	created: "Created",
	deleted: "Deleted",
	edited: "Edited",
} as const;

const TOOL_LABEL = { edit: "edit", patch: "patch", write: "write" } as const;

const DIFF_LINE_PX = 18;

export function ChangeBlock({
	change,
	hunks,
	language,
	onOpenTurn,
}: {
	change: SessionFileChange;
	hunks: DiffHunk[];
	language: string | null;
	onOpenTurn: OpenPlace;
}) {
	const { turnId } = change;
	const time = new Date(change.at).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	return (
		<li className="flex scroll-mt-2 flex-col gap-m py-xl first:pt-m">
			<div
				className={cn(
					"flex min-h-6 flex-wrap items-center gap-x-s gap-y-xs",
					"text-body-m tabular-nums",
					"text-ink-3",
				)}
			>
				<span className="font-medium text-ink">
					{OPERATION_LABEL[change.operation]}
				</span>
				<span>
					· {TOOL_LABEL[change.tool]}
					{change.line !== null ? ` · line ${change.line}` : ""} · {time}
				</span>
				{change.agentId ? (
					<SubagentTag
						className="inline-flex shrink gap-xs"
						subagentId={change.agentId}
						title="Made by a subagent"
					/>
				) : null}
				{change.failed ? (
					<span
						className={cn(
							"inline-flex items-center gap-xs",
							"corner-full px-s py-xxs",
							"bg-error-tint text-error",
						)}
					>
						<IconAlertTriangleFilled className="size-3" />
						Failed, nothing changed
					</span>
				) : null}
				{turnId ? (
					<Button
						size="sm"
						variant="secondary"
						className="ml-auto"
						onClick={() => onOpenTurn(turnId, change.agentId || undefined)}
					>
						Turn {shortRunId(turnId)}
						<IconArrowUpRight data-icon="inline-end" />
					</Button>
				) : null}
			</div>
			{hunks.length > 0 ? (
				<LazyBlock
					estimate={hunks.reduce(
						(total, hunk) => total + (hunk.lines.length + 1) * DIFF_LINE_PX,
						0,
					)}
					id={`${change.eventId}:${change.at}:${change.line ?? ""}:${hunks.length}`}
				>
					{() => (
						<DiffView
							hunks={hunks}
							language={language}
							className={cn(change.failed && "opacity-60")}
						/>
					)}
				</LazyBlock>
			) : (
				<p className="text-body-m text-ink-3">No change in text.</p>
			)}
			{change.cut ? <Cut /> : null}
		</li>
	);
}

export function Cut() {
	return (
		<p className="text-body-m text-ink-3">
			Cut at {SESSION_FILE_TEXT_LIMIT.toLocaleString()} characters; the rest is
			in the transcript.
		</p>
	);
}
