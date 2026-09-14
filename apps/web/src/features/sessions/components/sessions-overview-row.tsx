import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SessionAnalytics } from "@rudel/api-routes";
import { memo, useRef } from "react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { ConversationTraceTag } from "@/components/conversation/conversation-trace-tag";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import {
	getNewseshLanguageSignalMatches,
	type NewseshLanguageSignalMatch,
} from "@/features/sessions/components/newsesh-session-language-signal";
import { SessionMemberProfilePreview } from "@/features/sessions/components/session-member-profile-preview";
import type { SessionMemberProfileSummary } from "@/features/sessions/components/session-member-profile-summary";
import { SessionModelMark } from "@/features/sessions/components/session-model-mark";
import { resolveSessionErrorCount } from "@/features/sessions/components/session-overview-metrics";
import { SessionOverviewSubagentStack } from "@/features/sessions/components/session-overview-subagent-stack";
import {
	getRepositoryLabel,
	getSessionBranchLabel,
	getSessionOverviewCost,
	SESSION_OVERVIEW_GRID_CLASS_NAME,
} from "@/features/sessions/components/sessions-overview-table-utils";
import {
	type UseFluidHoverReturn,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import {
	formatApiCost,
	formatCompactWholeNumber,
	formatNumber,
	formatRoundedDuration,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_METADATA_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
	SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
	SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
	SessionLanguageSignalTag,
} from "./session-overview-row-elements";

type SessionsOverviewRowProps = {
	virtualTop?: number;
	position?: number;
	setSize?: number;
	index: number;
	registerItem: UseFluidHoverReturn["registerItem"];
	setHoverActiveIndex: UseFluidHoverReturn["setActiveIndex"];
	activeSessionId: string | null | undefined;
	avatarUrl: string | undefined;
	canOpenSession: ((session: SessionAnalytics) => boolean) | undefined;
	getSessionHref: ((session: SessionAnalytics) => string) | undefined;
	getSessionLinkState: ((session: SessionAnalytics) => unknown) | undefined;
	maximumSessionCost: number;
	memberProfile: SessionMemberProfileSummary | undefined;
	onSessionClick: ((session: SessionAnalytics) => void) | undefined;
	session: SessionAnalytics;
	userLabel: string;
};

const MAX_SESSION_OVERVIEW_SKILL_TAGS = 7;
const SESSION_OVERVIEW_TOOLTIP_CLASS_NAME =
	"whitespace-nowrap rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs/4 font-medium text-[#202124] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.1)] tabular-nums dark:border-white/10 dark:bg-[#202124] dark:text-[#f3f4f6]";
// CSS selects both tags and the matching count, including before demo hydration.
// Column widths grow continuously; only the number of skill tags changes in tiers.
const SESSION_OVERVIEW_SKILL_OVERFLOW_TIERS = [
	{ limit: 3, className: "@min-[1800px]/sessions-overview:hidden" },
	{
		limit: 5,
		className:
			"hidden @min-[1800px]/sessions-overview:inline @min-[2200px]/sessions-overview:hidden",
	},
	{ limit: 7, className: "hidden @min-[2200px]/sessions-overview:inline" },
];

function SessionOverviewLanguageSignals({
	session,
	speaker,
}: {
	session: SessionAnalytics;
	speaker: NewseshLanguageSignalMatch["speaker"];
}) {
	const signals = getNewseshLanguageSignalMatches(session, speaker);
	if (signals.length === 0) {
		return null;
	}

	const signalSummary = signals.map((signal) => signal.matchedText).join(", ");

	return (
		<div
			className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden"
			data-language-signal-speaker={speaker}
			title={`${speaker === "member" ? "Member" : "Model"} language signals: ${signalSummary}`}
		>
			{(["positive", "apology", "swear"] as const).map((category) => {
				const [signal, ...hidden] = signals.filter(
					(signal) => signal.category === category,
				);
				if (!signal) {
					return null;
				}
				return (
					<SessionLanguageSignalTag
						key={category}
						category={category}
						text={signal.matchedText}
						title={`${speaker === "member" ? "Member" : "Model"}: ${signal.matchedText}`}
						remainingCount={hidden.length}
						remainingTitle={hidden
							.map(
								(signal) =>
									`${speaker === "member" ? "Member" : "Model"}: ${signal.matchedText}`,
							)
							.join(" · ")}
					/>
				);
			})}
		</div>
	);
}

function getSessionClockParts(dateString: string, utc: boolean) {
	const normalizedDate = dateString.endsWith("Z")
		? dateString
		: `${dateString}Z`;
	const date = new Date(normalizedDate);

	if (Number.isNaN(date.getTime())) {
		return { date: "", hour: "—", minute: "", period: "" };
	}

	return {
		date: date.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			...(utc ? { timeZone: "UTC" } : {}),
		}),
		hour: ((utc ? date.getUTCHours() : date.getHours()) % 12 || 12)
			.toString()
			.padStart(2, "0"),
		minute: (utc ? date.getUTCMinutes() : date.getMinutes())
			.toString()
			.padStart(2, "0"),
		period: (utc ? date.getUTCHours() : date.getHours()) >= 12 ? "PM" : "AM",
	};
}

export const SessionsOverviewRow = memo(function SessionsOverviewRow({
	index,
	position,
	setSize,
	virtualTop,
	registerItem,
	setHoverActiveIndex,
	activeSessionId,
	avatarUrl,
	canOpenSession,
	getSessionHref,
	getSessionLinkState,
	maximumSessionCost,
	memberProfile,
	onSessionClick,
	session,
	userLabel,
}: SessionsOverviewRowProps) {
	const demo = useDemoRuntime();
	const itemRef = useRef<HTMLLIElement>(null);
	useRegisterFluidHoverItem(registerItem, index, itemRef);
	const sessionHref = getSessionHref?.(session);
	const repositoryLabel = getRepositoryLabel(session);
	const branchLabel = getSessionBranchLabel(session);
	const sessionCost = getSessionOverviewCost(session);
	const errorCount = resolveSessionErrorCount(session.error_count);
	const skillsTitle = session.skills.join(", ");
	const renderedSkills = session.skills.slice(
		0,
		MAX_SESSION_OVERVIEW_SKILL_TAGS,
	);
	const isClickable =
		(onSessionClick !== undefined || sessionHref !== undefined) &&
		(canOpenSession?.(session) ?? true);
	const isActive = activeSessionId === session.session_id;
	const clock = getSessionClockParts(session.session_date, demo !== null);
	const clockTimeLabel = `${clock.hour}${clock.minute ? `:${clock.minute}` : ""}${clock.period ? ` ${clock.period}` : ""}`;
	const clockDateTimeLabel = clock.date
		? `${clock.date}, ${clockTimeLabel}`
		: clockTimeLabel;
	const durationLabel = formatRoundedDuration(session.duration_min);
	const dateTooltipLabel = `${clockDateTimeLabel} · ${durationLabel}`;
	const tokenTooltipLabel = `Input: ${formatCompactWholeNumber(session.input_tokens)} / Output: ${formatCompactWholeNumber(session.output_tokens)}`;
	const costEstimateLabel =
		sessionCost !== null && session.cost_uses_default_region
			? "Estimated at standard region rates; billing region wasn’t recorded."
			: null;
	const rowClassName = cn(
		SESSION_OVERVIEW_ROW_CLASS_NAME,
		SESSION_OVERVIEW_GRID_CLASS_NAME,
		isClickable ? "cursor-pointer" : "cursor-default opacity-65",
	);
	const cellClassName = cn(
		SESSION_OVERVIEW_CELL_CLASS_NAME,
		isActive && "bg-(--session-overview-hover)",
	);
	const rowContents = (
		<>
			<div
				className={cn(cellClassName, "justify-start")}
				data-session-overview-column="cost"
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<span
							className={cn(
								SESSION_OVERVIEW_METADATA_CLASS_NAME,
								"inline-flex shrink-0 items-center gap-1",
							)}
							data-session-overview-metric-value="cost"
							data-session-overview-token-tooltip-label={tokenTooltipLabel}
						>
							{sessionCost === null ? "—" : formatApiCost(sessionCost)}
							{costEstimateLabel ? (
								<span className="sr-only">{costEstimateLabel}</span>
							) : null}
							{sessionCost === null ? (
								<span className="sr-only">API cost unavailable</span>
							) : null}
						</span>
					</TooltipTrigger>
					<TooltipContent
						align="center"
						className={SESSION_OVERVIEW_TOOLTIP_CLASS_NAME}
						data-session-overview-token-tooltip
						hideArrow
						side="right"
						sideOffset={8}
					>
						{costEstimateLabel ? <p>{costEstimateLabel}</p> : null}
						{tokenTooltipLabel}
					</TooltipContent>
				</Tooltip>
			</div>
			<div
				className={cn(cellClassName, "gap-2 px-2")}
				data-session-overview-column="model"
			>
				<SessionModelMark
					avatarUrl={avatarUrl}
					showMember={false}
					model={session.model_used}
					progress={
						sessionCost === null
							? undefined
							: {
									label: `${formatApiCost(sessionCost)} API cost relative to the most expensive session`,
									maximumValue: maximumSessionCost,
									value: sessionCost,
								}
					}
					userLabel={userLabel}
				/>
				<div
					className="flex min-w-0 items-center gap-1.5"
					data-session-overview-model-repository
				>
					<p
						className="min-w-0 max-w-28 truncate text-base/5 font-[450] tracking-normal text-(--session-overview-text) sm:text-[0.8125rem]/5"
						title={session.model_used}
						data-session-overview-model-label
					>
						{formatModelDisplayLabel(session.model_used)}
					</p>
					<p
						className="min-w-0 truncate text-left font-sans text-xs/4 font-normal tracking-normal text-[#0000009b] dark:text-[#ffffffaf]"
						data-session-overview-repository-label
						title={repositoryLabel}
					>
						{repositoryLabel}
					</p>
					{branchLabel ? (
						<p
							className="min-w-0 truncate text-left font-sans text-xs/4 font-normal tracking-normal text-[#00000044] tabular-nums dark:text-[#ffffff55]"
							data-session-overview-branch-label
							dir="rtl"
							title={branchLabel}
						>
							<bdi dir="ltr">{branchLabel}</bdi>
						</p>
					) : null}
				</div>
				<SessionOverviewSubagentStack session={session} />
				<SessionOverviewLanguageSignals session={session} speaker="model" />
				{errorCount !== 0 ? (
					<span
						className={cn(
							SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
							SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
							"shrink-0",
						)}
						data-session-overview-error-tag
						title={
							errorCount === null
								? "Error count unavailable"
								: `${formatNumber(errorCount)} detected tool/API ${errorCount === 1 ? "error" : "errors"}`
						}
					>
						<HugeiconsIcon
							aria-hidden="true"
							className="size-3 shrink-0"
							icon={AlertCircleIcon}
							strokeWidth={1.5}
						/>
						<span>{errorCount === null ? "—" : formatNumber(errorCount)}</span>
					</span>
				) : null}
			</div>
			<div
				className={cn(cellClassName, "justify-start")}
				data-session-overview-column="skills"
			>
				{renderedSkills.length === 0 ? null : (
					<div
						className="flex min-w-0 max-w-full items-center gap-1"
						title={skillsTitle}
					>
						{renderedSkills.map((skill, skillIndex) => (
							<ConversationTraceTag
								key={skill}
								className={cn(
									"min-w-0 max-w-full shrink",
									skillIndex >= 5
										? "hidden @min-[2200px]/sessions-overview:inline-flex"
										: skillIndex >= 3
											? "hidden @min-[1800px]/sessions-overview:inline-flex"
											: undefined,
								)}
								data-session-overview-skill-tag
								toolIcon="sparkle"
								value={skill}
							>
								<span
									className="truncate font-sans"
									data-session-overview-skill-name
								>
									{skill}
								</span>
							</ConversationTraceTag>
						))}
						{SESSION_OVERVIEW_SKILL_OVERFLOW_TIERS.map(
							({ limit, className }) =>
								session.skills.length > limit ? (
									<span
										key={limit}
										className={cn(
											"shrink-0 whitespace-nowrap text-[0.625rem] font-normal text-(--session-overview-subtle)",
											className,
										)}
										data-session-overview-skill-overflow-tag
										title={session.skills.slice(limit).join(", ")}
									>
										+{session.skills.length - limit}
									</span>
								) : null,
						)}
					</div>
				)}
			</div>
			<div
				className={cn(cellClassName, "justify-end gap-2")}
				data-session-overview-column="user"
			>
				<SessionOverviewLanguageSignals session={session} speaker="member" />
				<SessionMemberProfilePreview
					avatarUrl={avatarUrl}
					profile={
						memberProfile ?? {
							activity: [1],
							favoriteModel: session.model_used,
						}
					}
					userLabel={userLabel}
				/>
			</div>
			<div
				className={cn(cellClassName, "justify-end px-2")}
				data-session-overview-column="time"
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<time
							dateTime={session.session_date}
							className={SESSION_OVERVIEW_METADATA_CLASS_NAME}
							data-session-overview-date-tooltip-label={dateTooltipLabel}
						>
							{clock.date}
						</time>
					</TooltipTrigger>
					<TooltipContent
						align="center"
						className={SESSION_OVERVIEW_TOOLTIP_CLASS_NAME}
						data-session-overview-date-tooltip
						hideArrow
						side="left"
						sideOffset={8}
					>
						{dateTooltipLabel}
					</TooltipContent>
				</Tooltip>
			</div>
		</>
	);
	return (
		<li
			aria-posinset={position === undefined ? undefined : position + 1}
			aria-setsize={setSize}
			data-session-key={`${session.source}:${session.session_id}`}
			style={
				virtualTop === undefined
					? undefined
					: {
							position: "absolute",
							top: virtualTop,
							left: 0,
							width: "100%",
							height: 36,
						}
			}
			ref={itemRef}
			className="relative z-10"
			data-session-disabled={!isClickable ? "true" : undefined}
			onFocus={() => {
				if (isClickable) setHoverActiveIndex(index);
			}}
		>
			{isClickable && sessionHref ? (
				<Link
					aria-current={isActive ? "page" : undefined}
					className={rowClassName}
					data-dashboard-grid-row-scope="session"
					data-selected={isActive ? "true" : undefined}
					onClick={() => onSessionClick?.(session)}
					state={getSessionLinkState?.(session)}
					to={sessionHref}
					viewTransition
				>
					{rowContents}
				</Link>
			) : isClickable && onSessionClick ? (
				<button
					type="button"
					aria-pressed={isActive}
					className={rowClassName}
					data-dashboard-grid-row-scope="session"
					data-selected={isActive ? "true" : undefined}
					onClick={() => onSessionClick(session)}
				>
					{rowContents}
				</button>
			) : (
				<div className={rowClassName} data-dashboard-grid-row-scope="session">
					{rowContents}
				</div>
			)}
		</li>
	);
});
