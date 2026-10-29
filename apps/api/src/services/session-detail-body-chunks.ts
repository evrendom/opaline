import { createHash } from "node:crypto";
import {
	buildConversationTrace,
	parseConversations,
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	type SessionDetailBodyChunk,
	type SessionDetailBodyChunkInput,
	type SessionDetailSubagent,
	type SessionDetailSubagentTrace,
	SessionDetailSubagentTraceSchema,
	type SessionDetailTurn,
} from "@rudel/api-routes";

type SessionDetailBody =
	| SessionDetailTurn
	| SessionDetailSubagent
	| SessionDetailSubagentTrace;

export interface SerializedSessionDetailBody {
	json: string;
	sha256: string;
}

export function getSessionDetailBodyForChunk(
	derivation: {
		revision: string;
		rawSubagents: Readonly<Record<string, string>>;
		turnBodies: Pick<ReadonlyMap<string, SessionDetailTurn>, "get">;
	},
	input: Pick<SessionDetailBodyChunkInput, "kind" | "targetId">,
): SessionDetailBody | null {
	if (input.kind === "turn")
		return derivation.turnBodies.get(input.targetId) ?? null;
	const content = derivation.rawSubagents[input.targetId];
	if (typeof content !== "string") return null;
	return input.kind === "subagentTrace"
		? getSubagentTrace(content, derivation.revision, input.targetId)
		: { content, revision: derivation.revision, subagentId: input.targetId };
}

function getSubagentTrace(
	content: string,
	revision: string,
	subagentId: string,
): SessionDetailSubagentTrace {
	const items = buildConversationTrace(parseConversations(content)).flatMap(
		(item) =>
			item.kind === "agent"
				? [
						{
							...item,
							events: item.events.map((event) => {
								if (event.kind !== "tool") return event;
								const { activity: _, ...rest } = event;
								return rest;
							}),
						},
					]
				: [],
	);
	return SessionDetailSubagentTraceSchema.parse({
		items,
		revision,
		subagentId,
	});
}

export function createSessionDetailBodyChunk(
	body: SerializedSessionDetailBody,
	input: SessionDetailBodyChunkInput,
): SessionDetailBodyChunk {
	if (
		!Number.isSafeInteger(input.offset) ||
		input.offset < 0 ||
		input.offset >= body.json.length ||
		input.offset % SESSION_DETAIL_BODY_CHUNK_CODE_UNITS !== 0
	) {
		throw new RangeError("Invalid session detail body chunk offset");
	}
	return {
		...input,
		data: body.json.slice(
			input.offset,
			input.offset + SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
		),
		sha256: body.sha256,
		totalCodeUnits: body.json.length,
	};
}

export function serializeSessionDetailBody(
	body: SessionDetailBody,
): SerializedSessionDetailBody {
	const json = JSON.stringify(body);
	return { json, sha256: createHash("sha256").update(json).digest("hex") };
}
