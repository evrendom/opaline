import type { RepositorySetupText } from "@rudel/api-routes";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { orpc } from "@/lib/orpc";
import { keepWhileRangeChanges, useRepoRangeInput } from "./repo-page-data";

const SETUP_STALE_TIME_MS = 5 * 60 * 1000;

export function useRepoSetup(
	repoKey: string | undefined,
	{ allTime = false }: { allTime?: boolean } = {},
) {
	const selected = useRepoRangeInput();
	const range = allTime ? undefined : selected;
	return useAnalyticsQuery({
		...orpc.analytics.repositories.setup.queryOptions({
			input: { repoKey, range },
		}),
		staleTime: SETUP_STALE_TIME_MS,
		placeholderData: keepWhileRangeChanges({ repoKey }),
	});
}

export function useRepoSetupVersions(
	repoKey: string | undefined,
	setupFile: string,
	{ allTime = false }: { allTime?: boolean } = {},
) {
	const selected = useRepoRangeInput();
	const range = allTime ? undefined : selected;
	const query: UseQueryResult<RepositorySetupText> = useAnalyticsQuery({
		...orpc.analytics.repositories.setupText.queryOptions({
			input: { repoKey, setupFile, range },
		}),
		enabled: setupFile.length > 0,
		retry: false,
		staleTime: SETUP_STALE_TIME_MS,
	});
	const [picked, setPicked] = useState<{
		file: string;
		version: string;
	} | null>(null);
	const versions = query.data?.versions ?? [];
	const shown =
		versions.find(
			(version) =>
				picked?.file === setupFile && version.version === picked.version,
		) ?? versions.at(-1);
	const numbers = useMemo(
		() =>
			new Map(versions.map((version, index) => [version.version, index + 1])),
		[versions],
	);
	const pick = (version: string) => setPicked({ file: setupFile, version });
	const chosen =
		picked?.file === setupFile &&
		versions.some((version) => version.version === picked.version)
			? picked.version
			: null;
	return { chosen, numbers, pick, query, shown, versions };
}

export function useRepoSetupSessions(
	repoKey: string | undefined,
	setupFile: string,
	{ allTime = false }: { allTime?: boolean } = {},
) {
	const selected = useRepoRangeInput();
	const range = allTime ? undefined : selected;
	return useAnalyticsQuery({
		...orpc.analytics.repositories.setupSessions.queryOptions({
			input: { repoKey, setupFile, range },
		}),
		enabled: setupFile.length > 0,
		staleTime: SETUP_STALE_TIME_MS,
	});
}

export function useRepoMcpTools(
	repoKey: string | undefined,
	enabled: boolean,
	{ allTime = false }: { allTime?: boolean } = {},
) {
	const selected = useRepoRangeInput();
	const range = allTime ? undefined : selected;
	return useAnalyticsQuery({
		...orpc.analytics.repositories.mcpTools.queryOptions({
			input: { repoKey, range },
		}),
		enabled,
		staleTime: SETUP_STALE_TIME_MS,
	});
}
