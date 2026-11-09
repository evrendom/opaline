import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	type SessionDetailBodyChunks,
} from "@rudel/api-routes";

export interface SessionDetailBodyStore<TValue>
	extends Iterable<[string, TValue]> {
	get(id: string): TValue | undefined;
	values(): IterableIterator<TValue>;
	chunks?(id: string): SessionDetailBodyChunks | undefined;
	serialized?(id: string): { json: string; sha256: string } | undefined;
}

function sha256Of(json: string) {
	return createHash("sha256").update(json).digest("hex");
}

// Keep the revision's bodies without retaining the entire parsed conversation.
// A window decodes only its own turns; overview pages never decode any bodies.
export function createSessionDetailBodyStore<TValue>(
	values: Iterable<readonly [string, TValue]>,
	parse: (value: unknown) => TValue,
) {
	const encoded = new Map<string, Buffer>();
	const chunked = new Map<string, SessionDetailBodyChunks>();
	let byteSize = 0;
	for (const [id, value] of values) {
		const json = JSON.stringify(value);
		const buffer = deflateRawSync(json, { level: 1 });
		// Copy out of zlib's output slab so small turns don't retain a 16 KB slab.
		const retained = Buffer.allocUnsafeSlow(buffer.length);
		buffer.copy(retained);
		encoded.set(id, retained);
		byteSize += retained.byteLength + id.length * 2 + 256;
		if (json.length > SESSION_DETAIL_BODY_CHUNK_CODE_UNITS) {
			chunked.set(id, {
				sha256: sha256Of(json),
				totalCodeUnits: json.length,
			});
			byteSize += id.length * 2 + 256;
		}
	}
	const inflate = (buffer: Buffer) => inflateRawSync(buffer).toString("utf8");
	const decode = (buffer: Buffer) => parse(JSON.parse(inflate(buffer)));
	return {
		byteSize,
		get(id: string) {
			const buffer = encoded.get(id);
			return buffer === undefined ? undefined : decode(buffer);
		},
		chunks(id: string) {
			return chunked.get(id);
		},
		serialized(id: string) {
			const buffer = encoded.get(id);
			if (buffer === undefined) return undefined;
			const json = inflate(buffer);
			return { json, sha256: chunked.get(id)?.sha256 ?? sha256Of(json) };
		},
		*values() {
			for (const buffer of encoded.values()) yield decode(buffer);
		},
		*[Symbol.iterator](): IterableIterator<[string, TValue]> {
			for (const [id, buffer] of encoded) yield [id, decode(buffer)];
		},
	} satisfies SessionDetailBodyStore<TValue> & { byteSize: number };
}
