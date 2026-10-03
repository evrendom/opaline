import { getLogger } from "@logtape/logtape";
import { purgeAnalysisLog } from "./analysis-log.service.js";
import { createConvexAnalysisStore } from "./convex-store.js";
import { parseSigningKey } from "./convex-token.js";
import { createLocalEmbedder, createOpenAiEmbedder } from "./embedder.js";
import { createMemoryAnalysisStore } from "./memory-store.js";
import type { AnalysisLog, AnalysisStore } from "./types.js";

const logger = getLogger(["rudel", "api", "analysis-log"]);

/**
 * One deadline for an account or workspace purge of the analysis log, HTTP
 * calls included; the durable purge retries what is left.
 */
const PURGE_BUDGET_MS = 60_000;

let configured: AnalysisLog | null | undefined;

/**
 * The analysis log for one workspace. Capture and history run only for the
 * workspaces listed in `ANALYSIS_LOG_WORKSPACES` (comma-separated ids; empty
 * or missing means nobody), and only with a configured store:
 * `ANALYSIS_LOG_STORE` = `memory` keeps analyses in process, embedded with
 * OpenAI when `OPENAI_API_KEY` is set and local word vectors otherwise;
 * `convex` uses the Convex deployment at `CONVEX_URL`, authenticated with
 * `ANALYSIS_LOG_SIGNING_KEY`, and always OpenAI, because its vectors persist.
 */
export function getAnalysisLog(workspaceId: string): AnalysisLog | null {
	return listsWorkspace("ANALYSIS_LOG_WORKSPACES", workspaceId)
		? configuredAnalysisLog()
		: null;
}

/**
 * Whether the workspace opted into restricting stored results that read other
 * members' sessions to admins and the sessions' own member
 * (`ANALYSIS_LOG_RESTRICTED_WORKSPACES`, comma-separated ids; empty or missing
 * means nobody, so a shared analysis shows its results to the workspace).
 */
export function restrictsAnalysisResults(workspaceId: string): boolean {
	return listsWorkspace("ANALYSIS_LOG_RESTRICTED_WORKSPACES", workspaceId);
}

function listsWorkspace(variable: string, workspaceId: string): boolean {
	const workspaces = (process.env[variable] ?? "")
		.split(",")
		.map((id) => id.trim());
	return workspaceId !== "" && workspaces.includes(workspaceId);
}

/**
 * Removes the target's analyses (for an account, also every analysis that
 * read its sessions) from every store that may hold them, in any workspace,
 * within one deadline.
 */
export async function purgeAnalysisLogs(target: {
	targetType: "organization" | "account";
	targetId: string;
}): Promise<void> {
	const signal = AbortSignal.timeout(PURGE_BUDGET_MS);
	for (const store of analysisPurgeStores(signal))
		await purgeAnalysisLog(store, target, signal);
}

/**
 * Cleanup does not depend on capture: the Convex deployment is purged
 * whenever `CONVEX_URL` is set, whatever `ANALYSIS_LOG_STORE` says, and the
 * in-process store when capture uses memory. `ANALYSIS_LOG_PURGE_BACKENDS`
 * is the operator's durable statement of which backends may hold analyses:
 * a declared backend without working configuration throws, as does a
 * deployment without a valid signing key, so the durable purge retries
 * instead of finding nothing to delete.
 */
export function analysisPurgeStores(signal: AbortSignal): AnalysisStore[] {
	const stores: AnalysisStore[] = [];
	const url = process.env.CONVEX_URL?.trim();
	const declared = purgeBackends();
	if (declared.error) throw new Error(declared.error);
	if (declared.backends.includes("convex") && !url)
		throw new Error(
			"ANALYSIS_LOG_PURGE_BACKENDS declares convex but CONVEX_URL is not set; analyses in Convex cannot be purged",
		);
	if (url) {
		const signingKey = parseSigningKey(
			process.env.ANALYSIS_LOG_SIGNING_KEY ?? "",
		);
		if (!signingKey)
			throw new Error(
				"CONVEX_URL is set but ANALYSIS_LOG_SIGNING_KEY is not an ES256 JWK; analyses in Convex cannot be purged",
			);
		stores.push(createConvexAnalysisStore({ url, signingKey, signal }));
	}
	const log = configuredAnalysisLog();
	if (process.env.ANALYSIS_LOG_STORE === "memory" && log)
		stores.push(log.store);
	return stores;
}

/**
 * Backends that may hold analyses (comma-separated `ANALYSIS_LOG_PURGE_BACKENDS`;
 * only `convex` persists), or an error for any other name. Capture and
 * cleanup read it the same way; removing one is a decommission step (README).
 */
function purgeBackends(): { backends: string[]; error: string | null } {
	const backends = (process.env.ANALYSIS_LOG_PURGE_BACKENDS ?? "")
		.split(",")
		.map((backend) => backend.trim())
		.filter(Boolean);
	const unknown = backends.find((backend) => backend !== "convex");
	return {
		backends,
		error:
			unknown === undefined
				? null
				: `ANALYSIS_LOG_PURGE_BACKENDS names ${JSON.stringify(unknown)}; only convex can hold analyses`,
	};
}

function configuredAnalysisLog(): AnalysisLog | null {
	if (configured === undefined) configured = configuredLog();
	return configured;
}

/** Test seam: use the given log (or none) until reset. */
export function setAnalysisLogForTests(
	log: AnalysisLog | null | undefined,
): void {
	configured = log;
}

function configuredLog(): AnalysisLog | null {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	const now = () => new Date();
	if (process.env.ANALYSIS_LOG_STORE === "memory")
		return {
			store: createMemoryAnalysisStore(),
			embedder: apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder(),
			now,
		};
	if (process.env.ANALYSIS_LOG_STORE !== "convex") return null;
	const url = process.env.CONVEX_URL?.trim();
	const signingKey = parseSigningKey(
		process.env.ANALYSIS_LOG_SIGNING_KEY ?? "",
	);
	// Capture only into a backend the purge is told about and accepts, so
	// losing CONVEX_URL later fails purges instead of skipping the analyses.
	const declared = purgeBackends();
	if (declared.error) {
		logger.error("Analysis log capture is off: {error}", {
			error: declared.error,
		});
		return null;
	}
	if (!url || !signingKey || !apiKey || !declared.backends.includes("convex")) {
		logger.error(
			"Analysis log capture is off: ANALYSIS_LOG_STORE=convex requires CONVEX_URL, an ES256 JWK in ANALYSIS_LOG_SIGNING_KEY, OPENAI_API_KEY and convex in ANALYSIS_LOG_PURGE_BACKENDS",
		);
		return null;
	}
	return {
		store: createConvexAnalysisStore({ url, signingKey, signal: undefined }),
		embedder: createOpenAiEmbedder(apiKey),
		now,
	};
}
