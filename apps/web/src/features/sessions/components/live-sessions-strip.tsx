import { resolveRepoIdentity } from "@rudel/api-routes";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { formatUsername } from "@/lib/format";
import {
	formatLiveSessionActivity,
	formatLiveSessionSource,
	isLiveSessionActive,
} from "../live-session-model";
import { useLiveSessionList } from "../use-live-sessions";
import { LiveSessionDot } from "./live-session-dot";

/**
 * Sessions running right now (updated in the last five minutes and not
 * ended), above the sessions list. Renders nothing without any.
 */
export function LiveSessionsStrip({
	getSessionHref,
}: {
	getSessionHref: (sessionId: string) => string;
}) {
	const { sessions, updatedAt } = useLiveSessionList();
	const { userMap, avatarMap } = useUserMap();
	const nowMs = updatedAt || Date.now();
	const running = sessions.filter((session) =>
		isLiveSessionActive(session, nowMs),
	);
	if (running.length === 0) return null;

	return (
		<section
			aria-label="Live sessions"
			className="shrink-0 border-b border-black/6 px-4 py-2.5 dark:border-white/8"
			data-slot="live-sessions"
		>
			<div className="flex min-w-0 items-center gap-3 overflow-x-auto">
				<p className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-(--dashboardy-heading)">
					<LiveSessionDot pulsing />
					Live
					<span className="font-normal text-(--dashboardy-muted) tabular-nums">
						{running.length}
					</span>
				</p>
				<ul className="flex min-w-0 items-center gap-2">
					{running.map((session) => {
						const userLabel = formatUsername(session.userId, userMap);
						const repository = resolveRepoIdentity({
							gitRemote: session.gitRemote,
							packageName: null,
							projectPath: session.projectPath,
						}).repoLabel;
						return (
							<li key={session.sessionId} className="shrink-0">
								<Link
									className="flex max-w-96 items-center gap-2 rounded-full border border-black/8 bg-(--dashboardy-surface) py-1 pr-3 pl-1 text-xs transition-colors hover:bg-(--dashboardy-row-hover) dark:border-white/10"
									data-live-session-id={session.sessionId}
									title={`${userLabel} · ${session.projectPath}`}
									to={getSessionHref(session.sessionId)}
								>
									<Avatar className="size-5 after:hidden">
										{avatarMap[session.userId] ? (
											<AvatarImage alt="" src={avatarMap[session.userId]} />
										) : null}
										<AvatarFallback className="text-[0.625rem]">
											{userLabel.slice(0, 1).toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<span className="max-w-32 shrink-0 truncate font-medium text-(--dashboardy-heading)">
										{userLabel}
									</span>
									<span className="shrink-0 text-(--dashboardy-muted)">
										{formatLiveSessionSource(session.source)}
									</span>
									<span className="min-w-0 truncate text-(--dashboardy-muted)">
										{repository}
										{session.gitBranch ? ` · ${session.gitBranch}` : ""}
									</span>
									<span className="shrink-0 text-(--dashboardy-muted) tabular-nums">
										{formatLiveSessionActivity(session.lastActivityAt, nowMs)}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}
