import type { RepositorySummary } from "@rudel/api-routes";
import { useNavigate, useSearchParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { UsageCollectionView } from "@/components/usage-collection-view";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { formatCost } from "@/features/costs/cost-format";
import { SessionUsageDetail } from "@/features/sessions/components/session-usage-detail";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { SkillsPageView } from "@/features/skills/components/SkillsPageView";
import { orpc } from "@/lib/orpc";

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
		<UsageCollectionView
			kind="repos"
			items={query.data?.map((repo) => ({
				id: repo.identity.repoKey,
				name: repo.identity.repoLabel,
				emoji: "📂",
				sessionCount: repo.sessionCount,
				attribution: {
					userCount: repo.userCount,
					topUsers: repo.topUsers,
					repoCount: 0,
					topRepos: [],
				},
				extra: <RepoMetrics repo={repo} />,
			}))}
			isPending={query.isPending}
			isError={query.isError}
			onRetry={() => {
				void query.refetch();
			}}
			onSelectItem={(key) =>
				navigate(getShellRoutePath(appRoutes.repoDetail(key)))
			}
		/>
	);
}

export function RepoMetrics({ repo }: { repo: RepositorySummary }) {
	const signals = [
		{
			count: repo.signals.userPositive,
			label: "positive",
			title: "Positive user signals",
			color:
				"bg-[#dcfce7] text-[#15803d] dark:bg-[#153b25] dark:text-[#86efac]",
		},
		{
			count: repo.signals.userNegative,
			label: "negative",
			title: "Negative user signals",
			color:
				"bg-[#ffe4e6] text-[#be123c] dark:bg-[#411b25] dark:text-[#fda4af]",
		},
		{
			count: repo.signals.modelApologies,
			label: "apologies",
			title: "Model apologies",
			color:
				"bg-[#fef3c7] text-[#b45309] dark:bg-[#40321b] dark:text-[#fcd34d]",
		},
	];
	return (
		<div className="mt-2.5 grid gap-2 text-xs">
			<dl className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
				<div
					title={
						repo.estimatedCost === null
							? "Some sessions have unpriced usage"
							: "Estimated token cost (USD)"
					}
					className="flex items-baseline gap-1.5"
				>
					<dt className="text-(--session-overview-muted)">Cost</dt>
					<dd className="font-medium tabular-nums">
						{repo.estimatedCost === null
							? "Unavailable"
							: formatCost(repo.estimatedCost)}
					</dd>
				</div>
				<div
					title={`${repo.totalTokens.toLocaleString()} tokens`}
					className="flex items-baseline gap-1 text-(--session-overview-muted)"
				>
					<dd className="tabular-nums">
						{new Intl.NumberFormat("en-US", {
							notation: "compact",
							maximumFractionDigits: 1,
						}).format(repo.totalTokens)}
					</dd>
					<dt>tokens</dt>
				</div>
			</dl>
			<ul
				aria-label="Language signals"
				className="flex list-none flex-wrap gap-1.5"
			>
				{signals.map((signal) => (
					<li
						key={signal.label}
						title={signal.title}
						className={`rounded-sm px-1.5 py-0.5 text-[0.625rem] ${signal.color}`}
					>
						<span className="tabular-nums">
							{signal.count.toLocaleString()}
						</span>{" "}
						{signal.label}
					</li>
				))}
			</ul>
		</div>
	);
}

function RepoDetailPage({
	repoKey,
	repo,
	onBack,
}: {
	repoKey: string;
	repo: RepositorySummary | undefined;
	onBack: () => void;
}) {
	const query = useAnalyticsQuery(
		orpc.analytics.repositories.detail.queryOptions({ input: { repoKey } }),
	);
	const navigate = useNavigate();
	const getShellRoutePath = useShellRoutePath();
	return (
		<SessionUsageDetail
			name={repo?.identity.repoLabel ?? repoKey.replace(/^[^:]+:/u, "")}
			kind="Repo"
			sessionFilter={{ repoKey }}
			sessionCount={repo?.sessionCount}
			detailHref={(sessionId) => appRoutes.repoDetail(repoKey, sessionId)}
			onBack={onBack}
		>
			<SkillsPageView
				inline
				skills={query.data?.skills}
				isError={query.isError}
				isPending={query.isPending}
				onRetry={() => {
					void query.refetch();
				}}
				onSelectSkill={(name) =>
					navigate(getShellRoutePath(appRoutes.skillDetail(name)))
				}
			/>
		</SessionUsageDetail>
	);
}
