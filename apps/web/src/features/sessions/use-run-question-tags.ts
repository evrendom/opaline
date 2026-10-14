import {
	SESSION_RUN_QUESTION_TAGS_MAX_SESSIONS,
	type SessionRunAnswers,
	type SessionRunQuestionTag,
} from "@rudel/api-routes";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

// Run question answers for the dashboard. Only a workspace whose runs are
// answered gets any (the API answers `enabled: false` elsewhere, without
// reading), so the reads are cheap where there is nothing to show. The
// plugin app reaches only the procedures it serves as tools, and the product
// demo has no answers: both leave the tags out, as does a view outside a
// workspace. A failure reads as no tags: they never hold up the sessions
// list or the reader.

/** Answers go stale slowly: a run is answered once, minutes after its upload. */
const RUN_QUESTION_STALE_TIME_MS = 5 * 60 * 1000;

function useRunQuestionsAvailable(): boolean {
	const demo = useDemoRuntime();
	return import.meta.env.MODE !== "plugin" && demo === null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let start = 0; start < items.length; start += size)
		chunks.push(items.slice(start, start + size));
	return chunks;
}

/**
 * The questions answered yes about each listed session, by session id. The
 * sessions are read in the order given, a page of ids per request, so pages
 * added at the end leave the earlier requests' keys as they were.
 */
export function useSessionRunQuestionTags(
	sessionIds: readonly string[],
): ReadonlyMap<string, readonly SessionRunQuestionTag[]> {
	const available = useRunQuestionsAvailable();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const pages = useMemo(
		() =>
			chunk([...new Set(sessionIds)], SESSION_RUN_QUESTION_TAGS_MAX_SESSIONS),
		[sessionIds],
	);
	return useQueries({
		queries: pages.map((page) => {
			const options = orpc.analytics.sessions.runQuestionTags.queryOptions({
				input: { sessionIds: page },
			});
			return {
				...options,
				queryKey: ["org", organizationId, ...options.queryKey],
				enabled: available && !!organizationId,
				retry: false,
				staleTime: RUN_QUESTION_STALE_TIME_MS,
			};
		}),
		combine: (results) => {
			const tags = new Map<string, readonly SessionRunQuestionTag[]>();
			for (const result of results)
				for (const session of result.data?.sessions ?? [])
					tags.set(session.sessionId, session.questions);
			return tags;
		},
	});
}

/** Every answer per run of one session, for the reader; undefined until read or when none. */
export function useSessionRunAnswers(
	sessionId: string,
): SessionRunAnswers | undefined {
	const available = useRunQuestionsAvailable();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const options = orpc.analytics.sessions.runAnswers.queryOptions({
		input: { sessionId },
	});
	const query = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: available && !!organizationId && sessionId.length > 0,
		retry: false,
		staleTime: RUN_QUESTION_STALE_TIME_MS,
	});
	return query.data;
}
