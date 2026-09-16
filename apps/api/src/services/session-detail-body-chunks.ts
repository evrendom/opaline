import { createHash } from "node:crypto";
import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	type SessionDetailBodyChunk,
	type SessionDetailBodyChunkInput,
	type SessionDetailSubagent,
	type SessionDetailTurn,
} from "@rudel/api-routes";

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
): SessionDetailTurn | SessionDetailSubagent | null {
	if (input.kind === "turn")
		return derivation.turnBodies.get(input.targetId) ?? null;
	const content = derivation.rawSubagents[input.targetId];
	return typeof content === "string"
		? { content, revision: derivation.revision, subagentId: input.targetId }
		: null;
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
	body: SessionDetailTurn | SessionDetailSubagent,
): SerializedSessionDetailBody {
	const json = JSON.stringify(body);
	return { json, sha256: createHash("sha256").update(json).digest("hex") };
}
