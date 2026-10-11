import {
	type Icon,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronUp,
	IconClock,
	IconCoin,
	IconGauge,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Skeleton } from "@/app/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { DetailIdentityBreadcrumb } from "@/features/shell/components/detail-identity-breadcrumb";
import { formatRoundedDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getRepositoryLabel } from "./session-context-chips";
import type { buildSessionDetailViewModel } from "./session-detail-view-model";
import { SessionInteractionCounts } from "./session-interaction-counts";

type SessionDetailViewModel = ReturnType<typeof buildSessionDetailViewModel>;

type SessionDetailHeaderProps = {
	avatarMap: Record<string, string>;
	headerRef: (element: HTMLElement | null) => void;
	hideMetrics: boolean;
	isLoading: boolean;
	navigation: SessionNavigation | undefined;
	portalHost: HTMLElement | null;
	position: number | undefined;
	sessionId: string;
	/** The repo › branch › commit › session trail. Off on the full session
	 *  page, where the shell breadcrumb and context chips carry it. */
	showIdentity: boolean;
	totalSessions: number;
	viewModel: SessionDetailViewModel | undefined;
};

const sessionInfoTouchTargetClassName =
	"absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden";

// Record pill: round segments that tint on hover inside an
// outlined pill.
const sessionHeaderNavigationButtonClassName =
	"relative flex h-full items-center rounded-full p-2 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[1.5px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

const sessionMetricsGroupClassName =
	"flex w-fit min-w-0 max-w-full items-center divide-x divide-[color:var(--dashboardy-divider)] overflow-x-auto";

const sessionMetricItemClassName =
	"flex shrink-0 items-start gap-2 px-3 first:pl-0 last:pr-0";

const sessionIdentitySkeletonClassName = "flex shrink-0 items-start gap-2";

function SessionHeaderNavigationButton({
	className = sessionHeaderNavigationButtonClassName,
	disabled = false,
	icon,
	label,
	onClick,
}: {
	className?: string;
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			className={className}
			disabled={disabled}
			onClick={onClick}
		>
			{icon}
			<span aria-hidden="true" className={sessionInfoTouchTargetClassName} />
		</button>
	);
}

function SessionIdentityBreadcrumb({
	isLoading,
	sessionId,
	viewModel,
}: {
	isLoading: boolean;
	sessionId: string;
	viewModel: SessionDetailViewModel | undefined;
}) {
	if (isLoading && !viewModel) {
		return (
			<nav aria-label="Session breadcrumb" className="min-w-0 flex-1">
				<ol className="flex min-w-0 items-center gap-1 overflow-hidden">
					{["repo", "branch", "commit", "session"].map((item, index) => (
						<li key={item} className="flex shrink-0 items-center gap-1">
							<Skeleton className="h-4 w-20 rounded-sm bg-[color:var(--dashboardy-subsurface-strong)]" />
							{index < 3 ? (
								<IconChevronRight
									aria-hidden="true"
									className="size-4 shrink-0 text-black/6 dark:text-white/8"
								/>
							) : null}
						</li>
					))}
				</ol>
			</nav>
		);
	}

	const items = [
		{ label: "Repo", value: getRepositoryLabel(viewModel) },
		{ label: "Branch", value: viewModel?.safeGitBranch ?? "No branch" },
		{
			label: "Commit",
			mono: true,
			title: viewModel?.safeGitSha ?? "No commit",
			value: viewModel?.safeGitSha?.slice(0, 8) ?? "No commit",
		},
		{
			label: "Session",
			mono: true,
			title: viewModel?.safeSessionId ?? sessionId,
			value: viewModel?.safeSessionId ?? sessionId,
		},
	];

	return <DetailIdentityBreadcrumb label="Session breadcrumb" items={items} />;
}

function SessionRecordNavigation({
	navigation,
	position,
	totalSessions,
}: {
	navigation: SessionNavigation;
	position: number | undefined;
	totalSessions: number;
}) {
	const scope = navigation.scopeLabel ?? "All Sessions";
	const positionTitle =
		position === undefined || totalSessions === 0
			? `Session in ${scope}`
			: `${position} of ${totalSessions} in ${scope}`;
	const PreviousIcon = navigation.horizontal ? IconChevronLeft : IconChevronUp;
	const NextIcon = navigation.horizontal ? IconChevronRight : IconChevronDown;
	const positionLabel =
		position === undefined || totalSessions === 0
			? "— / —"
			: `${position} / ${totalSessions}`;

	return (
		<nav
			aria-label="Session navigation"
			className="flex h-8 min-w-0 shrink-0 items-center rounded-full bg-card text-sm shadow-(--custom-outline-shadow)"
		>
			<p
				aria-live="polite"
				className="min-w-0 truncate pr-1 pl-3 text-sm whitespace-nowrap text-muted-foreground tabular-nums"
				title={positionTitle}
			>
				{positionLabel}
			</p>
			<span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
			<SessionHeaderNavigationButton
				disabled={!navigation.hasPreviousSession}
				icon={<PreviousIcon aria-hidden="true" className="size-3.5" />}
				label="Previous session"
				onClick={navigation.onPreviousSession}
			/>
			<SessionHeaderNavigationButton
				disabled={!navigation.hasNextSession}
				icon={<NextIcon aria-hidden="true" className="size-3.5" />}
				label="Next session"
				onClick={navigation.onNextSession}
			/>
		</nav>
	);
}

function SessionMetric({
	icon: Icon,
	label,
	value,
	mono = false,
}: {
	icon: Icon;
	label: string;
	value: string | number;
	mono?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className={cn(sessionMetricItemClassName, "cursor-help")}>
					<Icon
						aria-hidden="true"
						className="size-4 h-lh shrink-0 text-[color:var(--dashboardy-heading)]"
					/>
					<div className="min-w-0 flex-1">
						<div
							className={cn(
								"whitespace-nowrap text-base font-semibold text-[color:var(--dashboardy-heading)] tabular-nums sm:text-[0.8125rem]",
								mono && "font-mono",
							)}
						>
							<span className="sr-only">{label}: </span>
							{value}
						</div>
					</div>
				</div>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function SessionMetricSkeleton({ valueClassName }: { valueClassName: string }) {
	return (
		<div className={sessionMetricItemClassName}>
			<Skeleton className="size-4 shrink-0 rounded-sm bg-[color:var(--dashboardy-subsurface-strong)]" />
			<div className="min-w-0 flex-1">
				<Skeleton
					className={cn(
						"h-4 rounded-sm bg-[color:var(--dashboardy-subsurface-strong)]",
						valueClassName,
					)}
				/>
			</div>
		</div>
	);
}

function formatRoundedTokenCount(value: number) {
	if (value < 1_000) {
		return Math.round(value).toLocaleString();
	}

	return `${Math.round(value / 1_000)}k`;
}

function SessionMetrics({
	avatarMap,
	viewModel,
}: {
	avatarMap: Record<string, string>;
	viewModel: SessionDetailViewModel;
}) {
	const {
		conversationSummary,
		costLabel,
		safeDurationMin,
		safeInputTokens,
		displayModel,
		safeOutputTokens,
		safeUserDisplayName,
		safeUserId,
	} = viewModel;
	const tokenUsageLabel = `${formatRoundedTokenCount(
		safeInputTokens,
	)} / ${formatRoundedTokenCount(safeOutputTokens)}`;

	return (
		<div className={sessionMetricsGroupClassName}>
			<SessionInteractionCounts
				className={cn(sessionMetricItemClassName, "gap-3")}
				model={displayModel}
				modelMessageCount={conversationSummary?.assistantMessages}
				userDisplayName={safeUserDisplayName}
				userImageUrl={avatarMap[safeUserId]}
				userMessageCount={conversationSummary?.userMessages}
			/>
			<SessionMetric
				icon={IconClock}
				label="Duration"
				value={formatRoundedDuration(safeDurationMin)}
			/>
			<SessionMetric
				icon={IconGauge}
				label="Tokens"
				value={tokenUsageLabel}
				mono
			/>
			<SessionMetric icon={IconCoin} label="Cost" value={costLabel} mono />
		</div>
	);
}

function SessionMetricsSkeleton() {
	return (
		<div className={sessionMetricsGroupClassName}>
			<div className={cn(sessionMetricItemClassName, "gap-3")}>
				<div className={sessionIdentitySkeletonClassName}>
					<Skeleton className="size-4 shrink-0 rounded-sm bg-[color:var(--dashboardy-subsurface-strong)]" />
					<Skeleton className="h-4 w-4 shrink-0 rounded-sm bg-[color:var(--dashboardy-subsurface-strong)]" />
				</div>
				<div className={sessionIdentitySkeletonClassName}>
					<Skeleton className="size-4 shrink-0 rounded-full bg-[color:var(--dashboardy-subsurface-strong)]" />
					<Skeleton className="h-4 w-4 shrink-0 rounded-sm bg-[color:var(--dashboardy-subsurface-strong)]" />
				</div>
			</div>
			<SessionMetricSkeleton valueClassName="w-14" />
			<SessionMetricSkeleton valueClassName="w-20" />
			<SessionMetricSkeleton valueClassName="w-16" />
		</div>
	);
}

export function SessionDetailHeader({
	avatarMap,
	headerRef,
	hideMetrics,
	isLoading,
	navigation,
	portalHost,
	position,
	sessionId,
	showIdentity,
	totalSessions,
	viewModel,
}: SessionDetailHeaderProps) {
	if (!portalHost) {
		return null;
	}

	return createPortal(
		<div
			ref={headerRef}
			className="dashboardy-page flex min-w-0 flex-1 items-center justify-end gap-6 font-sans"
		>
			{showIdentity ? (
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<SessionIdentityBreadcrumb
						isLoading={isLoading}
						sessionId={sessionId}
						viewModel={viewModel}
					/>
				</div>
			) : null}
			{hideMetrics ? null : (
				<div className="hidden min-w-0 justify-end overflow-hidden lg:flex">
					{isLoading ? <SessionMetricsSkeleton /> : null}
					{!isLoading && viewModel ? (
						<SessionMetrics avatarMap={avatarMap} viewModel={viewModel} />
					) : null}
				</div>
			)}
			{navigation ? (
				<SessionRecordNavigation
					navigation={navigation}
					position={position}
					totalSessions={totalSessions}
				/>
			) : null}
		</div>,
		portalHost,
	);
}
