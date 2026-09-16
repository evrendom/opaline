import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface SessionDetailBodyStore<TValue>
	extends Iterable<[string, TValue]> {
	get(id: string): TValue | undefined;
	values(): IterableIterator<TValue>;
}

// Keep the revision's bodies without retaining the entire parsed conversation.
// A window decodes only its own turns; overview pages never decode any bodies.
export function createSessionDetailBodyStore<TValue>(
	values: Iterable<readonly [string, TValue]>,
	parse: (value: unknown) => TValue,
) {
	const encoded = new Map<string, Buffer>();
	let byteSize = 0;
	for (const [id, value] of values) {
		const buffer = deflateRawSync(JSON.stringify(value), { level: 1 });
		// Copy out of zlib's output slab so small turns don't retain a 16 KB slab.
		const retained = Buffer.allocUnsafeSlow(buffer.length);
		buffer.copy(retained);
		encoded.set(id, retained);
		byteSize += retained.byteLength + id.length * 2 + 256;
	}
	const decode = (buffer: Buffer) =>
		parse(JSON.parse(inflateRawSync(buffer).toString("utf8")));
	return {
		byteSize,
		get(id: string) {
			const buffer = encoded.get(id);
			return buffer === undefined ? undefined : decode(buffer);
		},
		*values() {
			for (const buffer of encoded.values()) yield decode(buffer);
		},
		*[Symbol.iterator](): IterableIterator<[string, TValue]> {
			for (const [id, buffer] of encoded) yield [id, decode(buffer)];
		},
	} satisfies SessionDetailBodyStore<TValue> & { byteSize: number };
}
