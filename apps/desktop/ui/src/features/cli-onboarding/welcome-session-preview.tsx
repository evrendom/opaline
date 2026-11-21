import { SessionsOverviewControls } from "@/features/sessions/components/sessions-overview-controls";
import { SessionsOverviewHeader } from "@/features/sessions/components/sessions-overview-header";
import {
	SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { useSessionsOverviewTableState } from "@/features/sessions/components/use-sessions-overview-table-state";
import { cn } from "@/lib/utils";

const NO_USERS: Record<string, string> = {};

/** The empty sessions table the welcome panel sits on. */
export function WelcomeSessionPreview() {
	const tableState = useSessionsOverviewTableState({
		sessions: undefined,
		sessionCountLabel: 0,
		totalSessionCount: 0,
		userMap: NO_USERS,
	});
	return (
		<section
			className={cn("cli-welcome-preview", SESSION_OVERVIEW_SURFACE_CLASS_NAME)}
			aria-label="Your sessions"
			data-cli-session-preview
		>
			<div
				className={cn(
					"cli-welcome-table @container/sessions-overview",
					SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
				)}
			>
				<SessionsOverviewHeader
					controls={<SessionsOverviewControls inert tableState={tableState} />}
					onSort={tableState.handleSort}
					sort={tableState.sort}
				/>
				<p className="sr-only">Your sessions will appear here.</p>
			</div>
		</section>
	);
}
