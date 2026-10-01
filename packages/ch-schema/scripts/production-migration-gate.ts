import { spawnSync } from "node:child_process";

export type ProductionMigrationDecision =
	| { readonly action: "migrate" }
	| { readonly action: "skip"; readonly reason: string };

// During a ClickHouse outage an operator can let exactly one confirmed commit
// deploy without its ClickHouse forward migrations, after checking that the
// commit changes no ClickHouse schema. Everything else runs the migrations,
// which keep failing the build while ClickHouse is unreachable.
export function decideProductionMigration(input: {
	readonly clickHouseReachable: boolean;
	readonly confirmedSha: string | undefined;
	readonly deploySha: string | undefined;
}): ProductionMigrationDecision {
	const confirmed =
		isFullSha(input.confirmedSha) && input.confirmedSha === input.deploySha;
	if (!confirmed || input.clickHouseReachable) return { action: "migrate" };
	return {
		action: "skip",
		reason: `ClickHouse is unreachable; skipping production ClickHouse migrations for operator-confirmed commit ${input.deploySha}.`,
	};
}

function isFullSha(value: string | undefined): value is string {
	return value !== undefined && /^[0-9a-f]{40}$/u.test(value);
}

async function isClickHouseReachable(
	url: string | undefined,
): Promise<boolean> {
	if (!url) return false;
	try {
		const response = await fetch(new URL("/ping", url), {
			signal: AbortSignal.timeout(5_000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

function runStep(step: string): void {
	const result = spawnSync("bun", ["run", step], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (import.meta.main) {
	const steps = process.argv.slice(2);
	if (steps.length === 0) throw new Error("No migration steps were given.");
	const confirmedSha = process.env.CH_MIGRATE_SKIP_CONFIRMED_SHA?.trim();
	const decision = decideProductionMigration({
		clickHouseReachable: confirmedSha
			? await isClickHouseReachable(process.env.CLICKHOUSE_URL)
			: true,
		confirmedSha,
		deploySha: process.env.CH_DEPLOY_SHA?.trim(),
	});
	if (decision.action === "skip") {
		console.warn(`WARNING: ${decision.reason}`);
		process.exit(0);
	}
	for (const step of steps) runStep(step);
}
