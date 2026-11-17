import type { SessionAnalytics } from "@rudel/api-routes";
import {
	AGENT_PARAM,
	SESSION_TAB_PARAM,
	SUBAGENT_PARAM,
} from "./reader/reader-params";

type SessionRowIdentity = Pick<
	SessionAnalytics,
	"source" | "session_id" | "subagent_of"
>;

export function transcriptSubagentId(
	session: Pick<SessionAnalytics, "subagent_of">,
): string | null {
	return session.subagent_of?.kind === "agent"
		? session.subagent_of.agent_id
		: null;
}

export function isFamilyMemberRow(
	session: Pick<SessionAnalytics, "subagent_of">,
): boolean {
	return (
		session.subagent_of?.kind === "agent" ||
		session.subagent_of?.kind === "child"
	);
}

export function sessionRowKey(session: SessionRowIdentity): string {
	const agent = transcriptSubagentId(session);
	const key = `${session.source}:${session.session_id}`;
	return agent ? `${key}:${agent}` : key;
}

export function withTranscriptSubagent(
	href: string | undefined,
	session: Pick<SessionAnalytics, "subagent_of">,
): string | undefined {
	const agent = transcriptSubagentId(session);
	if (!href || !agent) return href;
	const [path, query = ""] = href.split("?", 2);
	const params = new URLSearchParams(query);
	params.set(SESSION_TAB_PARAM, "detail");
	params.set(AGENT_PARAM, agent);
	params.set(SUBAGENT_PARAM, agent);
	return `${path}?${params.toString()}`;
}
