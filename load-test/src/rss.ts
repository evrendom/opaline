export interface ProcessRssPeak {
	readonly peakBytes: number;
	readonly pid: number;
}

export interface RssSummary {
	readonly measured: boolean;
	readonly peakTotalBytes: number | null;
	readonly processes: readonly ProcessRssPeak[];
	readonly sampleCount: number;
}

export interface RssMonitor {
	readonly stop: () => Promise<RssSummary>;
}

export function startRssMonitor(
	pids: readonly number[],
	intervalMs = 250,
): RssMonitor {
	if (pids.length === 0) {
		return {
			stop: async () => ({
				measured: false,
				peakTotalBytes: null,
				processes: [],
				sampleCount: 0,
			}),
		};
	}
	for (const pid of pids) {
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error("Processing PIDs must be positive integers");
		}
	}

	let stopped = false;
	let peakTotalBytes = 0;
	let sampleCount = 0;
	const peaks = new Map(pids.map((pid) => [pid, 0]));
	const observedPids = new Set<number>();
	const sampling = sampleUntilStopped();

	return {
		async stop() {
			stopped = true;
			await sampling;
			const measured = pids.every((pid) => observedPids.has(pid));
			return {
				measured,
				peakTotalBytes: measured ? peakTotalBytes : null,
				processes: pids.map((pid) => ({
					peakBytes: peaks.get(pid) ?? 0,
					pid,
				})),
				sampleCount,
			};
		},
	};

	async function sampleUntilStopped(): Promise<void> {
		while (!stopped) {
			const samples = await Promise.all(pids.map(readProcessRssBytes));
			const observed = samples.filter(
				(value): value is number => value !== null,
			);
			if (observed.length > 0) {
				sampleCount += 1;
				let total = 0;
				for (let index = 0; index < samples.length; index += 1) {
					const sample = samples[index];
					const pid = pids[index];
					if (sample === null || sample === undefined || pid === undefined) {
						continue;
					}
					total += sample;
					observedPids.add(pid);
					peaks.set(pid, Math.max(peaks.get(pid) ?? 0, sample));
				}
				peakTotalBytes = Math.max(peakTotalBytes, total);
			}
			if (!stopped) await Bun.sleep(intervalMs);
		}
	}
}

async function readProcessRssBytes(pid: number): Promise<number | null> {
	const process = Bun.spawn(["ps", "-o", "rss=", "-p", pid.toString()], {
		stderr: "ignore",
		stdout: "pipe",
	});
	const output = await new Response(process.stdout).text();
	const exitCode = await process.exited;
	if (exitCode !== 0) return null;
	const kibibytes = Number(output.trim());
	return Number.isFinite(kibibytes) && kibibytes >= 0 ? kibibytes * 1024 : null;
}
