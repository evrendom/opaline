import { oc } from "@orpc/contract";
import { z } from "zod";

export const SessionRunCiInputSchema = z
	.object({ sessionId: z.string().min(1).max(200) })
	.strict();

export const RunCiLinkSchema = z.enum(["exact", "pr_window"]);

export const RunCiJobSchema = z.object({
	jobId: z.string(),
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	createdAt: z.string().nullable(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	runnerName: z.string(),
});

export const RunCiRunSchema = z.object({
	ciRunId: z.string(),
	githubRunId: z.string(),
	attempt: z.number().int(),
	repository: z.string(),
	workflowName: z.string(),
	event: z.string(),
	headBranch: z.string(),
	headSha: z.string(),
	conclusion: z.string().nullable(),
	createdAt: z.string(),
	link: RunCiLinkSchema,
	relations: z.array(z.string()),
	pullRequests: z.array(z.number().int()),
	jobs: z.array(RunCiJobSchema),
});

export const SessionRunCiRunSchema = z.object({
	agentId: z.string(),
	turn: z.number().int(),
	startedAt: z.string(),
	ci: z.array(RunCiRunSchema),
});

export const SessionRunCiSchema = z.object({
	enabled: z.boolean(),
	runs: z.array(SessionRunCiRunSchema),
});

export const sessionRunCiContract = {
	runCi: oc.input(SessionRunCiInputSchema).output(SessionRunCiSchema),
};

export type RunCiLink = z.infer<typeof RunCiLinkSchema>;
export type RunCiJob = z.infer<typeof RunCiJobSchema>;
export type RunCiRun = z.infer<typeof RunCiRunSchema>;
export type SessionRunCiRun = z.infer<typeof SessionRunCiRunSchema>;
export type SessionRunCi = z.infer<typeof SessionRunCiSchema>;

export type RunCiByTurnStart = ReadonlyMap<number, readonly RunCiRun[]>;

const NO_CI: readonly RunCiRun[] = [];

export function runCiStartedAt(startedMs: number): string {
	return new Date(startedMs).toISOString();
}

export function runCiStartKey(
	startedAt: string | null | undefined,
): number | null {
	const at = startedAt ? Date.parse(startedAt) : Number.NaN;
	return Number.isFinite(at) ? at : null;
}

export function runCiByTurnStart(
	runs: readonly SessionRunCiRun[],
): RunCiByTurnStart {
	const byStart = new Map<number, readonly RunCiRun[]>();
	for (const run of runs) {
		if (run.agentId !== "") continue;
		const at = runCiStartKey(run.startedAt);
		if (at !== null) byStart.set(at, run.ci);
	}
	return byStart;
}

export function turnRunCi(
	byStart: RunCiByTurnStart,
	turn: { readonly startedAt: string | null },
): readonly RunCiRun[] {
	const at = runCiStartKey(turn.startedAt);
	return (at === null ? undefined : byStart.get(at)) ?? NO_CI;
}
