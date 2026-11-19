import { queryClickhouse } from "../clickhouse.js";
import { isSelfHosted } from "../lib/self-hosted.js";

const MAX_ENTRIES = 64;
const MAX_AGE_MS = 5 * 60_000;
const VERSION_REUSE_MS = 250;

export const DATA_VERSION_QUERY =
	"SELECT toString(groupBitXor(cityHash64(table, name))) AS parts, toString(count()) AS count FROM system.parts WHERE database = 'rudel' AND active";

interface Entry {
	readonly version: string;
	readonly at: number;
	readonly value: Promise<unknown>;
}

export interface ReadCache {
	read<T>(scope: string, input: unknown, compute: () => Promise<T>): Promise<T>;
	clear(): void;
}

export function createReadCache(options: {
	readonly version: () => Promise<string>;
	readonly now?: () => number;
	readonly maxEntries?: number;
	readonly maxAgeMs?: number;
}): ReadCache {
	const now = options.now ?? Date.now;
	const maxEntries = options.maxEntries ?? MAX_ENTRIES;
	const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
	const entries = new Map<string, Entry>();
	let probe: { at: number; version: Promise<string> } | undefined;

	const currentVersion = () => {
		if (!probe || now() - probe.at > VERSION_REUSE_MS) {
			const version = options.version();
			probe = { at: now(), version };
			version.catch(() => {
				if (probe?.version === version) probe = undefined;
			});
		}
		return probe.version;
	};

	return {
		async read<T>(scope: string, input: unknown, compute: () => Promise<T>) {
			let version: string;
			try {
				version = await currentVersion();
			} catch {
				return compute();
			}
			const key = `${scope}\u0000${JSON.stringify(input)}`;
			const hit = entries.get(key);
			if (hit && hit.version === version && now() - hit.at < maxAgeMs) {
				entries.delete(key);
				entries.set(key, hit);
				return hit.value as Promise<T>;
			}
			const value = compute();
			entries.delete(key);
			entries.set(key, { version, at: now(), value });
			value.catch(() => {
				if (entries.get(key)?.value === value) entries.delete(key);
			});
			while (entries.size > maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
			return value;
		},
		clear() {
			entries.clear();
			probe = undefined;
		},
	};
}

async function readDataVersion(): Promise<string> {
	const [row] = await queryClickhouse<{ parts: string; count: string }>({
		clickhouse_settings: { log_comment: "selfhost.read_cache.version" },
		query: DATA_VERSION_QUERY,
	});
	if (!row) throw new Error("system.parts returned no row");
	return `${row.parts}:${row.count}`;
}

let shared: ReadCache | undefined;

export function selfHostedRead<T>(
	scope: string,
	input: unknown,
	compute: () => Promise<T>,
): Promise<T> {
	if (!isSelfHosted()) return compute();
	shared ??= createReadCache({ version: readDataVersion });
	return shared.read(scope, input, compute);
}
