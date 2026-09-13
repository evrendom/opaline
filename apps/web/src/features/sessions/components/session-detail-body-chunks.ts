import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	type SessionDetailBodyChunk,
	type SessionDetailBodyChunkInput,
	SessionDetailBodyChunkSchema,
} from "@rudel/api-routes";

type BodyIdentity = Omit<SessionDetailBodyChunkInput, "offset">;
const CHUNK_CONCURRENCY = 4;

export class SessionDetailBodyIntegrityError extends Error {
	constructor() {
		super("The session detail body was incomplete or changed during delivery.");
		this.name = "SessionDetailBodyIntegrityError";
	}
}

// The callback uses the normal authenticated RPC transport and per-request
// timeout. This assembler never falls back to a preview or an omitted body.
export async function readSessionDetailBodyChunks(
	input: BodyIdentity,
	querySignal: AbortSignal,
	env: {
		request: (
			input: SessionDetailBodyChunkInput,
			signal: AbortSignal,
		) => Promise<unknown>;
	},
): Promise<unknown> {
	const controller = new AbortController();
	const signal = AbortSignal.any([querySignal, controller.signal]);
	try {
		signal.throwIfAborted();
		const first = parseChunk(
			await env.request({ ...input, offset: 0 }, signal),
			input,
			0,
		);
		const chunks = [first.data];
		for (let offset = first.data.length; offset < first.totalCodeUnits; ) {
			signal.throwIfAborted();
			const batch: Promise<SessionDetailBodyChunk>[] = [];
			for (
				let index = 0;
				index < CHUNK_CONCURRENCY && offset < first.totalCodeUnits;
				index++
			) {
				const chunkOffset = offset;
				batch.push(
					env
						.request({ ...input, offset: chunkOffset }, signal)
						.then((value) => parseChunk(value, input, chunkOffset, first)),
				);
				offset += SESSION_DETAIL_BODY_CHUNK_CODE_UNITS;
			}
			for (const chunk of await Promise.all(batch)) chunks.push(chunk.data);
		}
		signal.throwIfAborted();
		const json = chunks.join("");
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(json),
		);
		const sha256 = Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		signal.throwIfAborted();
		if (json.length !== first.totalCodeUnits || sha256 !== first.sha256) {
			throw new SessionDetailBodyIntegrityError();
		}
		return JSON.parse(json);
	} finally {
		// Cancel sibling requests if any chunk failed, as well as on navigation.
		controller.abort();
	}
}

function parseChunk(
	value: unknown,
	input: BodyIdentity,
	offset: number,
	first?: SessionDetailBodyChunk,
) {
	const parsed = SessionDetailBodyChunkSchema.safeParse(value);
	if (!parsed.success) throw new SessionDetailBodyIntegrityError();
	const chunk = parsed.data;
	if (
		chunk.kind !== input.kind ||
		chunk.targetId !== input.targetId ||
		chunk.sessionId !== input.sessionId ||
		chunk.revision !== input.revision ||
		chunk.offset !== offset ||
		chunk.data.length !==
			Math.min(
				SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
				chunk.totalCodeUnits - offset,
			) ||
		(first &&
			(chunk.sha256 !== first.sha256 ||
				chunk.totalCodeUnits !== first.totalCodeUnits))
	)
		throw new SessionDetailBodyIntegrityError();
	return chunk;
}
