import type { SessionDetailOverview } from "@rudel/api-routes";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { buildConversationTrace } from "@/components/conversation/conversation-trace";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { parseConversations } from "@/lib/conversation-schema";
import { client } from "@/lib/orpc";
import {
	fetchSessionDetailInitial,
	fetchSessionDetailSubagent,
	isSessionDetailStaleRevisionError,
	SESSION_DETAIL_BODY_CACHE_TIME_MS,
	SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
	sessionDetailInitialQueryKey,
	sessionDetailSubagentQueryKey,
	shouldRetrySessionDetailFastQuery,
} from "./session-detail-fast-query";
import type { SessionReaderBody } from "./session-reader-model";
import {
	type AgentItem,
	getLaunchedSubagentKey,
} from "./session-reader-run-steps";

// Claude's subagents keep their own transcripts, and Codex's spawned agents
// run as sessions of their own — either way apart from the turn that
// launched them. To nest what a subagent did under its call in the reader's
// waterfall, the transcript is fetched — through the same queries the
// timeline's subagent branches use, so the two share one cache — and only
// while a waterfall that shows it is on screen.

type ReaderSubagents = {
	onStaleRevision: (error: unknown) => void;
	revision: string;
	sessionId: string;
	subagents: SessionDetailOverview["subagents"];
};

export const ReaderSubagentsContext = createContext<ReaderSubagents | null>(
	null,
);

const NO_BRANCHES: ReadonlyMap<string, readonly AgentItem[]> = new Map();

/** The agent paths Codex's spawn_agent calls in a turn launched — each a
 * session of its own. */
function getSpawnedAgentPaths(body: SessionReaderBody | null): string[] {
	const paths = new Set<string>();
	for (const item of body?.responseItems ?? []) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			if (event.kind !== "tool" || event.toolName !== "spawn_agent") continue;
			const path = getLaunchedSubagentKey({ ...event, result: event.result });
			if (path) paths.add(path);
		}
	}
	return [...paths];
}

/** The main agent's items across a session's loaded turns. */
function getSessionAgentItems(
	turns: readonly { body: SessionReaderBody | null }[],
): AgentItem[] {
	return turns.flatMap((turn) =>
		(turn.body?.responseItems ?? []).filter(
			(item): item is AgentItem => item.kind === "agent",
		),
	);
}

/** The subagents a turn's calls launched that have a transcript to fetch. */
function getLaunchedSubagentIds(
	body: SessionReaderBody | null,
	known: ReadonlySet<string>,
): string[] {
	const ids = new Set<string>();
	for (const item of body?.responseItems ?? []) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			const subagentId =
				event.kind === "tool" ? event.result?.subagentId : undefined;
			if (subagentId && known.has(subagentId)) ids.add(subagentId);
		}
	}
	return [...ids];
}

/**
 * The fetched steps of the subagents a turn launched, by subagent id — for
 * getReaderWaterfall to nest under their calls. Empty while `enabled` is off
 * and until the transcripts arrive.
 */
export function useReaderSubagentBranches(
	body: SessionReaderBody | null,
	enabled: boolean,
): ReadonlyMap<string, readonly AgentItem[]> {
	const context = useContext(ReaderSubagentsContext);
	const withTranscript = useMemo(
		() =>
			new Set(
				(context?.subagents ?? [])
					.filter((subagent) => subagent.hasTranscript)
					.map((subagent) => subagent.subagentId),
			),
		[context?.subagents],
	);
	const ids = useMemo(
		() => getLaunchedSubagentIds(body, withTranscript),
		[body, withTranscript],
	);
	const results = useQueries({
		queries: ids.map((subagentId) => {
			const input = {
				revision: context?.revision ?? "",
				sessionId: context?.sessionId ?? "",
				subagentId,
			};
			return {
				enabled: enabled && context !== null,
				gcTime: SESSION_DETAIL_BODY_CACHE_TIME_MS,
				queryFn: async ({ signal }: { signal: AbortSignal }) => {
					try {
						return await fetchSessionDetailSubagent(input, signal);
					} catch (error) {
						if (isSessionDetailStaleRevisionError(error)) {
							context?.onStaleRevision(error);
						}
						throw error;
					}
				},
				queryKey: sessionDetailSubagentQueryKey(input),
				retry: shouldRetrySessionDetailFastQuery,
				staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
			};
		}),
	});
	// Codex's spawned agents are sessions of their own: find each by its agent
	// path among the session's children, then load its turns.
	const spawnedPaths = useMemo(() => getSpawnedAgentPaths(body), [body]);
	const { state: organization } = useOrganization();
	const sessionId = context?.sessionId ?? "";
	const relationships = useQuery({
		enabled:
			enabled && spawnedPaths.length > 0 && Boolean(organization.activeOrg?.id),
		queryFn: () => client.analytics.sessions.detailRelationships({ sessionId }),
		// The timeline's key, so both read one cache.
		queryKey: [
			"org",
			organization.activeOrg?.id,
			"session-native-relationships",
			sessionId,
		],
	});
	const childSessions = useMemo(() => {
		const byPath = new Map(
			(relationships.data?.children ?? []).flatMap((child) =>
				child.agentPath ? [[child.agentPath, child.sessionId] as const] : [],
			),
		);
		return spawnedPaths.flatMap((path) => {
			const childSessionId = byPath.get(path);
			return childSessionId ? [{ path, sessionId: childSessionId }] : [];
		});
	}, [relationships.data, spawnedPaths]);
	const childResults = useQueries({
		queries: childSessions.map((child) => ({
			enabled,
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				fetchSessionDetailInitial(child.sessionId, signal),
			queryKey: sessionDetailInitialQueryKey(child.sessionId),
			retry: shouldRetrySessionDetailFastQuery,
			staleTime: SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
		})),
	});
	const childTurns = childResults.map(
		(result) => result.data?.initialDetail.window?.turns,
	);

	const contents = results.map((result) => result.data?.content);
	// Stable while the fetched contents don't change, so the waterfall built
	// from it keeps its identity across unrelated renders.
	const contentsKey = [
		...contents.map((content) => content?.length ?? -1),
		...childTurns.map((turns) => turns?.length ?? -1),
		childSessions.length,
	].join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: contentsKey stands in for the fetched arrays, which are new each render
	return useMemo(() => {
		const branches = new Map<string, readonly AgentItem[]>();
		ids.forEach((subagentId, index) => {
			const content = contents[index];
			if (!content) return;
			const items = buildConversationTrace(parseConversations(content));
			// The trace parser's items are the turn body's own shape (the
			// session-detail payload is built from it), less its strict JSON
			// typing of tool inputs.
			branches.set(
				subagentId,
				items.filter((item) => item.kind === "agent") as unknown as AgentItem[],
			);
		});
		childSessions.forEach((child, index) => {
			const turns = childTurns[index];
			if (turns) branches.set(child.path, getSessionAgentItems(turns));
		});
		return branches.size > 0 ? branches : NO_BRANCHES;
	}, [ids, childSessions, contentsKey]);
}
