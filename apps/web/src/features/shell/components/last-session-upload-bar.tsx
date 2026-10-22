import type { LastSessionUpload, SessionAnalytics } from "@rudel/api-routes";
import { IconArrowUpRight, IconCloudUpload } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { getSessionTimestamp } from "@/features/sessions/session-ordering";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
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

/** Adapted from the dev bar: a strip in the canvas under
 * the window, kept in flow so it follows the window when the assistant panel
 * resizes it. */
export function LastSessionUploadBar() {
	const getShellRoutePath = useShellRoutePath();
	const demo = useDemoRuntime();
	// The demo's static render must match its hydration on any machine, so it
	// shows UTC until Explore, then the visitor's own time.
	const fixedFormat = demo !== null && !demo.live;
	const query = useAnalyticsQuery(
		orpc.analytics.sessions.lastUpload.queryOptions({
			staleTime: 60_000,
			refetchInterval: 60_000,
		}),
	);
	const latest = query.data;
	const uploadedAt = latest ? getSessionEnd(latest) : null;

	return (
		<div className="flex h-8 shrink-0 items-center gap-4 px-1 text-xs text-muted-foreground tabular-nums">
			{latest && uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? (
				<Link
					to={getShellRoutePath(appRoutes.sessionDetail(latest.session_id))}
					className="group/last-upload flex items-center gap-1.25 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[1.5px] focus-visible:ring-ring/50"
					title={`Open the session uploaded ${fixedFormat ? formatUtcTime(uploadedAt) : uploadedAt.toLocaleString()}`}
				>
					<IconCloudUpload
						aria-hidden="true"
						className="size-3.25 opacity-80"
					/>
					Last session uploaded
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
					<IconArrowUpRight
						aria-hidden="true"
						className="-ml-0.5 size-3.25 text-muted-foreground transition-colors group-hover/last-upload:text-foreground"
					/>
				</Link>
			) : null}
		</div>
	);
}
