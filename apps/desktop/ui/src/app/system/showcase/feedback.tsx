import {
	IconAlertTriangle,
	IconBook,
	IconGitPullRequest,
	IconZoomCancel,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Reveal } from "@/app/ui/bones";
import { EmptyState, PageEmptyState } from "@/components/dashboard/page-parts";
import { CodeSkeleton } from "@/components/pierre/code-skeleton";
import { RetryButton } from "@/components/retry-button";
import { BreakdownEmpty } from "@/features/costs/breakdown-empty";
import { ChartEmptyNotice } from "@/features/costs/chart-empty-notice";
import { ChartSkeleton } from "@/features/costs/cost-chart";
import { ServiceStatusBanner } from "@/features/service-status/ServiceStatusBanner";
import { SessionChartLoading } from "@/features/sessions/components/session-detail-loading";
import { SessionsOverviewEmpty } from "@/features/sessions/components/sessions-overview-empty";
import { SessionsOverviewSample } from "@/features/sessions/components/sessions-overview-skeleton";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import { ProductLoadingIndicator } from "@/features/shell/product-loading-screen";
import "@/features/costs/cost-dashboard.css";
import { Group, Specimen, State } from "./kit";

const noop = () => {};

/** A box the size the specimen has on its screen. */
function Box({
	children,
	className,
}: {
	children: ReactNode;
	className: string;
}) {
	return (
		<div className={`relative flex min-w-0 flex-col ${className}`}>
			{children}
		</div>
	);
}

/** The banner the shell shows while the analytics database is down: its
 *  own query answers "analytics-unavailable", as the status endpoint does. */
function OutageBanner() {
	const client = useQueryClient();
	useState(() =>
		client.setQueryData(["service-status"], "analytics-unavailable", {
			updatedAt: Date.now(),
		}),
	);
	return <ServiceStatusBanner />;
}

export function FeedbackGroup() {
	return (
		<Group title="Feedback">
			<Specimen
				name="EmptyState (Empty, EmptyMedia on the opal shape)"
				source="components/dashboard/page-parts.tsx · app/ui/empty.tsx"
				where="The reader's tabs (files, setup, CI), repo tabs, the dashboard, the sessions list: a dashed box with an icon, a title, a line and sometimes an action."
			>
				<State label="title + description (reader Files, failed)">
					<Box className="h-64 w-[26rem]">
						<EmptyState
							icon={IconAlertTriangle}
							title="The files could not be read"
							description="Reading this session's file changes failed. Try the tab again in a moment."
						/>
					</Box>
				</State>
				<State label="title + description (reader CI & PRs, none)">
					<Box className="h-64 w-[26rem]">
						<EmptyState
							icon={IconGitPullRequest}
							title="No pull requests or CI"
							description="This session's runs named no pull request and reached no CI."
						/>
					</Box>
				</State>
			</Specimen>
			<Specimen
				name="SessionsOverviewEmpty"
				source="features/sessions/components/sessions-overview-empty.tsx"
				where="The sessions list when nothing matches: filters, an empty range, or a later page still loading."
			>
				<State label="no match, with Clear filters">
					<Box className="h-72 w-[26rem]">
						<SessionsOverviewEmpty
							noneInRange={false}
							searching={false}
							onClearFilters={noop}
						/>
					</Box>
				</State>
				<State label="searching later pages">
					<Box className="h-72 w-[26rem]">
						<SessionsOverviewEmpty
							noneInRange={false}
							searching
							onClearFilters={noop}
						/>
					</Box>
				</State>
				<State label="none in the range">
					<Box className="h-72 w-[26rem]">
						<SessionsOverviewEmpty
							noneInRange
							searching={false}
							onClearFilters={noop}
						/>
					</Box>
				</State>
			</Specimen>
			<Specimen
				name="PageEmptyState"
				source="components/dashboard/page-parts.tsx"
				where="A whole page's empty, error or no-match state: Repos, Skills, MCP, Compass, a report."
			>
				<State label="error, with RetryButton">
					<Box className="h-80 w-[30rem]">
						<PageEmptyState
							icon={IconBook}
							title="Repos couldn’t be loaded"
							description="Your historical sessions are still available. Try loading this view again."
							action={<RetryButton onRetry={noop} />}
						/>
					</Box>
				</State>
				<State label="empty">
					<Box className="h-80 w-[30rem]">
						<PageEmptyState
							icon={IconBook}
							title="No repos yet"
							description="Repositories will appear here when sessions are uploaded."
						/>
					</Box>
				</State>
				<State label="no match">
					<Box className="h-80 w-[30rem]">
						<PageEmptyState
							icon={IconZoomCancel}
							title="No matching repos"
							description="Try a different exact name or clear the search."
						/>
					</Box>
				</State>
			</Specimen>
			<Specimen
				name="BreakdownEmpty · ChartEmptyNotice"
				source="features/costs/breakdown-empty.tsx · features/costs/chart-empty-notice.tsx"
				where="Dashboard: a breakdown card with nothing to list; the chart card with nothing to draw (over its blurred sample)."
			>
				<State label="BreakdownEmpty">
					<Box className="w-[24rem]">
						<BreakdownEmpty title="No use" />
					</Box>
				</State>
				<State label="ChartEmptyNotice">
					<Box className="h-56 w-[30rem]">
						<ChartEmptyNotice title="No GitHub history for these dates" />
					</Box>
				</State>
			</Specimen>
			<Specimen
				name="Loading: ChartSkeleton (ChartLoadingWave) · SessionChartLoading"
				source="features/costs/cost-chart.tsx · features/sessions/components/session-detail-loading.tsx · app/ui/chart-loading-wave.tsx"
				where="The dashboard chart while its answer loads; the session strip on /newsesh while a session opens."
				className="flex-col"
			>
				<State label="ChartSkeleton (daily)" className="w-full">
					<Box className="h-72 w-full">
						<ChartSkeleton
							interval="daily"
							label="Loading cost"
							leaving={false}
						/>
					</Box>
				</State>
				<State label="SessionChartLoading" className="w-full">
					<Box className="w-full">
						<SessionChartLoading />
					</Box>
				</State>
			</Specimen>
			<Specimen
				name="Bones skeletons (Reveal, Bones)"
				source="app/ui/bones.tsx"
				where="Each screen's loading state is its own sample drawn as bones: the sessions list, a settings page, code."
				className="flex-col"
			>
				<State
					label="sessions list (Reveal loading, SessionsOverviewSample)"
					className="w-full"
				>
					<Box className="h-[24rem] w-full overflow-hidden">
						<Reveal
							fill
							className="flex-1"
							label="Loading sessions"
							loading
							sample={<SessionsOverviewSample />}
							sampleId="sessions"
						>
							{() => null}
						</Reveal>
					</Box>
				</State>
				<State label="SettingsPageSkeleton (members)" className="w-full">
					<div className="settings-page w-full max-w-[40rem] pb-zero">
						<SettingsPageSkeleton routeId="members" />
					</div>
				</State>
				<State label="CodeSkeleton" className="w-full">
					<Box className="w-[40rem]">
						<CodeSkeleton lines={8} />
					</Box>
				</State>
			</Specimen>
			<Specimen
				name="ProductLoadingIndicator"
				source="features/shell/product-loading-screen.tsx"
				where="The window while the workspace resolves, before the shell mounts."
			>
				<Box className="h-32 w-64">
					<ProductLoadingIndicator />
				</Box>
			</Specimen>
			<Specimen
				name="ServiceStatusBanner"
				source="features/service-status/ServiceStatusBanner.tsx"
				where="Above every screen's content while the analytics database is down."
				className="flex-col"
			>
				<div className="w-full overflow-hidden corner-s shadow-card">
					<OutageBanner />
				</div>
			</Specimen>
		</Group>
	);
}
