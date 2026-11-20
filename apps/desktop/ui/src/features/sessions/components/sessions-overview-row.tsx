import type {
	SessionAnalytics,
	SessionRunQuestionTag,
} from "@rudel/api-routes";
import { IconAlertCircle } from "@tabler/icons-react";
import { memo, useRef } from "react";
import { Link } from "react-router-dom";
import {
	appRoutes,
	getWorkspaceAppPath,
	getWorkspaceSlugFromPath,
} from "@/app/routes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { ConversationSkillLink } from "@/components/conversation/conversation-skill-link";
import { ConversationTraceTag } from "@/components/conversation/conversation-trace-tag";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { SessionOverviewQuestionTags } from "@/features/sessions/components/run-question-tag";
import { SessionMemberProfilePreview } from "@/features/sessions/components/session-member-profile-preview";
import type { SessionMemberProfileSummary } from "@/features/sessions/components/session-member-profile-summary";
import { SessionModelMark } from "@/features/sessions/components/session-model-mark";
import { resolveSessionErrorCount } from "@/features/sessions/components/session-overview-metrics";
import { SessionOverviewSubagentCountTag } from "@/features/sessions/components/session-overview-subagent-tags";
import {
	getSessionBranchLabel,
	getSessionOverviewCost,
	SESSION_OVERVIEW_GRID_CLASS_NAME,
	SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME,
	SESSION_OVERVIEW_ROW_HEIGHT,
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
	cancelSessionDetailIntent,
	intendSessionDetail,
	startSessionDetail,
} from "../session-detail-prefetch";
import { markSessionOpenFromClick } from "../session-open-timing";
import {
	sessionRowKey,
	transcriptSubagentId,
	withTranscriptSubagent,
} from "../session-row-key";
import { getSessionModelDisplayValue } from "./session-model-identity";
import {
	describeLiveSessionRow,
	describeLiveSessionRowDate,
	SessionOverviewLiveLabel,
} from "./session-overview-live-row";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_ICON_TAG_CLASS_NAME,
	SESSION_OVERVIEW_METADATA_CLASS_NAME,
	SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
	SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
	SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
	SESSION_OVERVIEW_TAG_ICON_CLASS_NAME,
	SESSION_OVERVIEW_TAG_NUMBER_CLASS_NAME,
	SessionOverviewLanguageSignals,
} from "./session-overview-row-elements";
import { SessionOverviewToolTags } from "./session-overview-tool-tags";
import { SessionPlaceLabel } from "./session-place";
import { SessionPlanUsage } from "./session-plan-usage";
import { SubagentPebble } from "./session-subagent-pebble";

type SessionsOverviewRowProps = {
	showPlace?: boolean;
	showSkillsColumn?: boolean;
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
	/** The time a live row reads its activity against; set only on live rows. */
	liveNowMs?: number;
	maximumSessionCost: number;
	/** Share of the plan limit the session used, in percent; desktop only. */
	planUsage?: number;
	/** On a subagent row: the whole session's share, which includes this one. */
	planUsageOfSession?: number;
	/** A usage limit refused this session (or subagent) in the range. */
	planUsageLimited?: boolean;
	memberProfile: SessionMemberProfileSummary | undefined;
	onSessionClick: ((session: SessionAnalytics) => void) | undefined;
	session: SessionAnalytics;
	userLabel: string;
	/** Run questions answered yes about the session's runs; shown with the skills. */
	questionTags?: readonly SessionRunQuestionTag[];
	mcpServers?: readonly { server: string; at: number }[];
	/** Set on a row that folds a panel beneath it: clicking toggles it and
	 * the model mark shows the disclosure, instead of opening the session. */
	expanded?: boolean;
	/** Column widths in place of the overview's, for a narrower list. */
	gridClassName?: string;
	subagentTint?: string;
};

const MAX_SESSION_OVERVIEW_SKILL_TAGS = 7;
const SESSION_OVERVIEW_TOOLTIP_CLASS_NAME =
	"whitespace-nowrap corner-s edge-m border-line bg-canvas px-l py-s text-xs/4 font-medium text-ink shadow-[0_8px_20px_-10px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.1)] tabular-nums dark:border-line dark:bg-field dark:text-ink";
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
	showSkillsColumn = true,
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
	liveNowMs,
	maximumSessionCost,
	planUsage,
	planUsageOfSession,
	planUsageLimited = false,
	memberProfile,
	onSessionClick,
	session,
	userLabel,
	questionTags,
	mcpServers,
	expanded,
	gridClassName,
	showPlace,
	subagentTint,
}: SessionsOverviewRowProps) {
	const demo = useDemoRuntime();
	const localApp = useLocalDesktopApp();
	const itemRef = useRef<HTMLLIElement>(null);
	useRegisterFluidHoverItem(registerItem, index, itemRef);
	const sessionHref = withTranscriptSubagent(
		getSessionHref?.(session),
		session,
	);
	const transcriptSubagent = transcriptSubagentId(session);
	const branchLabel = getSessionBranchLabel(session);
	const sessionCost = getSessionOverviewCost(session);
	// A session running right now reads in the shape of every other row.
	const liveRow = describeLiveSessionRow(session, liveNowMs);
	const displayModel =
		liveRow?.sourceLabel ??
		getSessionModelDisplayValue({
			model: session.model_used,
			source: session.source,
			totalTokens: session.total_tokens,
			errorCount: session.error_count ?? 0,
		}) ??
		"";
	const errorCount = resolveSessionErrorCount(session.error_count);
	const skillsTitle = session.skills.join(", ");
	const renderedSkills = session.skills.slice(
		0,
		MAX_SESSION_OVERVIEW_SKILL_TAGS,
	);
	const isClickable =
		(onSessionClick !== undefined || sessionHref !== undefined) &&
		(canOpenSession?.(session) ?? true);
	const isActive =
		transcriptSubagent === null && activeSessionId === session.session_id;
	const failure = session.upload_failure;
	const clock = getSessionClockParts(
		failure ? (failure.sessionDate ?? "") : session.session_date,
		demo !== null,
	);
	const clockTimeLabel = `${clock.hour}${clock.minute ? `:${clock.minute}` : ""}${clock.period ? ` ${clock.period}` : ""}`;
	const clockDateTimeLabel = clock.date
		? `${clock.date}, ${clockTimeLabel}`
		: clockTimeLabel;
	const durationLabel = formatRoundedDuration(session.duration_min);
	const sessionDateTime =
		liveRow?.live.lastActivityAt ??
		(failure ? (failure.sessionDate ?? undefined) : session.session_date);
	const dateTooltipLabel = liveRow
		? describeLiveSessionRowDate(liveRow.live, clockDateTimeLabel, liveNowMs)
		: failure
			? failure.sessionDate
				? clockDateTimeLabel
				: `Session date unavailable · Upload failed ${new Date(failure.failedAt).toLocaleString()}`
			: `${clockDateTimeLabel} · ${durationLabel}`;
	const tokenTooltipLabel =
		liveRow?.tokenTooltipLabel ??
		(failure
			? "Usage unavailable because the upload failed"
			: `Input: ${formatCompactWholeNumber(session.input_tokens)} / Output: ${formatCompactWholeNumber(session.output_tokens)}`);
	const costEstimateLabel =
		sessionCost !== null && session.cost_uses_default_region
			? "Estimated at standard region rates; billing region wasn’t recorded."
			: null;
	const rowClassName = cn(
		SESSION_OVERVIEW_ROW_CLASS_NAME,
		gridClassName ??
			(showSkillsColumn
				? SESSION_OVERVIEW_GRID_CLASS_NAME
				: SESSION_OVERVIEW_GRID_WITHOUT_SKILLS_CLASS_NAME),
		!isClickable && "opacity-65",
		// An open row shares the tint of the panel folded out beneath it, and
		// rounds its top as the block's top edge.
		expanded &&
			"corner-t-m bg-field corner-squircle squircle:corner-t-xl dark:bg-card",
	);
	const cellClassName = cn(
		SESSION_OVERVIEW_CELL_CLASS_NAME,
		isActive && "bg-hover",
	);
	const getSkillHref = (name: string) => {
		const path = appRoutes.skillDetail(name, session.session_id);
		const workspaceSlug = sessionHref
			? getWorkspaceSlugFromPath(sessionHref)
			: null;
		return workspaceSlug ? getWorkspaceAppPath(workspaceSlug, path) : path;
	};
	const skillsCell = (
		<div
			className={cn(
				cellClassName,
				"col-start-3 row-start-1 justify-start gap-xs",
			)}
			data-session-overview-column="skills"
		>
			{questionTags && questionTags.length > 0 ? (
				<SessionOverviewQuestionTags tags={questionTags} />
			) : null}
			{renderedSkills.length === 0 ? null : (
				<div
					className="flex min-w-0 max-w-full items-center gap-xs"
					title={skillsTitle}
				>
					{renderedSkills.map((skill, skillIndex) => (
						<ConversationSkillLink
							key={skill}
							name={skill}
							href={
								isClickable && sessionHref ? getSkillHref(skill) : undefined
							}
							className={cn(
								"pointer-events-auto min-w-0 max-w-full shrink",
								skillIndex >= 5
									? "hidden @min-[2200px]/sessions-overview:inline-flex"
									: skillIndex >= 3
										? "hidden @min-[1800px]/sessions-overview:inline-flex"
										: undefined,
							)}
						>
							<ConversationTraceTag
								className="min-w-0 max-w-full shrink"
								data-session-overview-skill-tag
								toolIcon="sparkle"
								value={skill}
							>
								<span
									className="truncate font-body"
									data-session-overview-skill-name
								>
									{skill}
								</span>
							</ConversationTraceTag>
						</ConversationSkillLink>
					))}
					{SESSION_OVERVIEW_SKILL_OVERFLOW_TIERS.map(({ limit, className }) =>
						session.skills.length > limit ? (
							<span
								key={limit}
								className={cn(
									"shrink-0 whitespace-nowrap text-body-xs font-regular text-ink-3",
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
	);
	const modelMark = (
		<SessionModelMark
			avatarUrl={avatarUrl}
			loading={liveRow?.state === "running"}
			showMember={false}
			model={displayModel}
			disclosure={expanded === undefined ? undefined : { open: expanded }}
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
	);
	const rowContents = (
		<>
			<div
				className={cn(cellClassName, "justify-start")}
				data-session-overview-column="cost"
			>
				<span
					className={cn(
						SESSION_OVERVIEW_METADATA_CLASS_NAME,
						"inline-flex shrink-0 items-center gap-xs",
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
					<SessionPlanUsage
						points={planUsage}
						ofSession={planUsageOfSession}
						limited={planUsageLimited}
					/>
				</span>
			</div>
			<div
				className={cn(cellClassName, "gap-m px-m")}
				data-session-overview-column="model"
			>
				{session.subagent_of ? (
					<span className="flex shrink-0 items-center">
						{modelMark}
						<span className="relative -ml-xl" title="Subagent">
							<SubagentPebble tint={subagentTint} />
						</span>
					</span>
				) : (
					modelMark
				)}
				<div
					className="flex min-w-0 items-center gap-s"
					data-session-overview-model-repository
				>
					{liveRow ? <SessionOverviewLiveLabel state={liveRow.state} /> : null}
					<p
						className={cn(
							"min-w-0 truncate",
							failure || displayModel === "Claude (failed start)"
								? "max-w-40"
								: session.subagent_of
									? "max-w-44"
									: "max-w-28",
							SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
						)}
						title={failure ? `${displayModel} (Upload failed)` : displayModel}
						data-session-overview-model-label
					>
						{session.subagent_of ? (
							<span className="text-ink-3">Subagent </span>
						) : null}
						{formatModelDisplayLabel(displayModel)}
						{failure ? (
							<span title={failure.error} data-session-upload-failed>
								{" "}
								(Upload failed)
							</span>
						) : null}
					</p>
					<SessionPlaceLabel session={session} showPlace={showPlace} />
					{branchLabel ? (
						<p
							className="min-w-0 truncate text-left font-body text-xs/4 font-regular tracking-m text-ink-3 tabular-nums"
							data-session-overview-branch-label
							dir="rtl"
							title={branchLabel}
						>
							<bdi dir="ltr">{branchLabel}</bdi>
						</p>
					) : null}
				</div>
				<SessionOverviewSubagentCountTag session={session} />
				<SessionOverviewToolTags
					skills={showSkillsColumn ? [] : session.skills}
					mcpServers={mcpServers}
					sessionHref={isClickable ? sessionHref : undefined}
				/>
				<SessionOverviewLanguageSignals session={session} speaker="model" />
				{!failure &&
				errorCount !== 0 &&
				!(errorCount === null && transcriptSubagent !== null) ? (
					<span
						className={cn(
							SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
							SESSION_OVERVIEW_ICON_TAG_CLASS_NAME,
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
						<IconAlertCircle
							aria-hidden="true"
							className={SESSION_OVERVIEW_TAG_ICON_CLASS_NAME}
						/>
						<span className={SESSION_OVERVIEW_TAG_NUMBER_CLASS_NAME}>
							{errorCount === null ? "—" : formatNumber(errorCount)}
						</span>
					</span>
				) : null}
			</div>
			{showSkillsColumn ? (
				isClickable && sessionHref ? (
					<div className={cellClassName} aria-hidden="true" />
				) : (
					skillsCell
				)
			) : null}
			<div
				className={cn(cellClassName, "justify-end gap-m")}
				data-session-overview-column="user"
			>
				<SessionOverviewLanguageSignals session={session} speaker="member" />
				{localApp ? null : (
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
				)}
			</div>
			<div
				className={cn(cellClassName, "justify-end px-m")}
				data-session-overview-column="time"
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<time
								dateTime={sessionDateTime}
								className={SESSION_OVERVIEW_METADATA_CLASS_NAME}
								data-session-overview-date-tooltip-label={dateTooltipLabel}
							>
								{liveRow ? liveRow.age : clock.date || "—"}
							</time>
						}
					/>
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
			data-session-key={sessionRowKey(session)}
			style={
				virtualTop === undefined
					? undefined
					: {
							position: "absolute",
							top: virtualTop,
							left: 0,
							width: "100%",
							height: SESSION_OVERVIEW_ROW_HEIGHT,
						}
			}
			ref={itemRef}
			className="relative z-10"
			data-session-disabled={!isClickable ? "true" : undefined}
			data-session-live={liveRow?.state}
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
					onClick={(event) => {
						markSessionOpenFromClick(session.session_id, isActive, event);
						onSessionClick?.(session);
					}}
					onFocus={() => intendSessionDetail(sessionHref)}
					onPointerDown={() => startSessionDetail(sessionHref)}
					onPointerEnter={() => intendSessionDetail(sessionHref)}
					onPointerLeave={cancelSessionDetailIntent}
					state={getSessionLinkState?.(session)}
					to={sessionHref}
					viewTransition
				>
					{rowContents}
				</Link>
			) : isClickable && onSessionClick ? (
				<button
					type="button"
					aria-pressed={expanded === undefined ? isActive : undefined}
					aria-expanded={expanded}
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
			{showSkillsColumn && isClickable && sessionHref ? (
				<div
					className={cn(
						"pointer-events-none absolute inset-0 grid",
						SESSION_OVERVIEW_GRID_CLASS_NAME,
					)}
				>
					{skillsCell}
				</div>
			) : null}
		</li>
	);
});
