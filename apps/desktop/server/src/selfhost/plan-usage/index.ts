import { join } from "node:path";
import { claudeProbe, codexProbe } from "./probes.js";
import { type PlanUsageRecorder, startPlanUsageRecorder } from "./recorder.js";
import { fileSampleStore } from "./sample-store.js";

type Environment = Readonly<Record<string, string | undefined>>;

const ACTIVITY_MS = 10 * 60_000;

let current: PlanUsageRecorder | null = null;
let lastActivity = 0;

export function getPlanUsage(): PlanUsageRecorder | null {
	return current;
}

export function markAgentActivity(at = Date.now()): void {
	lastActivity = Math.max(lastActivity, at);
}

export function isPlanUsageEnabled(
	env: Environment,
	desktop: boolean,
): boolean {
	if (env.OPALINE_PLAN_USAGE === "0") return false;
	return desktop || env.OPALINE_PLAN_USAGE === "1";
}

export function startPlanUsage(options: {
	readonly dataDir: string;
	readonly env?: Environment;
}): PlanUsageRecorder {
	const env = options.env ?? process.env;
	current?.stop();
	current = startPlanUsageRecorder({
		store: fileSampleStore(join(options.dataDir, "plan-usage.jsonl")),
		probes: [claudeProbe(env), codexProbe(env)],
		agentsActive: () => Date.now() - lastActivity < ACTIVITY_MS,
	});
	return current;
}
