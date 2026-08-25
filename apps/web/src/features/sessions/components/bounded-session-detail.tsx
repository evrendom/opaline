import type {
	SessionDetailOverview,
	SessionDetailWindow,
} from "@rudel/api-routes";
import { ConversationTrace } from "@/components/conversation/ConversationTrace";
import type { TraceItem } from "@/components/conversation/conversation-trace";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { buildSessionDetailViewModel } from "./session-detail-view-model";

export type BoundedSessionDetailViewModel = ReturnType<
	typeof buildSessionDetailViewModel
>;

export function buildBoundedSessionDetailViewModel(
	overview: SessionDetailOverview,
	userMap: Record<string, string>,
): BoundedSessionDetailViewModel {
	const { session } = overview;
	const base = buildSessionDetailViewModel(
		{
			duration_min: session.durationMinutes,
			estimated_cost: session.estimatedCost,
			git_branch: session.gitBranch,
			git_sha: session.gitSha,
			input_tokens: session.inputTokens,
			model_used: session.modelUsed,
			output_tokens: session.outputTokens,
			repository: session.repository,
			session_date: session.sessionDate,
			session_id: session.sessionId,
			skills: session.skills,
			slash_commands: session.slashCommands,
			total_interactions: overview.turnPage.total,
			user_id: session.userId,
		},
		userMap,
	);
	const turnCount = overview.turnPage.total;

	return {
		...base,
		conversationSummary: {
			assistantMessages: turnCount,
			systemMessages: 0,
			totalMessages: turnCount * 2,
			userMessages: turnCount,
		},
		subagentNames: overview.subagents.map((item) => item.subagentId),
		subagentSummaries: overview.subagents.map((item) => ({
			id: item.subagentId,
			model: item.model ?? undefined,
			totalTokens: item.totalTokens ?? undefined,
		})),
	};
}

export function BoundedSessionConversation({
	detailWindow,
	onNavigate,
	safeModelUsed,
	safeUserDisplayName,
	userImageUrl,
}: {
	detailWindow: SessionDetailWindow;
	onNavigate: (mode: "newer" | "older", cursor: string) => void;
	safeModelUsed: string | undefined;
	safeUserDisplayName: string;
	userImageUrl: string | undefined;
}) {
	const traceItems = detailWindow.turns.flatMap((turn) =>
		turn.body ? [...turn.body.userItems, ...turn.body.responseItems] : [],
	) as TraceItem[];
	const omittedBodyCount = detailWindow.turns.filter(
		(turn) => turn.bodyOmitted === "oversized",
	).length;
	const olderCursor = detailWindow.olderCursor;
	const newerCursor = detailWindow.newerCursor;

	return (
		<>
			{olderCursor ? (
				<button
					type="button"
					className="justify-self-center rounded-full border border-[color:var(--dashboardy-border)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--dashboardy-subsurface)]"
					onClick={() => onNavigate("older", olderCursor)}
				>
					Previous turns
				</button>
			) : null}

			{omittedBodyCount > 0 ? (
				<p className="rounded-xl border border-[color:var(--dashboardy-border)] bg-[color:var(--dashboardy-subsurface)] px-4 py-3 text-sm text-[color:var(--dashboardy-muted)]">
					{omittedBodyCount} oversized turn
					{omittedBodyCount === 1 ? " was" : "s were"} omitted from this page.
				</p>
			) : null}

			{traceItems.length > 0 ? (
				<ConversationTrace
					items={traceItems}
					userLabel={safeUserDisplayName}
					userImageUrl={userImageUrl}
					agentLabel={
						safeModelUsed ? formatModelDisplayLabel(safeModelUsed) : undefined
					}
					agentModel={safeModelUsed}
				/>
			) : (
				<p className="py-6 text-center text-sm text-[color:var(--dashboardy-muted)]">
					No bounded conversation bodies are available on this page.
				</p>
			)}

			{newerCursor ? (
				<button
					type="button"
					className="justify-self-center rounded-full border border-[color:var(--dashboardy-border)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--dashboardy-subsurface)]"
					onClick={() => onNavigate("newer", newerCursor)}
				>
					Next turns
				</button>
			) : null}
		</>
	);
}
