import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type RunVersion, runKey } from "./answers.js";
import type { AskedQuestion } from "./provider.js";

/**
 * The token estimate_questions returns and run_questions requires
 * (docs/retro-architecture.md "Run questions"): signed by the server, it binds
 * the caller, the workspace, the provider, the question versions (id, wording, criteria),
 * the exact runs selected (with the transcript revision of each) and the
 * estimated cost, for a few minutes. run_questions selects the runs again and
 * refuses when anything differs or the cost would be higher, so nothing is
 * bought that the caller did not see priced.
 */

export const ESTIMATE_TOKEN_TTL_MS = 15 * 60_000;
/** Float noise allowed when comparing a cost with the estimated ceiling. */
const COST_EPSILON_USD = 1e-9;

export interface EstimateBinding {
	readonly userId: string;
	readonly workspaceId: string;
	/** The provider that would answer. */
	readonly provider: string;
	readonly questions: readonly AskedQuestion[];
	readonly runs: readonly RunVersion[];
	/** At most what the answers to buy cost. */
	readonly costUsd: number;
}

interface Payload {
	readonly v: 1;
	readonly user: string;
	readonly workspace: string;
	readonly provider: string;
	readonly questions: string;
	readonly runs: string;
	readonly costUsd: number;
	readonly expiresAt: number;
}

export function signEstimate(
	key: string,
	binding: EstimateBinding,
	now = Date.now(),
): { token: string; expiresAt: string } {
	const payload: Payload = {
		v: 1,
		user: binding.userId,
		workspace: binding.workspaceId,
		provider: binding.provider,
		questions: questionsDigest(binding.questions),
		runs: runsDigest(binding.runs),
		costUsd: binding.costUsd,
		expiresAt: now + ESTIMATE_TOKEN_TTL_MS,
	};
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return {
		token: `${body}.${signature(key, body)}`,
		expiresAt: new Date(payload.expiresAt).toISOString(),
	};
}

/** Why the token does not cover this run_questions call, or null when it does. */
export function estimateMismatch(
	key: string,
	token: string,
	binding: EstimateBinding,
	now = Date.now(),
): string | null {
	const payload = verified(key, token);
	if (!payload)
		return "The estimate token is not one estimate_questions issued.";
	if (payload.expiresAt <= now) return "The estimate token has expired.";
	if (
		payload.user !== binding.userId ||
		payload.workspace !== binding.workspaceId
	)
		return "The estimate was made by another caller or in another workspace.";
	if (payload.provider !== binding.provider)
		return "Another provider answers now than when the estimate was made.";
	if (payload.questions !== questionsDigest(binding.questions))
		return "The questions differ from the estimate's.";
	if (payload.runs !== runsDigest(binding.runs))
		return "The runs selected now differ from the estimate's (the query, or the runs it selects, changed).";
	if (binding.costUsd > payload.costUsd + COST_EPSILON_USD)
		return `This would cost up to $${binding.costUsd.toFixed(4)}, more than the estimated $${payload.costUsd.toFixed(4)}.`;
	return null;
}

function verified(key: string, token: string): Payload | null {
	const [body, mac, ...rest] = token.split(".");
	if (!body || !mac || rest.length > 0) return null;
	const expected = Buffer.from(signature(key, body));
	const given = Buffer.from(mac);
	if (given.length !== expected.length || !timingSafeEqual(given, expected))
		return null;
	try {
		const payload = JSON.parse(
			Buffer.from(body, "base64url").toString("utf8"),
		) as Payload;
		return payload.v === 1 ? payload : null;
	} catch {
		return null;
	}
}

function signature(key: string, body: string): string {
	return createHmac("sha256", key)
		.update(`run-questions-estimate:${body}`)
		.digest("base64url");
}

function questionsDigest(questions: readonly AskedQuestion[]): string {
	return digest(
		[...questions]
			.map((question) =>
				JSON.stringify([
					question.id,
					question.question,
					question.criteria?.true ?? null,
					question.criteria?.false ?? null,
				]),
			)
			.sort(),
	);
}

function runsDigest(runs: readonly RunVersion[]): string {
	return digest(runs.map((run) => `${runKey(run)}@${run.revision}`).sort());
}

function digest(lines: readonly string[]): string {
	return createHash("sha256").update(lines.join("\n")).digest("base64url");
}
