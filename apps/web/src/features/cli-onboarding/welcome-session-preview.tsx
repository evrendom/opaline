import { useQuery } from "@tanstack/react-query";
import { SessionsOverviewControls } from "@/features/sessions/components/sessions-overview-controls";
import { SessionsOverviewFluidList } from "@/features/sessions/components/sessions-overview-fluid-list";
import { SessionsOverviewHeader } from "@/features/sessions/components/sessions-overview-header";
import { SessionsOverviewPendingRow } from "@/features/sessions/components/sessions-overview-pending-row";
import { SessionsOverviewRow } from "@/features/sessions/components/sessions-overview-row";
import {
	getSessionOverviewCost,
	SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { useSessionsOverviewTableState } from "@/features/sessions/components/use-sessions-overview-table-state";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { CliConnectionSnapshot } from "../../../../../packages/api-routes/src/cli-connection";

const MAX_PREVIEW_SESSIONS = 30;

export function WelcomeSessionPreview({
	snapshot,
}: {
	snapshot: CliConnectionSnapshot | null;
}) {
	const { state } = useOrganization();
	const { avatarMap, userMap } = useUserMap();
	const repositories =
		snapshot?.repositories.filter(
			(repository) => repository.enabled && repository.sessionCount > 0,
		) ?? [];
	const previewCount = Math.min(
		MAX_PREVIEW_SESSIONS,
		repositories.reduce(
			(count, repository) => count + repository.sessionCount,
			0,
		),
	);
	const canReadUploadedSessions = Boolean(
		repositories.length > 0 &&
			snapshot?.organizationId &&
			state.activeOrg?.id === snapshot.organizationId &&
			["uploading", "completed"].includes(snapshot.state),
	);
	const { data: uploadedSessions } = useQuery({
		queryKey: [
			"welcome-sessions",
			snapshot?.id,
			snapshot?.organizationId,
			snapshot?.state,
			previewCount,
		],
		enabled: canReadUploadedSessions,
		queryFn: async () =>
			parseSessionOverviewRows(
				await client.analytics.sessions.list({
					startDate: "1970-01-01",
					endDate: new Date().toISOString().slice(0, 10),
					limit: previewCount,
				}),
			),
		refetchInterval: (query) =>
			snapshot?.state === "uploading" ||
			(snapshot?.state === "completed" &&
				(query.state.data?.length ?? 0) < previewCount)
				? 3000
				: false,
	});
	const sessions = canReadUploadedSessions
		? uploadedSessions?.slice(0, previewCount)
		: undefined;
	const tableState = useSessionsOverviewTableState({
		sessions,
		sessionCountLabel: sessions?.length ?? 0,
		totalSessionCount: sessions?.length ?? 0,
		userMap,
	});
	const pendingRows = repositories.length
		? repositories
				.flatMap((repository) =>
					Array.from(
						{ length: Math.min(repository.sessionCount, MAX_PREVIEW_SESSIONS) },
						(_, index) => ({
							key: `${repository.id}-${index}`,
							repositoryName: repository.name,
							source: repository.sources[index % repository.sources.length],
						}),
					),
				)
				.slice(0, MAX_PREVIEW_SESSIONS)
		: Array.from({ length: MAX_PREVIEW_SESSIONS }, (_, index) => ({
				key: `pending-${index}`,
				repositoryName: "",
				source: undefined,
			}));
	const maximumSessionCost = Math.max(
		0,
		...(sessions ?? []).map((session) => getSessionOverviewCost(session) ?? 0),
	);
	return (
		<section
			className={cn("cli-welcome-preview", SESSION_OVERVIEW_SURFACE_CLASS_NAME)}
			aria-label="Your selected sessions"
			data-cli-session-preview
		>
			<div
				className={cn(
					"cli-welcome-table @container/sessions-overview",
					SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
				)}
				data-cli-uploaded-preview={sessions?.length ? "" : undefined}
			>
				<SessionsOverviewHeader
					controls={<SessionsOverviewControls inert tableState={tableState} />}
					onSort={tableState.handleSort}
					sort={tableState.sort}
				/>
				{!sessions?.length && (
					<p className="sr-only">
						Session details will appear here after upload.
					</p>
				)}
				<SessionsOverviewFluidList>
					{({ registerItem, setActiveIndex }) => (
						<>
							{sessions?.map((session, index) => (
								<SessionsOverviewRow
									key={session.session_id}
									index={index}
									registerItem={registerItem}
									setHoverActiveIndex={setActiveIndex}
									activeSessionId={undefined}
									avatarUrl={avatarMap[session.user_id]}
									canOpenSession={() => false}
									getSessionHref={undefined}
									getSessionLinkState={undefined}
									maximumSessionCost={maximumSessionCost}
									memberProfile={undefined}
									onSessionClick={undefined}
									session={session}
									userLabel={userMap[session.user_id] ?? ""}
								/>
							))}
							{pendingRows.slice(sessions?.length ?? 0).map((row, index) => (
								<SessionsOverviewPendingRow
									key={row.key}
									index={index + (sessions?.length ?? 0)}
									repositoryName={row.repositoryName}
									source={row.source}
									placeholderOnly={repositories.length === 0}
								/>
							))}
						</>
					)}
				</SessionsOverviewFluidList>
			</div>
		</section>
	);
}
