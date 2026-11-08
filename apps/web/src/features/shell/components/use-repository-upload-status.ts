import { useCallback, useMemo } from "react";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import {
	useLiveClock,
	useLiveSessionList,
} from "@/features/sessions/use-live-sessions";
import { orpc } from "@/lib/orpc";
import type { RepoUploadStatus } from "./repo-nav-icon";
import {
	autoUploadRepositoryKeys,
	liveRepositoryKeys,
} from "./sidebar-repositories-model";

const LIVE_POLL_MS = 30_000;

export function useRepositoryUploadStatus() {
	const repositories = useAnalyticsQuery(
		orpc.analytics.repositories.list.queryOptions({}),
	);
	const demo = useDemoRuntime();
	const settings = useAnalyticsQuery({
		...orpc.repositorySettings.list.queryOptions({ staleTime: 5 * 60_000 }),
		enabled: demo === null,
	});
	const { sessions } = useLiveSessionList({ poll: LIVE_POLL_MS });
	const now = useLiveClock(LIVE_POLL_MS);
	const uploading = useMemo(
		() => autoUploadRepositoryKeys(settings.data),
		[settings.data],
	);
	const live = useMemo(
		() => liveRepositoryKeys(sessions, repositories.data ?? [], now),
		[sessions, repositories.data, now],
	);
	return useCallback(
		(repoKey: string): RepoUploadStatus =>
			live.has(repoKey) ? "live" : uploading.has(repoKey) ? "uploading" : null,
		[live, uploading],
	);
}
