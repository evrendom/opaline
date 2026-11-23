import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { type ReactNode, useMemo } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Card, CardContent } from "@/app/ui/card";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionReaderBodies } from "../detail/use-session-reader-bodies";
import { getReaderWaterfall } from "../model/session-reader-model";
import {
	subagentBrief,
	subagentIdOf,
} from "../subagents/session-reader-agent-focus";
import { SubagentStrip } from "../subagents/session-reader-subagent-strip";

const NOOP = () => {};

export function SummaryStrip({
	agent,
	children,
	overview,
	turn,
}: {
	agent: string | undefined;
	children?: ReactNode;
	overview: NormalizedSessionDetailOverview;
	turn: SessionDetailTurnSummary | undefined;
}) {
	if (agent && turn)
		return (
			<PickedSubagentStrip
				key={turn.turnId}
				agent={agent}
				overview={overview}
				turn={turn}
			/>
		);
	return (
		<Card size="sm" className="hidden has-[li]:flex">
			<CardContent>
				<div className="text-body-m">{children}</div>
			</CardContent>
		</Card>
	);
}

function PickedSubagentStrip({
	agent,
	overview,
	turn,
}: {
	agent: string;
	overview: NormalizedSessionDetailOverview;
	turn: SessionDetailTurnSummary;
}) {
	const { getBody, requestBody } = useSessionReaderBodies({
		initialWindow: undefined,
		onStaleRevision: NOOP,
		revision: overview.revision,
		sessionId: overview.session.sessionId,
	});
	useMountEffect(() => {
		requestBody(turn.turnId);
	});
	const state = getBody(turn.turnId);
	const body = state.status === "ready" ? state.body : null;
	const model = overview.session.modelUsed;
	const launch = useMemo(() => {
		const waterfall = body ? getReaderWaterfall(body, turn, model) : null;
		return (
			waterfall?.allSteps.find((step) => subagentIdOf(step) === agent) ?? null
		);
	}, [agent, body, model, turn]);
	return (
		<SubagentStrip
			launch={launch}
			named={false}
			purpose={launch ? subagentBrief(launch).purpose : null}
			subagentId={agent}
			summary={overview.subagents?.find((each) => each.subagentId === agent)}
			work={false}
		/>
	);
}
