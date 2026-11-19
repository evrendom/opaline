import type {
	LiveSessionSummary,
	SessionOverviewListRow,
} from "@rudel/api-routes";
import { recordedPath } from "./demo-fixtures";

const LIVE_SESSION_COUNT = 2;
const ACTIVITY_LAG_MS = [4_000, 21_000];

let running: SessionOverviewListRow[] = [];

export function setDemoLiveSessions(rows: readonly SessionOverviewListRow[]) {
	running = rows
		.filter((row) => !("subagent_of" in row))
		.slice(0, LIVE_SESSION_COUNT);
}

function summary(
	row: SessionOverviewListRow,
	index: number,
): LiveSessionSummary {
	return {
		sessionId: row.session_id,
		userId: row.user_id,
		source: row.source ?? "claude_code",
		projectPath: row.project_path ?? "",
		gitRemote: row.git_remote ?? null,
		gitBranch: row.git_branch ?? null,
		startedAt: new Date(row.session_date).toISOString(),
		lastActivityAt: new Date(
			Date.now() - (ACTIVITY_LAG_MS[index] ?? 30_000),
		).toISOString(),
		endedAt: null,
	};
}

function rpc(json: unknown): Response {
	return new Response(JSON.stringify({ json, meta: [] }), {
		headers: { "content-type": "application/json" },
	});
}

async function requestedSessionId(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<string | undefined> {
	const text = await new Request(input, init).text();
	try {
		return (JSON.parse(text) as { json?: { sessionId?: string } }).json
			?.sessionId;
	} catch {
		return undefined;
	}
}

export async function answerLive(
	pathname: string,
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	recorded: () => Promise<Response>,
): Promise<Response | null> {
	const path = recordedPath(pathname);
	if (path === "/rpc/analytics/sessions/liveList")
		return rpc({ sessions: running.map(summary) });
	if (path === "/rpc/analytics/sessions/liveTail") {
		const sessionId = await requestedSessionId(input, init);
		const index = running.findIndex((row) => row.session_id === sessionId);
		const row = running[index];
		return rpc({
			session: row ? summary(row, index) : null,
			uploaded: true,
			streams: [],
		});
	}
	if (path === "/api/selfhost/ingest/status") {
		const response = await recorded();
		const status = (await response.json()) as Record<string, unknown>;
		return new Response(
			JSON.stringify({ ...status, agentsRunning: running.length }),
			{ status: response.status, headers: response.headers },
		);
	}
	return null;
}
