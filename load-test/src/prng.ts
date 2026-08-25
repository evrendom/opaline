import type { EntropyLevel } from "./types.ts";

const HIGH_ENTROPY_ALPHABET = createHighEntropyAlphabet();
const MEDIUM_ENTROPY_WORDS: readonly string[] = [
	"agent",
	"analysis",
	"command",
	"context",
	"file",
	"result",
	"session",
	"tool",
];

export interface DeterministicBytes {
	readonly fill: (length: number, entropy: EntropyLevel) => Uint8Array;
	readonly nextUint32: () => number;
}

export function createDeterministicBytes(seed: string): DeterministicBytes {
	let state = hashSeed(seed);
	if (state === 0) state = 0x6d2b_79f5;

	function nextUint32(): number {
		state += 0x6d2b_79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return (value ^ (value >>> 14)) >>> 0;
	}

	return {
		fill(length, entropy) {
			assertNonNegativeInteger(length, "filler length");
			if (entropy === "low") {
				return new Uint8Array(length).fill(97);
			}
			if (entropy === "medium") {
				return fillMediumEntropy(length, nextUint32);
			}
			return fillHighEntropy(length, nextUint32);
		},
		nextUint32,
	};
}

function fillHighEntropy(length: number, nextUint32: () => number): Uint8Array {
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index += 1) {
		const character =
			HIGH_ENTROPY_ALPHABET[nextUint32() % HIGH_ENTROPY_ALPHABET.length];
		if (character === undefined) {
			throw new Error("High-entropy alphabet is empty");
		}
		bytes[index] = character;
	}
	return bytes;
}

function fillMediumEntropy(
	length: number,
	nextUint32: () => number,
): Uint8Array {
	const bytes = new Uint8Array(length);
	let offset = 0;
	while (offset < length) {
		const word =
			MEDIUM_ENTROPY_WORDS[nextUint32() % MEDIUM_ENTROPY_WORDS.length];
		if (!word) throw new Error("Medium-entropy dictionary is empty");
		const segment = `${word}-${nextUint32().toString(16)} `;
		for (let index = 0; index < segment.length && offset < length; index += 1) {
			bytes[offset] = segment.charCodeAt(index);
			offset += 1;
		}
	}
	return bytes;
}

function createHighEntropyAlphabet(): Uint8Array {
	const values: number[] = [];
	for (let value = 32; value <= 126; value += 1) {
		if (value !== 34 && value !== 92) values.push(value);
	}
	return Uint8Array.from(values);
}

function hashSeed(seed: string): number {
	let hash = 0x811c_9dc5;
	for (const character of new TextEncoder().encode(seed)) {
		hash ^= character;
		hash = Math.imul(hash, 0x0100_0193);
	}
	return hash >>> 0;
}

function assertNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative safe integer`);
	}
}
