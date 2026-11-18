import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PlanSample } from "./readings.js";

export interface PlanAsk {
	readonly kind: "ask";
	readonly at: string;
	readonly provider: string;
	readonly error: string | null;
	readonly response?: unknown;
	readonly unchanged?: true;
}

export interface SampleStore {
	all(): Promise<readonly PlanSample[]>;
	append(
		samples: readonly PlanSample[],
		asks?: readonly PlanAsk[],
	): Promise<void>;
}

function parse(line: string): PlanSample | null {
	try {
		const value = JSON.parse(line) as Partial<PlanSample>;
		return typeof value.at === "string" &&
			typeof value.provider === "string" &&
			typeof value.window === "string" &&
			typeof value.usedPercent === "number"
			? (value as PlanSample)
			: null;
	} catch {
		return null;
	}
}

export function fileSampleStore(path: string): SampleStore {
	let loaded: PlanSample[] | null = null;
	const load = async () => {
		if (loaded) return loaded;
		const text = await readFile(path, "utf8").catch(() => "");
		loaded = text
			.split("\n")
			.map((line) => (line.trim() ? parse(line) : null))
			.filter((sample): sample is PlanSample => sample !== null);
		return loaded;
	};
	return {
		all: load,
		async append(samples, asks = []) {
			if (samples.length === 0 && asks.length === 0) return;
			const current = await load();
			await mkdir(dirname(path), { recursive: true });
			await appendFile(
				path,
				[...asks, ...samples]
					.map((line) => `${JSON.stringify(line)}\n`)
					.join(""),
			);
			current.push(...samples);
		},
	};
}

export function memorySampleStore(
	initial: readonly PlanSample[] = [],
): SampleStore {
	const samples = [...initial];
	return {
		async all() {
			return samples;
		},
		async append(more) {
			samples.push(...more);
		},
	};
}
