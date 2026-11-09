import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	type SessionDetailBodyChunkInput,
	SessionDetailBodyChunkSchema,
	type SessionDetailBodyChunks,
} from "@rudel/api-routes";
import { scheduleBodyRequest } from "./body-request-scheduler";

type BodyIdentity = Omit<SessionDetailBodyChunkInput, "offset">;

const BODY_CHUNKS_IN_FLIGHT = 4;

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
	known?: SessionDetailBodyChunks,
): Promise<unknown> {
	const controller = new AbortController();
	const signal = AbortSignal.any([querySignal, controller.signal]);
	const request = (offset: number, expected?: SessionDetailBodyChunks) =>
		scheduleBodyRequest(input.targetId, signal, () =>
			env.request({ ...input, offset }, signal),
		).then((value) => parseChunk(value, input, offset, expected));
	try {
		signal.throwIfAborted();
		const head = known ? undefined : await request(0);
		const expected = known ?? head;
		if (!expected) throw new SessionDetailBodyIntegrityError();
		const offsets: number[] = [];
		for (
			let offset = head ? head.data.length : 0;
			offset < expected.totalCodeUnits;
			offset += SESSION_DETAIL_BODY_CHUNK_CODE_UNITS
		)
			offsets.push(offset);
		const rest = await mapWithLimit(offsets, BODY_CHUNKS_IN_FLIGHT, (offset) =>
			request(offset, expected),
		);
		const chunks = head ? [head.data] : [];
		for (const chunk of rest) chunks.push(chunk.data);
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
		if (json.length !== expected.totalCodeUnits || sha256 !== expected.sha256) {
			throw new SessionDetailBodyIntegrityError();
		}
		return JSON.parse(json);
	} finally {
		// Cancel sibling requests if any chunk failed, as well as on navigation.
		controller.abort();
	}
}

async function mapWithLimit<T, R>(
	items: readonly T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await run(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

function parseChunk(
	value: unknown,
	input: BodyIdentity,
	offset: number,
	expected?: SessionDetailBodyChunks,
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
		(expected &&
			(chunk.sha256 !== expected.sha256 ||
				chunk.totalCodeUnits !== expected.totalCodeUnits))
	)
		throw new SessionDetailBodyIntegrityError();
	return chunk;
}
