const MASK = (1n << 64n) - 1n;
const K0 = 0xc3a5c85c97cb3127n;
const K1 = 0xb492b66fbe98f273n;
const K2 = 0x9ae16a3b2f90404fn;
const K3 = 0xc949d7c7509e6557n;
const KMUL = 0x9ddfea08eb382d69n;

const u64 = (value: bigint) => value & MASK;
const mul = (a: bigint, b: bigint) => (a * b) & MASK;
const add = (...values: bigint[]) =>
	values.reduce((sum, value) => (sum + value) & MASK, 0n);

function rotate(value: bigint, shift: number): bigint {
	if (shift === 0) return value;
	const s = BigInt(shift);
	return u64((value >> s) | (value << (64n - s)));
}

const shiftMix = (value: bigint) => value ^ (value >> 47n);

function fetch64(bytes: Uint8Array, at: number): bigint {
	let value = 0n;
	for (let index = 7; index >= 0; index--)
		value = (value << 8n) | BigInt(bytes[at + index] ?? 0);
	return value;
}

function fetch32(bytes: Uint8Array, at: number): bigint {
	let value = 0n;
	for (let index = 3; index >= 0; index--)
		value = (value << 8n) | BigInt(bytes[at + index] ?? 0);
	return value;
}

function hashLen16(u: bigint, v: bigint): bigint {
	let a = mul(u ^ v, KMUL);
	a ^= a >> 47n;
	let b = mul(v ^ a, KMUL);
	b ^= b >> 47n;
	return mul(b, KMUL);
}

function hashLen0to16(bytes: Uint8Array, at: number, length: number): bigint {
	const len = BigInt(length);
	if (length > 8) {
		const a = fetch64(bytes, at);
		const b = fetch64(bytes, at + length - 8);
		return hashLen16(a, rotate(add(b, len), length)) ^ b;
	}
	if (length >= 4) {
		const a = fetch32(bytes, at);
		return hashLen16(add(len, u64(a << 3n)), fetch32(bytes, at + length - 4));
	}
	if (length > 0) {
		const a = BigInt(bytes[at] ?? 0);
		const b = BigInt(bytes[at + (length >> 1)] ?? 0);
		const c = BigInt(bytes[at + length - 1] ?? 0);
		const y = (a + (b << 8n)) & 0xffffffffn;
		const z = (len + (c << 2n)) & 0xffffffffn;
		return mul(shiftMix(mul(y, K2) ^ mul(z, K3)), K2);
	}
	return K2;
}

function hashLen17to32(bytes: Uint8Array, at: number, length: number): bigint {
	const a = mul(fetch64(bytes, at), K1);
	const b = fetch64(bytes, at + 8);
	const c = mul(fetch64(bytes, at + length - 8), K2);
	const d = mul(fetch64(bytes, at + length - 16), K0);
	return hashLen16(
		add(rotate(u64(a - b), 43), rotate(c, 30), d),
		u64(add(a, rotate(b ^ K3, 20)) - c + BigInt(length)),
	);
}

function weakHashLen32WithSeeds(
	w: bigint,
	x: bigint,
	y: bigint,
	z: bigint,
	seedA: bigint,
	seedB: bigint,
): [bigint, bigint] {
	let a = add(seedA, w);
	let b = rotate(add(seedB, a, z), 21);
	const c = a;
	a = add(a, x, y);
	b = add(b, rotate(a, 44));
	return [add(a, z), add(b, c)];
}

function weakHashAt(
	bytes: Uint8Array,
	at: number,
	a: bigint,
	b: bigint,
): [bigint, bigint] {
	return weakHashLen32WithSeeds(
		fetch64(bytes, at),
		fetch64(bytes, at + 8),
		fetch64(bytes, at + 16),
		fetch64(bytes, at + 24),
		a,
		b,
	);
}

function hashLen33to64(bytes: Uint8Array, at: number, length: number): bigint {
	const len = BigInt(length);
	let z = fetch64(bytes, at + 24);
	let a = add(
		fetch64(bytes, at),
		mul(add(len, fetch64(bytes, at + length - 16)), K0),
	);
	let b = rotate(add(a, z), 52);
	let c = rotate(a, 37);
	a = add(a, fetch64(bytes, at + 8));
	c = add(c, rotate(a, 7));
	a = add(a, fetch64(bytes, at + 16));
	const vf = add(a, z);
	const vs = add(b, rotate(a, 31), c);
	a = add(fetch64(bytes, at + 16), fetch64(bytes, at + length - 32));
	z = fetch64(bytes, at + length - 8);
	b = rotate(add(a, z), 52);
	c = rotate(a, 37);
	a = add(a, fetch64(bytes, at + length - 24));
	c = add(c, rotate(a, 7));
	a = add(a, fetch64(bytes, at + length - 16));
	const wf = add(a, z);
	const ws = add(b, rotate(a, 31), c);
	const r = shiftMix(add(mul(add(vf, ws), K2), mul(add(wf, vs), K0)));
	return mul(shiftMix(add(mul(r, K0), vs)), K2);
}

export function cityHash64(text: string): bigint {
	const bytes = new TextEncoder().encode(text);
	let length = bytes.length;
	if (length <= 16) return hashLen0to16(bytes, 0, length);
	if (length <= 32) return hashLen17to32(bytes, 0, length);
	if (length <= 64) return hashLen33to64(bytes, 0, length);
	const len = BigInt(length);
	let x = fetch64(bytes, 0);
	let y = fetch64(bytes, length - 16) ^ K1;
	let z = fetch64(bytes, length - 56) ^ K0;
	let v = weakHashAt(bytes, length - 64, len, y);
	let w = weakHashAt(bytes, length - 32, mul(len, K1), K0);
	z = add(z, mul(shiftMix(v[1]), K1));
	x = mul(rotate(add(z, x), 39), K1);
	y = mul(rotate(y, 33), K1);
	length = (length - 1) & ~63;
	let at = 0;
	do {
		x = mul(rotate(add(x, y, v[0], fetch64(bytes, at + 16)), 37), K1);
		y = mul(rotate(add(y, v[1], fetch64(bytes, at + 48)), 42), K1);
		x ^= w[1];
		y ^= v[0];
		z = rotate(z ^ w[0], 33);
		v = weakHashAt(bytes, at, mul(v[1], K1), add(x, w[0]));
		w = weakHashAt(bytes, at + 32, add(z, w[1]), y);
		[z, x] = [x, z];
		at += 64;
		length -= 64;
	} while (length !== 0);
	return hashLen16(
		add(hashLen16(v[0], w[0]), mul(shiftMix(y), K1), z),
		add(hashLen16(v[1], w[1]), x),
	);
}

const CRC32C_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let crc = index;
		for (let bit = 0; bit < 8; bit++)
			crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
		table[index] = crc >>> 0;
	}
	return table;
})();

function crc32c(crc: number, bytes: Uint8Array): number {
	let value = crc >>> 0;
	for (const byte of bytes)
		value = (CRC32C_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
	return value >>> 0;
}

const SHINGLE_SIZE = 3;
const MIN_WORD_BYTES = 4;

function isSeparator(byte: number): boolean {
	if (byte >= 0x80) return false;
	return !(
		(byte >= 0x30 && byte <= 0x39) ||
		(byte >= 0x41 && byte <= 0x5a) ||
		(byte >= 0x61 && byte <= 0x7a)
	);
}

function words(bytes: Uint8Array): Uint8Array[] {
	const found: Uint8Array[] = [];
	let at = 0;
	while (at < bytes.length) {
		while (at < bytes.length && isSeparator(bytes[at] ?? 0)) at++;
		const start = at;
		while (at < bytes.length && !isSeparator(bytes[at] ?? 0)) at++;
		if (at - start >= MIN_WORD_BYTES) found.push(bytes.subarray(start, at));
	}
	return found;
}

function shingleHash(shingle: readonly Uint8Array[], offset: number): number {
	let crc = 0xffffffff;
	for (let index = offset; index < shingle.length; index++)
		crc = crc32c(crc, shingle[index] as Uint8Array);
	for (let index = 0; index < offset; index++)
		crc = crc32c(crc, shingle[index] as Uint8Array);
	return crc;
}

export function wordShingleSimHashUTF8(text: string): number {
	const all = words(new TextEncoder().encode(text));
	if (all.length === 0) return 0;
	const finger = new Array<number>(32).fill(0);
	const update = (hash: number) => {
		for (let bit = 0; bit < 32; bit++)
			finger[bit] = (finger[bit] ?? 0) + ((hash >>> bit) & 1 ? 1 : -1);
	};
	const shingle = all.slice(0, SHINGLE_SIZE);
	let offset = 0;
	update(shingleHash(shingle, offset));
	for (const word of all.slice(SHINGLE_SIZE)) {
		shingle[offset] = word;
		offset = (offset + 1) % SHINGLE_SIZE;
		update(shingleHash(shingle, offset));
	}
	let result = 0;
	for (let bit = 0; bit < 32; bit++)
		if ((finger[bit] ?? 0) > 0) result |= 1 << bit;
	return result >>> 0;
}
