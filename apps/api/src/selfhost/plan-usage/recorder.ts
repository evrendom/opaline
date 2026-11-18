import type { PlanProbe, ProbeOutcome } from "./probes.js";
import type { PlanProvider, PlanSample } from "./readings.js";
import type { PlanAsk, SampleStore } from "./sample-store.js";

const MINUTE = 60_000;
export const ACTIVE_SAMPLE_MS = 5 * MINUTE;
export const IDLE_SAMPLE_MS = 30 * MINUTE;
const TICK_MS = MINUTE;

export interface RecorderOptions {
	readonly store: SampleStore;
	readonly probes: readonly PlanProbe[];
	readonly agentsActive: () => boolean;
	readonly now?: () => number;
	readonly tickMs?: number;
}

export interface PlanUsageRecorder {
	readonly store: SampleStore;
	errors(): Readonly<Partial<Record<PlanProvider, string>>>;
	checkedAt(): string | null;
	sampleNow(): Promise<void>;
	stop(): void;
}

function withoutProbeSession(response: unknown): unknown {
	if (typeof response !== "object" || response === null) return response;
	const { session: _session, ...rest } = response as Record<string, unknown>;
	return rest;
}

export function startPlanUsageRecorder(
	options: RecorderOptions,
): PlanUsageRecorder {
	const now = options.now ?? Date.now;
	const errors: Partial<Record<PlanProvider, string>> = {};
	let lastAt = 0;
	const lastAnswer = new Map<PlanProvider, string>();
	let running: Promise<void> | null = null;

	const sample = async () => {
		const at = new Date(now()).toISOString();
		lastAt = now();
		const outcomes: ProbeOutcome[] = await Promise.all(
			options.probes.map((probe) => probe()),
		);
		const samples: PlanSample[] = [];
		const asks = outcomes.map((outcome): PlanAsk => {
			const error = "error" in outcome ? outcome.error : null;
			const response = outcome.response ?? null;
			const key = JSON.stringify([error, withoutProbeSession(response)]);
			if (lastAnswer.get(outcome.provider) === key)
				return {
					kind: "ask",
					at,
					provider: outcome.provider,
					error,
					unchanged: true,
				};
			lastAnswer.set(outcome.provider, key);
			return { kind: "ask", at, provider: outcome.provider, error, response };
		});
		for (const outcome of outcomes) {
			if ("error" in outcome) {
				errors[outcome.provider] = outcome.error;
				continue;
			}
			delete errors[outcome.provider];
			for (const reading of outcome.readings) samples.push({ at, ...reading });
		}
		await options.store.append(samples, asks);
	};
	const sampleNow = () => {
		running ??= sample()
			.catch(() => {})
			.finally(() => {
				running = null;
			});
		return running;
	};
	const tick = () => {
		const every = options.agentsActive() ? ACTIVE_SAMPLE_MS : IDLE_SAMPLE_MS;
		if (now() - lastAt >= every) void sampleNow();
	};
	const timer = setInterval(tick, options.tickMs ?? TICK_MS);
	timer.unref?.();
	tick();
	return {
		store: options.store,
		errors: () => errors,
		checkedAt: () => (lastAt ? new Date(lastAt).toISOString() : null),
		sampleNow,
		stop: () => clearInterval(timer),
	};
}
