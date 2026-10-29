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
		<li className="flex scroll-mt-2 flex-col gap-2 py-4 first:pt-2">
			<div className="flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground/70 tabular-nums">
				<span className="font-medium text-foreground">
					{OPERATION_LABEL[change.operation]}
				</span>
				<span>
					· {TOOL_LABEL[change.tool]}
					{change.line !== null ? ` · line ${change.line}` : ""} · {time}
				</span>
				{change.agentId ? (
					<SubagentTag
						className="inline-flex shrink gap-1"
						subagentId={change.agentId}
						title="Made by a subagent"
					/>
				) : null}
				{change.failed ? (
					<span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-px text-destructive">
						<IconAlertTriangleFilled className="size-3" />
						Failed, nothing changed
					</span>
				) : null}
				{turnId ? (
					<Button
						size="xs"
						variant="ghost"
						className="ml-auto cursor-pointer text-muted-foreground"
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
				<p className="text-xs text-muted-foreground">No change in text.</p>
			)}
			{change.cut ? <Cut /> : null}
		</li>
	);
}

export function Cut() {
	return (
		<p className="text-xs text-muted-foreground/70">
			Cut at {SESSION_FILE_TEXT_LIMIT.toLocaleString()} characters; the rest is
			in the transcript.
		</p>
	);
}
