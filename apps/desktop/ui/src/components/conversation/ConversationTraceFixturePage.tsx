import { ConversationTrace } from "./ConversationTrace";
import {
	buildConversationTraceFixtureTurns,
	CONVERSATION_TRACE_FIXTURE_AGENT_LABEL,
	CONVERSATION_TRACE_FIXTURE_MODEL,
	CONVERSATION_TRACE_FIXTURE_USER_LABEL,
} from "./conversation-trace-fixture";

// Unauthenticated, deterministic harness for the sticky trace-tree boundary
// tests: the real ConversationTrace over the checked-in fixture, inside the
// same scroll-container contract and theme tokens as the session routes. The
// trailing spacer lets the final turn boundary scroll fully past the sticky
// stack so both scroll directions can sweep it.
export function ConversationTraceFixturePage() {
	const turns = buildConversationTraceFixtureTurns();

	return (
		<div
			data-conversation-trace-scroll-container
			data-trace-fixture-scroller
			className="isolate h-dvh min-w-0 overflow-y-auto bg-canvas antialiased [font-family:Inter,sans-serif]"
		>
			{turns.map((turn, index) => (
				<section
					key={turn.key}
					aria-label={`Fixture turn ${index + 1}`}
					data-trace-fixture-turn={index + 1}
				>
					<ConversationTrace
						agentLabel={CONVERSATION_TRACE_FIXTURE_AGENT_LABEL}
						agentModel={CONVERSATION_TRACE_FIXTURE_MODEL}
						agentSectionMode="expanded"
						continuesAfter={index < turns.length - 1}
						expandedSpeakerLayout="trace-tree"
						items={turn.items}
						requestUsage={turn.requestUsage}
						requestUsagePlacement="start"
						traceCallDisplayMode="request"
						userLabel={CONVERSATION_TRACE_FIXTURE_USER_LABEL}
					/>
				</section>
			))}
			<div aria-hidden="true" className="h-dvh" />
		</div>
	);
}
