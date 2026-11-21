import type { AnalysisHistorySearchOutput } from "@rudel/api-routes";
import { Link, useParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { CardContent } from "@/app/ui/card";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { dataWindow, formatDay } from "@/features/reports/report-dates";
import { SettingsPageReveal } from "@/features/settings/components/settings-page-skeleton";
import { SettingsSectionCard } from "@/features/settings/components/settings-section";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import {
	REPORTS_SETTINGS_DESCRIPTION,
	REPORTS_SETTINGS_EMPTY,
	REPORTS_SETTINGS_LIMIT,
} from "./reports-settings-copy";
import "./reports-settings.css";

type SavedAnalysis = AnalysisHistorySearchOutput["analyses"][number];

export function ReportsSettingsPage() {
	const params = useParams();
	const { state } = useOrganization();
	const workspaceSlug = params.workspaceSlug ?? state.activeOrg?.slug ?? "";
	const { userMap } = useUserMap();
	const query = useAnalyticsQuery(
		orpc.analysis.history.search.queryOptions({
			input: { limit: REPORTS_SETTINGS_LIMIT },
		}),
	);
	const listed = query.data?.analyses ?? [];
	const reports = listed
		.filter((analysis) => analysis.status === "finished")
		.sort(
			(left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
		);

	if (!query.isPending && query.isError) {
		return (
			<div className="settings-page">
				<SettingsSectionCard>
					<CardContent className="text-body-xl text-ink-3">
						Reports couldn&apos;t be loaded right now.
					</CardContent>
				</SettingsSectionCard>
			</div>
		);
	}

	return (
		<SettingsPageReveal routeId="reports" loading={query.isPending}>
			{() => (
				<div className="settings-page">
					<WorkspaceSettingsGroup
						title="Reports"
						description={
							listed.length >= REPORTS_SETTINGS_LIMIT
								? `${REPORTS_SETTINGS_DESCRIPTION} Showing the latest ${REPORTS_SETTINGS_LIMIT}.`
								: REPORTS_SETTINGS_DESCRIPTION
						}
					>
						{reports.length ? (
							<ul
								className="settings-list reports-settings-list"
								aria-label="Saved reports"
							>
								{reports.map((report) => (
									<li key={report.id}>
										<ReportRow
											report={report}
											href={appRoutes.workspaceReport(workspaceSlug, report.id)}
											authorName={
												report.mine ? "you" : (userMap[report.authorId] ?? null)
											}
										/>
									</li>
								))}
							</ul>
						) : (
							<p className="settings-empty">{REPORTS_SETTINGS_EMPTY}</p>
						)}
					</WorkspaceSettingsGroup>
				</div>
			)}
		</SettingsPageReveal>
	);
}

function ReportRow({
	report,
	href,
	authorName,
}: {
	report: SavedAnalysis;
	href: string;
	authorName: string | null;
}) {
	return (
		<Link to={href} className="reports-settings-link">
			<WorkspaceSettingsRow
				label={
					<span className="reports-settings-title">{report.question}</span>
				}
				description={`Saved ${formatDay(report.createdAt)}${authorName ? ` by ${authorName}` : ""} · ${dataWindow(report)}`}
			>
				{report.shared ? (
					<span className="settings-badge">Shared with workspace</span>
				) : (
					<span className="settings-status">Not shared</span>
				)}
			</WorkspaceSettingsRow>
		</Link>
	);
}
