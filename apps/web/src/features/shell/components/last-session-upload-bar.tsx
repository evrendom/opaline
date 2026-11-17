import type { LastSessionUpload, SessionAnalytics } from "@rudel/api-routes";
import {
	IconArrowUpRight,
	IconCloudUpload,
	IconLoader2,
	IconRun,
} from "@tabler/icons-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { RollingText } from "@/features/costs/cost-rolling-text";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import {
	initialImportLabel,
	useAgentsRunning,
	useInitialImport,
} from "@/features/self-hosted/local-processing";
import { SessionModelProgressRing } from "@/features/sessions/components/session-model-progress-ring";
import {
	pollUnlessPushed,
	useSessionArrivalsLive,
} from "@/features/sessions/session-arrivals-live";
import { getSessionTimestamp } from "@/features/sessions/session-ordering";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { DockedSupportEmailButton } from "@/features/support/SupportEmailButton";
import { orpc } from "@/lib/orpc";

// Sessions upload when they end, so the newest session's end is when the
// workspace last received one.
function getSessionEnd(session: {
	session_date: string;
	duration_min: number;
}) {
	const start = getSessionTimestamp(session.session_date);
	return new Date(start.getTime() + session.duration_min * 60_000);
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

// Intl output differs between the build's Node and the visitor's browser
// ("Aug 27 at 5:04 PM" vs "Aug 27, 5:04 PM"), so the demo's static render
// spells out its UTC time by hand.
function formatUtcTime(date: Date) {
	const hours = date.getUTCHours();
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"} UTC`;
}

/** The demo seeds the bar's query with its newest seeded session. */
export function toLastSessionUpload(
	session:
		| Pick<SessionAnalytics, "session_id" | "session_date" | "duration_min">
		| undefined,
): LastSessionUpload | null {
	return session
		? {
				session_id: session.session_id,
				session_date: session.session_date,
				duration_min: session.duration_min,
			}
		: null;
}

const HANDOVER = {
	duration: 0.46,
	ease: [0.22, 1, 0.36, 1],
} as const;
const HANDOVER_SHIFT_PX = 8;

const handover = {
	enter: (direction: number) => ({
		opacity: 0,
		y: direction * HANDOVER_SHIFT_PX,
		filter: "blur(2px)",
	}),
	shown: { opacity: 1, y: 0, filter: "blur(0px)" },
	leave: (direction: number) => ({
		opacity: 0,
		y: -direction * HANDOVER_SHIFT_PX,
		filter: "blur(2px)",
	}),
};

const MotionLink = motion.create(Link);

function FooterLink({
	ref,
	direction,
	to,
	title,
	icon,
	children,
}: {
	ref?: Ref<HTMLAnchorElement>;
	direction: number;
	to: string;
	title: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	const reduceMotion = useReducedMotion();
	return (
		<MotionLink
			ref={ref}
			custom={direction}
			to={to}
			title={title}
			variants={handover}
			initial="enter"
			animate="shown"
			exit="leave"
			transition={reduceMotion ? { duration: 0 } : HANDOVER}
			className="group/last-upload flex items-center gap-1.25 whitespace-nowrap rounded-sm outline-none transition-colors hover:text-foreground"
		>
			{icon}
			{children}
			<IconArrowUpRight
				aria-hidden="true"
				className="-ml-0.5 size-3.25 text-muted-foreground transition-colors group-hover/last-upload:text-foreground"
			/>
		</MotionLink>
	);
}

export function LastSessionUploadBar() {
	const getShellRoutePath = useShellRoutePath();
	const demo = useDemoRuntime();
	// The demo's static render must match its hydration on any machine, so it
	// shows UTC until Explore, then the visitor's own time.
	const fixedFormat = demo !== null && !demo.live;
	const pushed = useSessionArrivalsLive();
	const query = useAnalyticsQuery(
		orpc.analytics.sessions.lastUpload.queryOptions({
			staleTime: 60_000,
			refetchInterval: pollUnlessPushed(pushed, 60_000),
		}),
	);
	const initialImport = useInitialImport();
	const localApp = useLocalDesktopApp();
	const agentsRunning = useAgentsRunning();
	const latest = query.data;
	const uploadedAt = latest ? getSessionEnd(latest) : null;
	const running = localApp && agentsRunning > 0;
	const direction = running ? 1 : -1;

	return (
		<div className="flex h-8 shrink-0 items-center gap-4 px-1 text-xs text-muted-foreground tabular-nums">
			{initialImport ? (
				<output className="flex items-center gap-1.25">
					<IconLoader2
						aria-hidden="true"
						className="size-3.25 animate-spin opacity-80"
					/>
					{initialImportLabel(initialImport)}
				</output>
			) : (
				<div className="relative flex items-center">
					<AnimatePresence initial={false} mode="popLayout" custom={direction}>
						{running ? (
							<FooterLink
								key="running"
								direction={direction}
								to={getShellRoutePath(appRoutes.session())}
								title="Open your sessions"
								icon={
									<span
										aria-hidden="true"
										className="relative size-3.25 shrink-0 text-foreground"
									>
										<SessionModelProgressRing progress="loading" />
									</span>
								}
							>
								<span className="text-foreground">
									<RollingText text={String(agentsRunning)} />
								</span>
								<span className="inline-flex">
									agent
									<RollingText text={agentsRunning === 1 ? "" : "s"} />
								</span>
								running
							</FooterLink>
						) : latest && uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? (
							<FooterLink
								key="last"
								direction={direction}
								to={getShellRoutePath(
									appRoutes.sessionDetail(latest.session_id),
								)}
								title={`Open the session ${localApp ? "that ended" : "uploaded"} ${fixedFormat ? formatUtcTime(uploadedAt) : uploadedAt.toLocaleString()}`}
								icon={
									localApp ? (
										<IconRun
											aria-hidden="true"
											className="size-3.25 opacity-80"
										/>
									) : (
										<IconCloudUpload
											aria-hidden="true"
											className="size-3.25 opacity-80"
										/>
									)
								}
							>
								{localApp ? "Last agent run" : "Last session uploaded"}
								<span className="text-foreground">
									{fixedFormat
										? formatUtcTime(uploadedAt)
										: uploadedAt.toLocaleString(undefined, {
												month: "short",
												day: "numeric",
												year:
													uploadedAt.getFullYear() !== new Date().getFullYear()
														? "numeric"
														: undefined,
												hour: "numeric",
												minute: "2-digit",
											})}
								</span>
							</FooterLink>
						) : null}
					</AnimatePresence>
				</div>
			)}
			{demo === null ? <DockedSupportEmailButton className="ml-auto" /> : null}
		</div>
	);
}
