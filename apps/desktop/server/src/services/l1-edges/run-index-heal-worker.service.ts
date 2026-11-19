import type { RunIndexHealStatus } from "@rudel/api-routes";
import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { withPostgresLease } from "../postgres-lease.service.js";
import {
	decideHealThrottle,
	logRunIndexHealTick,
	type RunIndexHealTickResult,
	readRunIndexHealConfig,
	readRunIndexHealStatus,
	runRunIndexHealTick,
	skippedRunIndexHealTick,
} from "./run-index-heal.service.js";
import { createReparser } from "./run-index-heal-reparse.service.js";

const LEASE_NAME = "run-index-heal";
const LEASE_TTL_MS = 120_000;

export async function runConfiguredRunIndexHealTick(
	budgetMs: number,
): Promise<RunIndexHealTickResult> {
	const config = readRunIndexHealConfig();
	const early = decideHealThrottle(config, null);
	if (early) {
		const result = skippedRunIndexHealTick(early);
		logRunIndexHealTick(result);
		return result;
	}
	const deadlineAt = Date.now() + budgetMs;
	const outcome = await withPostgresLease(
		LEASE_NAME,
		(lease) => {
			const executor = getClickhouse();
			return runRunIndexHealTick({
				sql: sqlClient,
				executor,
				config,
				deadline: { deadlineAt, now: Date.now },
				reparser: config.reparse
					? createReparser({ executor, sql: sqlClient })
					: undefined,
				signal: lease.signal,
			});
		},
		{ database: sqlClient, ttlMs: LEASE_TTL_MS },
	);
	const result =
		outcome.status === "busy"
			? skippedRunIndexHealTick("busy")
			: outcome.result;
	logRunIndexHealTick(result);
	return result;
}

export function readConfiguredRunIndexHealStatus(): Promise<RunIndexHealStatus> {
	return readRunIndexHealStatus({
		sql: sqlClient,
		executor: getClickhouse(),
		config: readRunIndexHealConfig(),
	});
}
