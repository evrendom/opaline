import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { deserialize, serialize } from "node:v8";
import { deflateRaw, inflateRaw } from "node:zlib";
import { SessionDetailTurnSchema } from "@rudel/api-routes";
import { isSelfHosted } from "../lib/self-hosted.js";
import {
	encodedSessionDetailBodies,
	restoreSessionDetailBodyStore,
} from "./session-detail-body-store.js";
import type { SessionDetailDerivation } from "./session-detail-derivation.service.js";
import type { SessionDetailDerivationCacheKey } from "./session-detail-derivation-cache.js";

type Environment = Readonly<Record<string, string | undefined>>;

const deflate = promisify(deflateRaw);
const inflate = promisify(inflateRaw);

const FORMAT = 1;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const PRUNE_EVERY_WRITES = 32;

let writesSincePrune = 0;

export function sessionDetailStoreDirectory(
	env: Environment = process.env,
): string | null {
	const dataDir = env.OPALINE_DATA_DIR?.trim();
	if (!isSelfHosted(env) || !dataDir || env.OPALINE_DETAIL_STORE === "0")
		return null;
	return join(dataDir, "session-detail");
}

function maxBytes(env: Environment): number {
	const value = Number(env.OPALINE_DETAIL_STORE_MAX_BYTES?.trim());
	return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}

function fileOf(
	directory: string,
	key: SessionDetailDerivationCacheKey,
): string {
	const digest = createHash("sha256")
		.update(
			JSON.stringify([
				FORMAT,
				key.organizationId,
				key.ownerId,
				key.source,
				key.sessionId,
				key.revision,
			]),
		)
		.digest("hex");
	return join(directory, digest.slice(0, 2), `${digest}.bin`);
}

export async function readStoredSessionDetail(
	key: SessionDetailDerivationCacheKey,
	env: Environment = process.env,
): Promise<SessionDetailDerivation | null> {
	const directory = sessionDetailStoreDirectory(env);
	if (!directory) return null;
	const path = fileOf(directory, key);
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch {
		return null;
	}
	try {
		const stored = deserialize(await inflate(bytes)) as {
			readonly format: number;
			readonly key: SessionDetailDerivationCacheKey;
			readonly derivation: Omit<SessionDetailDerivation, "turnBodies">;
			readonly turnBodies: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
		};
		if (
			stored.format !== FORMAT ||
			stored.key.revision !== key.revision ||
			stored.key.sessionId !== key.sessionId ||
			stored.key.organizationId !== key.organizationId ||
			stored.key.ownerId !== key.ownerId ||
			stored.key.source !== key.source
		)
			return null;
		const now = new Date();
		await utimes(path, now, now).catch(() => {});
		return {
			...stored.derivation,
			turnBodies: restoreSessionDetailBodyStore(stored.turnBodies, (value) =>
				SessionDetailTurnSchema.parse(value),
			),
		} as SessionDetailDerivation;
	} catch {
		await rm(path, { force: true }).catch(() => {});
		return null;
	}
}

export async function writeStoredSessionDetail(
	key: SessionDetailDerivationCacheKey,
	derivation: SessionDetailDerivation,
	env: Environment = process.env,
): Promise<boolean> {
	const directory = sessionDetailStoreDirectory(env);
	if (!directory) return false;
	const turnBodies = encodedSessionDetailBodies(derivation.turnBodies);
	if (!turnBodies) return false;
	const { turnBodies: _bodies, ...rest } = derivation;
	const path = fileOf(directory, key);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(
			temporary,
			await deflate(
				serialize({ format: FORMAT, key, derivation: rest, turnBodies }),
				{ level: 1 },
			),
		);
		await rename(temporary, path);
	} catch {
		await rm(temporary, { force: true }).catch(() => {});
		return false;
	}
	writesSincePrune += 1;
	if (writesSincePrune >= PRUNE_EVERY_WRITES) {
		writesSincePrune = 0;
		await pruneStoredSessionDetails(directory, maxBytes(env)).catch(() => {});
	}
	return true;
}

export async function pruneStoredSessionDetails(
	directory: string,
	limit: number,
): Promise<number> {
	const files: { path: string; bytes: number; usedAt: number }[] = [];
	for (const shard of await readdir(directory).catch(() => [] as string[])) {
		const shardPath = join(directory, shard);
		for (const name of await readdir(shardPath).catch(() => [] as string[])) {
			const path = join(shardPath, name);
			const found = await stat(path).catch(() => null);
			if (found?.isFile())
				files.push({ path, bytes: found.size, usedAt: found.mtimeMs });
		}
	}
	let total = files.reduce((sum, file) => sum + file.bytes, 0);
	let removed = 0;
	for (const file of files.sort((a, b) => a.usedAt - b.usedAt)) {
		if (total <= limit) break;
		await rm(file.path, { force: true });
		total -= file.bytes;
		removed += 1;
	}
	return removed;
}
