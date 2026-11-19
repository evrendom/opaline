import { appRoutes } from "@/app/routes";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { SessionUsageDetail } from "@/features/sessions/components/session-usage-detail";
import { HistoricalSkillDetailContent } from "@/features/skills/components/historical-skill-detail-content";
import { orpc } from "@/lib/orpc";

export function SkillDetailPage({
	name,
	previewContent,
	onBack,
}: {
	name: string;
	previewContent: string | null;
	onBack: () => void;
}) {
	const detailQuery = useAnalyticsQuery(
		orpc.analytics.skills.detail.queryOptions({ input: { name } }),
	);
	return (
		<SessionUsageDetail
			key={name}
			name={name}
			kind="Skill"
			sessionFilter={{ skillName: name }}
			sessionCount={detailQuery.data?.sessionCount}
			detailHref={(sessionId) => appRoutes.skillDetail(name, sessionId)}
			onBack={onBack}
		>
			<HistoricalSkillDetailContent
				key={name}
				detail={detailQuery.data}
				isError={detailQuery.isError}
				isPending={detailQuery.isPending}
				previewContent={previewContent}
				onRetry={() => {
					void detailQuery.refetch();
				}}
			/>
		</SessionUsageDetail>
	);
}
