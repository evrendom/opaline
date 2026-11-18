import {
	closeSync,
	createReadStream,
	mkdirSync,
	openSync,
	writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";

const BLOCK = 512;

export interface TarExtractOptions {
	readonly prefix: string;
	readonly destination: string;
}

export interface TarExtractResult {
	readonly files: number;
	readonly bytes: number;
}

interface PendingFile {
	readonly fd: number | undefined;
	remaining: number;
	padding: number;
	readonly kind: "file" | "pax" | "longname" | "skip";
	readonly chunks: Buffer[];
}

export async function extractTarGz(
	archive: string,
	options: TarExtractOptions,
): Promise<TarExtractResult> {
	const destination = resolve(options.destination);
	mkdirSync(destination, { recursive: true, mode: 0o755 });
	let buffer: Buffer = Buffer.alloc(0);
	let pending: PendingFile | undefined;
	let nextPath: string | undefined;
	let zeroBlocks = 0;
	let ended = false;
	let files = 0;
	let bytes = 0;

	const finishMeta = (entry: PendingFile) => {
		const data = Buffer.concat(entry.chunks).toString("utf8");
		if (entry.kind === "longname") nextPath = data.replace(/\0+$/u, "");
		if (entry.kind === "pax") {
			const path = readPaxPath(data);
			if (path !== undefined) nextPath = path;
		}
	};

	const consume = () => {
		for (;;) {
			if (ended) return;
			if (pending) {
				if (pending.remaining > 0) {
					if (buffer.length === 0) return;
					const take = Math.min(pending.remaining, buffer.length);
					const slice = buffer.subarray(0, take);
					if (pending.fd !== undefined) writeAll(pending.fd, slice);
					else if (pending.kind !== "skip")
						pending.chunks.push(Buffer.from(slice));
					pending.remaining -= take;
					buffer = buffer.subarray(take);
					if (pending.remaining > 0) return;
				}
				if (pending.padding > 0) {
					const take = Math.min(pending.padding, buffer.length);
					pending.padding -= take;
					buffer = buffer.subarray(take);
					if (pending.padding > 0) return;
				}
				if (pending.fd !== undefined) closeSync(pending.fd);
				if (pending.kind === "pax" || pending.kind === "longname")
					finishMeta(pending);
				pending = undefined;
			}
			if (buffer.length < BLOCK) return;
			const header = buffer.subarray(0, BLOCK);
			buffer = buffer.subarray(BLOCK);
			if (header.every((byte) => byte === 0)) {
				zeroBlocks++;
				if (zeroBlocks >= 2) ended = true;
				continue;
			}
			zeroBlocks = 0;
			const entry = parseHeader(header);
			const size = entry.size;
			const padding = (BLOCK - (size % BLOCK)) % BLOCK;
			if (entry.type === "x" || entry.type === "L") {
				pending = {
					fd: undefined,
					remaining: size,
					padding,
					kind: entry.type === "x" ? "pax" : "longname",
					chunks: [],
				};
				continue;
			}
			if (entry.type === "g") {
				pending = {
					fd: undefined,
					remaining: size,
					padding,
					kind: "skip",
					chunks: [],
				};
				continue;
			}
			const name = nextPath ?? entry.name;
			nextPath = undefined;
			const relativePath = stripPrefix(name, options.prefix);
			if (entry.type === "5") {
				if (relativePath)
					mkdirSync(insideDestination(destination, relativePath), {
						recursive: true,
						mode: 0o755,
					});
				pending = {
					fd: undefined,
					remaining: size,
					padding,
					kind: "skip",
					chunks: [],
				};
				continue;
			}
			if (entry.type !== "0" && entry.type !== "\0" && entry.type !== "7")
				throw new Error(
					`Refusing ${describeType(entry.type)} ${JSON.stringify(name)} in the archive: only regular files are allowed.`,
				);
			if (!relativePath)
				throw new Error(`Refusing archive entry ${JSON.stringify(name)}.`);
			const target = insideDestination(destination, relativePath);
			mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
			const fd = openSync(target, "w", entry.mode & 0o111 ? 0o755 : 0o644);
			files++;
			bytes += size;
			pending = { fd, remaining: size, padding, kind: "file", chunks: [] };
		}
	};

	try {
		const gunzip = createGunzip();
		const input = createReadStream(archive).pipe(gunzip);
		for await (const chunk of input) {
			buffer =
				buffer.length === 0
					? (chunk as Buffer)
					: Buffer.concat([buffer, chunk as Buffer]);
			consume();
			if (ended) {
				input.destroy();
				break;
			}
		}
	} finally {
		if (pending?.fd !== undefined) closeSync(pending.fd);
	}
	if (pending) throw new Error(`${archive} is truncated.`);
	if (!ended && files === 0)
		throw new Error(`${archive} is not a tar.gz archive.`);
	return { files, bytes };
}

interface Header {
	readonly name: string;
	readonly mode: number;
	readonly size: number;
	readonly type: string;
}

function parseHeader(header: Buffer): Header {
	const stored = readOctal(header.subarray(148, 156));
	let sum = 0;
	for (let index = 0; index < BLOCK; index++)
		sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
	if (stored !== sum)
		throw new Error("The archive has a corrupt tar header (bad checksum).");
	const name = readString(header.subarray(0, 100));
	const magic = readString(header.subarray(257, 263));
	const prefix = magic.startsWith("ustar")
		? readString(header.subarray(345, 500))
		: "";
	const sizeField = header.subarray(124, 136);
	if (((sizeField[0] ?? 0) & 0x80) !== 0)
		throw new Error("The archive has an entry too large to extract.");
	return {
		name: prefix ? `${prefix}/${name}` : name,
		mode: readOctal(header.subarray(100, 108)),
		size: readOctal(sizeField),
		type: String.fromCharCode(header[156] ?? 0),
	};
}

function readString(field: Buffer): string {
	const end = field.indexOf(0);
	return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function readOctal(field: Buffer): number {
	const text = readString(field).trim();
	if (!text) return 0;
	if (!/^[0-7]+$/u.test(text))
		throw new Error("The archive has a corrupt tar header.");
	return Number.parseInt(text, 8);
}

function readPaxPath(data: string): string | undefined {
	let path: string | undefined;
	let offset = 0;
	while (offset < data.length) {
		const space = data.indexOf(" ", offset);
		if (space === -1) break;
		const length = Number.parseInt(data.slice(offset, space), 10);
		if (!Number.isInteger(length) || length <= 0) break;
		const record = data.slice(space + 1, offset + length - 1);
		const equals = record.indexOf("=");
		if (equals !== -1 && record.slice(0, equals) === "path")
			path = record.slice(equals + 1);
		offset += length;
	}
	return path;
}

function stripPrefix(name: string, prefix: string): string {
	if (name.includes("\0") || name.includes("\\") || isAbsolute(name))
		throw new Error(`Refusing archive path ${JSON.stringify(name)}.`);
	const normalized = posix.normalize(name);
	if (
		normalized === ".." ||
		normalized.startsWith("../") ||
		name.split("/").includes("..")
	)
		throw new Error(`Refusing archive path ${JSON.stringify(name)}.`);
	const base = prefix.replace(/\/+$/u, "");
	if (normalized === base || normalized === `${base}/`) return "";
	if (!normalized.startsWith(`${base}/`))
		throw new Error(
			`Refusing archive path ${JSON.stringify(name)}: everything must be under ${base}/.`,
		);
	return normalized.slice(base.length + 1).replace(/\/+$/u, "");
}

function insideDestination(destination: string, relativePath: string): string {
	const target = resolve(join(destination, relativePath));
	if (!target.startsWith(`${destination}${sep}`))
		throw new Error(
			`Refusing archive path outside the destination: ${relativePath}`,
		);
	return target;
}

function writeAll(fd: number, data: Buffer): void {
	let offset = 0;
	while (offset < data.length)
		offset += writeSync(fd, data, offset, data.length - offset);
}

function describeType(type: string): string {
	if (type === "1") return "the hard link";
	if (type === "2") return "the symlink";
	if (type === "3" || type === "4") return "the device";
	if (type === "6") return "the FIFO";
	return `the entry of type ${JSON.stringify(type)}`;
}
