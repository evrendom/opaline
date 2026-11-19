import { createHash } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
	type WriteStream,
} from "node:fs";
import { join } from "node:path";

export interface DownloadAsset {
	readonly id: string;
	readonly url: string;
	readonly size?: number;
	readonly integrity: string;
}

export interface DownloadProgress {
	readonly received: number;
	readonly total: number;
	readonly resumedFrom: number;
}

export interface DownloadOptions {
	readonly cacheDir: string;
	readonly label: string;
	readonly onProgress?: (progress: DownloadProgress) => void;
	readonly fetchImpl?: typeof fetch;
	readonly idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export function getCachedAssetPath(cacheDir: string, asset: DownloadAsset) {
	return join(cacheDir, asset.id);
}

export async function ensureVerifiedDownload(
	asset: DownloadAsset,
	options: DownloadOptions,
): Promise<string> {
	mkdirSync(options.cacheDir, { recursive: true, mode: 0o700 });
	const target = getCachedAssetPath(options.cacheDir, asset);
	if (existsSync(target)) {
		if (await isVerified(target, asset)) return target;
		rmSync(target, { force: true });
	}
	const partial = `${target}.partial`;
	await downloadToPartial(asset, partial, options, true);
	const size = statSync(partial).size;
	if (asset.size !== undefined && size !== asset.size) {
		rmSync(partial, { force: true });
		throw new Error(
			`${options.label} download is ${size} bytes, expected ${asset.size}. Removed it; run the command again.`,
		);
	}
	if (!(await matchesIntegrity(partial, asset.integrity))) {
		rmSync(partial, { force: true });
		throw new Error(
			`${options.label} download does not match its published checksum (${asset.integrity.split("-")[0]}). Removed it; run the command again.`,
		);
	}
	renameSync(partial, target);
	return target;
}

export async function isVerified(
	path: string,
	asset: DownloadAsset,
): Promise<boolean> {
	return (
		(asset.size === undefined || statSync(path).size === asset.size) &&
		(await matchesIntegrity(path, asset.integrity))
	);
}

export async function matchesIntegrity(
	path: string,
	integrity: string,
): Promise<boolean> {
	const separator = integrity.indexOf("-");
	const algorithm = integrity.slice(0, separator);
	if (algorithm !== "sha256" && algorithm !== "sha512")
		throw new Error(`Unsupported checksum algorithm ${algorithm}`);
	const hash = createHash(algorithm);
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("base64") === integrity.slice(separator + 1);
}

async function downloadToPartial(
	asset: DownloadAsset,
	partial: string,
	options: DownloadOptions,
	mayRestart: boolean,
): Promise<void> {
	let offset = existsSync(partial) ? statSync(partial).size : 0;
	if (asset.size === undefined || offset > asset.size) {
		rmSync(partial, { force: true });
		offset = 0;
	}
	if (offset === asset.size) return;
	const controller = new AbortController();
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	let idle = setTimeout(() => controller.abort(), idleTimeoutMs);
	try {
		const response = await (options.fetchImpl ?? fetch)(asset.url, {
			headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
			signal: controller.signal,
			redirect: "follow",
		});
		if (offset > 0 && response.status === 416 && mayRestart) {
			await response.body?.cancel();
			rmSync(partial, { force: true });
			clearTimeout(idle);
			return downloadToPartial(asset, partial, options, false);
		}
		if (!response.ok || !response.body)
			throw new Error(
				`${options.label} download failed: HTTP ${response.status} from ${new URL(asset.url).host}`,
			);
		if (offset > 0 && response.status !== 206) offset = 0;
		const file = createWriteStream(partial, {
			flags: offset > 0 ? "a" : "w",
			mode: 0o600,
		});
		let received = offset;
		const resumedFrom = offset;
		const total =
			asset.size ?? (Number(response.headers.get("content-length")) || 0);
		try {
			const reader = response.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				clearTimeout(idle);
				idle = setTimeout(() => controller.abort(), idleTimeoutMs);
				await writeChunk(file, value);
				received += value.byteLength;
				options.onProgress?.({ received, total, resumedFrom });
			}
		} finally {
			await closeStream(file);
		}
	} catch (error) {
		if (controller.signal.aborted)
			throw new Error(
				`${options.label} download stalled for ${Math.round(idleTimeoutMs / 1000)} s. Run the command again to resume it.`,
			);
		throw error;
	} finally {
		clearTimeout(idle);
	}
}

function writeChunk(file: WriteStream, chunk: Uint8Array): Promise<void> {
	return new Promise((resolve, reject) => {
		file.write(chunk, (error) => (error ? reject(error) : resolve()));
	});
}

function closeStream(file: WriteStream): Promise<void> {
	return new Promise((resolve, reject) => {
		file.end((error?: Error | null) => (error ? reject(error) : resolve()));
	});
}

export function createProgressLine(
	label: string,
	stream: NodeJS.WriteStream = process.stderr,
): {
	update: (progress: DownloadProgress) => void;
	finish: () => void;
} {
	const interactive = stream.isTTY === true;
	let lastStep = -1;
	let lastDraw = 0;
	let drawn = false;
	return {
		update({ received, total, resumedFrom }) {
			const percent =
				total > 0 ? Math.floor((received / total) * 100) : undefined;
			const text =
				percent === undefined
					? `${label}: ${formatMiB(received)} MiB`
					: `${label}: ${percent}% (${formatMiB(received)} of ${formatMiB(total)} MiB${resumedFrom > 0 ? `, resumed at ${formatMiB(resumedFrom)} MiB` : ""})`;
			if (interactive) {
				const now = Date.now();
				if (now - lastDraw < 100 && (total === 0 || received < total)) return;
				lastDraw = now;
				stream.write(`\r${text}\u001b[K`);
				drawn = true;
				return;
			}
			const step =
				percent === undefined
					? Math.floor(received / (16 * 1024 * 1024))
					: Math.floor(percent / 25);
			if (step === lastStep) return;
			lastStep = step;
			stream.write(`${text}\n`);
		},
		finish() {
			if (interactive && drawn) stream.write("\n");
		},
	};
}

function formatMiB(bytes: number): string {
	return (bytes / 1024 / 1024).toFixed(0);
}
