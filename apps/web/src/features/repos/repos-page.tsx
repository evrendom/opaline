import { lazy } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { routeLoaders } from "@/app/route-loaders";
import { appRoutes } from "@/app/routes";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { orpc } from "@/lib/orpc";
import { ReposOverview } from "./repos-overview";

const RepoDetailPage = lazy(() =>
	routeLoaders.repoDetail().then((module) => ({
		default: module.RepoDetailPage,
	})),
);

export function ReposPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const getShellRoutePath = useShellRoutePath();
	const query = useAnalyticsQuery(
		orpc.analytics.repositories.list.queryOptions({}),
	);
	const repoKey = searchParams.get("repo");
	const selected = query.data?.find(
		(repo) => repo.identity.repoKey === repoKey,
	);
	if (repoKey)
		return (
			<RepoDetailPage
				key={repoKey}
				repoKey={repoKey}
				repo={selected}
				onBack={() => navigate(getShellRoutePath(appRoutes.repos()))}
			/>
		);
	return (
		<ReposOverview
			repos={query.data}
			isPending={query.isPending}
			isError={query.isError}
			onRetry={() => {
				void query.refetch();
			}}
			getRepoHref={(key) => getShellRoutePath(appRoutes.repoDetail(key))}
		/>
	);
}
