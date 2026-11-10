import { getLogger } from "@logtape/logtape";
import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { readBooleanEnv } from "../../lib/env.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import {
	materializeSessionCallCommands,
	materializeSessionsCallCommands,
	storedCallCommandsEnabled,
} from "../analysis/call-commands.js";
import {
	loadGitHubAccessForEdges,
	postgresGitHubSource,
} from "../analysis/github-access.js";
import { timedIngestPhase } from "../ingest-phase-timings.js";
import { writeSessionContextSnapshot } from "../session-context-snapshot.service.js";
import { runL1EdgePass } from "./l1-edge-reconciliation.service.js";

const logger = getLogger(["rudel", "api", "l1-edges"]);
const SELF_HOSTED_L1_CONCURRENCY = 6;
const SELF_HOSTED_RUN_INDEX_CLAIMS = 48;
const SNAPSHOTS_AT_ONCE = 2;

/** Whether this deployment builds L1 edges; requests are queued either way. */
export function isL1EdgeWorkerEnabled(): boolean {
	return isSelfHosted() || readBooleanEnv("L1_EDGES_WORKER_ENABLED", false);
}

interface BuiltSession {
	organizationId: string;
	userId: string;
	source: string;
	sessionId: string;
}

/** One budgeted pass over due edge scopes with the production sources. */
export function runConfiguredL1EdgePass(budgetMs: number): Promise<number> {
	const selfHosted = isSelfHosted();
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs,
		concurrency: selfHosted ? SELF_HOSTED_L1_CONCURRENCY : 1,
		sources: {
			executor: getClickhouse(),
			access: loadGitHubAccessForEdges,
			evidence: postgresGitHubSource.evidence,
		},
		afterRunIndexBuilt: (session) =>
			Promise.all([
				writeSessionContextSnapshot(getClickhouse(), session),
				storedCallCommandsEnabled()
					? timedIngestPhase("jobs.call_commands", () =>
							materializeSessionCallCommands(getClickhouse(), session),
						)
					: undefined,
			]),
		runIndexBatch:
			selfHosted && process.env.OPALINE_RUN_INDEX_BATCH !== "0"
				? {
						claimLimit: SELF_HOSTED_RUN_INDEX_CLAIMS,
						afterBuilt: afterRunIndexBatchBuilt,
					}
				: undefined,
	});
}

async function afterRunIndexBatchBuilt(
	sessions: readonly BuiltSession[],
): Promise<void> {
	const members = new Map<string, BuiltSession[]>();
	for (const session of sessions) {
		const key = `${session.organizationId}\u0000${session.userId}`;
		const list = members.get(key);
		if (list) list.push(session);
		else members.set(key, [session]);
	}
	const commands = storedCallCommandsEnabled()
		? timedIngestPhase("jobs.call_commands", async () => {
				for (const member of members.values()) {
					const [first] = member;
					if (!first) continue;
					await materializeSessionsCallCommands(
						getClickhouse(),
						{ organizationId: first.organizationId, userId: first.userId },
						member.map((session) => session.sessionId),
					);
				}
			})
		: Promise.resolve();
	let next = 0;
	const snapshots = Promise.all(
		Array.from(
			{ length: Math.min(SNAPSHOTS_AT_ONCE, sessions.length) },
			async () => {
				while (next < sessions.length) {
					const session = sessions[next++];
					if (session)
						await writeSessionContextSnapshot(getClickhouse(), session).catch(
							(error: unknown) =>
								logger.warn(
									"Context snapshot of {sessionId} after its run index: {error}",
									{
										sessionId: session.sessionId,
										error:
											error instanceof Error ? error.message : String(error),
									},
								),
						);
				}
			},
		),
	);
	await Promise.all([commands, snapshots]);
}
