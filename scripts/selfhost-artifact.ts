import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const BLOCK = 512;
const NPM_EPOCH_SECONDS = Date.UTC(1985, 9, 26, 8, 15) / 1000;

export interface ArchiveFile {
	readonly path: string;
	readonly bytes: Uint8Array;
}

export async function listFiles(directory: string): Promise<string[]> {
	const files: string[] = [];
	const walk = async (current: string) => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) files.push(relative(directory, path));
			else throw new Error(`${path} is neither a file nor a directory`);
		}
	};
	await walk(directory);
	return files.map((file) => file.split(sep).join("/")).sort();
}

export async function packDirectory(
	directory: string,
	prefix = "package",
): Promise<Uint8Array> {
	const files = await listFiles(directory);
	return gzipSync(
		createTar(
			await Promise.all(
				files.map(async (path) => ({
					path: `${prefix}/${path}`,
					bytes: new Uint8Array(await readFile(join(directory, path))),
				})),
			),
		),
		{ level: 9 },
	);
}

export function createTar(files: readonly ArchiveFile[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
		chunks.push(header(file.path, file.bytes.length));
		chunks.push(file.bytes);
		const padding = (BLOCK - (file.bytes.length % BLOCK)) % BLOCK;
		if (padding) chunks.push(new Uint8Array(padding));
	}
	chunks.push(new Uint8Array(BLOCK * 2));
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const tar = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		tar.set(chunk, offset);
		offset += chunk.length;
	}
	return tar;
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function header(path: string, size: number): Uint8Array {
	const block = new Uint8Array(BLOCK);
	const { name, prefix } = splitPath(path);
	const write = (offset: number, length: number, value: string) => {
		const bytes = new TextEncoder().encode(value);
		if (bytes.length > length)
			throw new Error(`tar field too long for ${path}`);
		block.set(bytes, offset);
	};
	const octal = (offset: number, length: number, value: number) =>
		write(offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
	write(0, 100, name);
	octal(100, 8, 0o644);
	octal(108, 8, 0);
	octal(116, 8, 0);
	octal(124, 12, size);
	octal(136, 12, NPM_EPOCH_SECONDS);
	write(148, 8, "        ");
	write(156, 1, "0");
	write(257, 6, "ustar\0");
	write(263, 2, "00");
	write(345, 155, prefix);
	const checksum = block.reduce((sum, byte) => sum + byte, 0);
	write(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
	return block;
}

function splitPath(path: string): { name: string; prefix: string } {
	if (
		path.startsWith("/") ||
		path.split("/").some((part) => part === "" || part === "..")
	)
		throw new Error(`refusing to archive ${JSON.stringify(path)}`);
	const length = new TextEncoder().encode(path).length;
	if (length <= 100) return { name: path, prefix: "" };
	for (let index = path.indexOf("/"); index !== -1; ) {
		const prefix = path.slice(0, index);
		const name = path.slice(index + 1);
		if (
			new TextEncoder().encode(prefix).length <= 155 &&
			new TextEncoder().encode(name).length <= 100
		)
			return { name, prefix };
		index = path.indexOf("/", index + 1);
	}
	throw new Error(`path too long for a ustar archive: ${path}`);
}

export function digests(bytes: Uint8Array): {
	sha256: string;
	integrity: string;
} {
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
	};
}

const RELATIVE_URL =
	/new URL\(\s*(["'`])(\.{1,2}\/[^"'`$]+)\1\s*,\s*import\.meta\.url\s*\)/gu;

export function relativeUrlReferences(source: string): string[] {
	return [
		...new Set([...source.matchAll(RELATIVE_URL)].map((match) => match[2])),
	]
		.filter((path): path is string => Boolean(path))
		.sort();
}

export interface ReferenceCheck {
	readonly missing: string[];
	readonly shims: { path: string; target: string }[];
}

export function checkReferences(
	bundleDir: string,
	references: readonly string[],
	exists: (path: string) => boolean = existsSync,
): ReferenceCheck {
	const missing: string[] = [];
	const shims: { path: string; target: string }[] = [];
	for (const reference of references) {
		const path = resolve(bundleDir, reference);
		if (exists(path)) continue;
		const bundled = path.replace(/\.tsx?$/u, ".js");
		if (bundled !== path && exists(bundled)) {
			shims.push({ path, target: `./${relative(dirname(path), bundled)}` });
			continue;
		}
		missing.push(reference);
	}
	return { missing, shims };
}

export function inlineScripts(html: string): string[] {
	return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
		.filter((match) => {
			const attributes = match[1] ?? "";
			return (
				Boolean(match[2]?.trim()) &&
				!/\bsrc\s*=/iu.test(attributes) &&
				!/\btype\s*=\s*["']application\//iu.test(attributes)
			);
		})
		.map((match) => match[0].slice(0, 80));
}
