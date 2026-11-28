import type { RepositorySettings } from "@rudel/api-routes";
import { useState } from "react";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { orpc } from "@/lib/orpc";
import {
	getUploadStatus,
	SessionsSettingsView,
} from "./sessions-settings-view";

export function SessionsSettingsPage() {
	const [search, setSearch] = useState("");
	const query = useAnalyticsQuery(
		orpc.repositorySettings.list.queryOptions({
			staleTime: 10_000,
			refetchInterval: 10_000,
			refetchOnWindowFocus: "always",
		}),
	);
	const repositories = [...(query.data?.repositories ?? [])].sort(
		(a, b) =>
			getUploadStatusOrder(a.reports) - getUploadStatusOrder(b.reports) ||
			b.sessionCount - a.sessionCount ||
			a.name.localeCompare(b.name),
	);
	const visible = repositories.filter((repo) =>
		repo.name.toLowerCase().includes(search.trim().toLowerCase()),
	);
	return (
		<SessionsSettingsView
			fetching={query.isFetching}
			onRefresh={() => void query.refetch()}
			onSearch={setSearch}
			pending={query.isPending}
			error={query.isError}
			repositories={query.data ? repositories : undefined}
			search={search}
			visible={visible}
		/>
	);
}

function getUploadStatusOrder(
	reports: RepositorySettings["repositories"][number]["reports"],
) {
	const state = getUploadStatus(reports);
	if (state === "enabled") return 0;
	if (state === "unknown") return 2;
	return 1;
}
