import {
	isLiveSessionDetailRevision,
	type SessionFileChanges,
	SessionFileChangesSchema,
} from "@rudel/api-routes";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import {
	BODY_PRIORITY,
	raiseBodyPriority,
} from "./components/body-request-scheduler";
import {
	readSessionDetailBodyChunks,
	SessionDetailBodyIntegrityError,
} from "./components/session-detail-body-chunks";
import { runSessionDetailRequest } from "./components/session-detail-response";
import { useReadsSessionData } from "./use-reads-session-data";

const FILE_CHANGES_STALE_TIME_MS = 5 * 60 * 1000;
const LIVE_FILE_CHANGES_STALE_TIME_MS = 30 * 1000;

export function fileChangesRevisionKey(revision: string): string {
	return isLiveSessionDetailRevision(revision) ? "live" : revision;
}

export async function fetchSessionFileChanges(
	input: { revision: string; sessionId: string },
	signal: AbortSignal,
): Promise<SessionFileChanges> {
	raiseBodyPriority(input.sessionId, BODY_PRIORITY.visible);
	const response = await readSessionDetailBodyChunks(
		{
			kind: "fileChanges",
			revision: input.revision,
			sessionId: input.sessionId,
			targetId: input.sessionId,
		},
		signal,
		{
			request: (chunk, chunkSignal) =>
				runSessionDetailRequest(
					(requestSignal) =>
						orpc.analytics.sessions.detailBodyChunk.call(chunk, {
							signal: requestSignal,
						}),
					chunkSignal,
				),
		},
	);
	const parsed = SessionFileChangesSchema.safeParse(response);
	if (!parsed.success) throw new SessionDetailBodyIntegrityError();
	return parsed.data;
}

export function sessionFileChangesQuery(
	organizationId: string | undefined,
	sessionId: string,
	revision: string,
) {
	return queryOptions<SessionFileChanges>({
		queryFn: ({ signal }) =>
			fetchSessionFileChanges({ revision, sessionId }, signal),
		queryKey: [
			"org",
			organizationId,
			"session-file-changes",
			sessionId,
			fileChangesRevisionKey(revision),
		],
		retry: false,
		staleTime: isLiveSessionDetailRevision(revision)
			? LIVE_FILE_CHANGES_STALE_TIME_MS
			: FILE_CHANGES_STALE_TIME_MS,
	});
}

export function useSessionFileChanges(
	sessionId: string,
	revision: string,
	read = true,
) {
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const live = isLiveSessionDetailRevision(revision);
	return useQuery({
		...sessionFileChangesQuery(organizationId, sessionId, revision),
		enabled: read && reads && !!organizationId && sessionId.length > 0,
		refetchInterval: live ? LIVE_FILE_CHANGES_STALE_TIME_MS : false,
	});
}
