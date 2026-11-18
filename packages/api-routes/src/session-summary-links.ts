import { oc } from "@orpc/contract";
import { z } from "zod";

export const SessionSummaryLinksInputSchema = z
	.object({ sessionId: z.string().min(1).max(200) })
	.strict();

export const SessionSetupFileSchema = z.object({
	setupFile: z.string(),
	kind: z.string(),
	scope: z.string(),
	owner: z.string(),
	path: z.string(),
	versions: z.number().int().nonnegative(),
	runs: z.number().int().nonnegative(),
	subagents: z.boolean(),
	chars: z.number().int().nonnegative(),
	firstAt: z.string(),
});

export const SessionPullRequestSchema = z.object({
	repository: z.string(),
	number: z.number().int().positive(),
	relations: z.array(z.string()),
	title: z.string().nullable(),
	state: z.string().nullable(),
	draft: z.boolean().nullable(),
	mergedAt: z.string().nullable(),
	headRef: z.string().nullable(),
	authorLogin: z.string().nullable(),
});

export const SessionSummaryLinksSchema = z.object({
	setup: z.array(SessionSetupFileSchema),
	pullRequests: z.array(SessionPullRequestSchema),
});

export const SessionSetupTextInputSchema = z
	.object({
		sessionId: z.string().min(1).max(200),
		setupFile: z.string().min(1).max(2000),
	})
	.strict();

export const SessionSetupTextVersionSchema = z.object({
	version: z.string(),
	versionName: z.string(),
	text: z.string(),
	textCut: z.boolean(),
	chars: z.number().int().nonnegative(),
	runs: z.number().int().nonnegative(),
	firstAt: z.string(),
});

export const SESSION_SETUP_TEXT_VERSION_LIMIT = 24;

export const SessionSetupTextSchema = z.object({
	versions: z.array(SessionSetupTextVersionSchema),
});

export const SessionSetupRunSchema = z.object({
	agentId: z.string(),
	startedAt: z.string(),
	setupFile: z.string(),
	version: z.string(),
	versionName: z.string(),
	carried: z.boolean(),
	compacted: z.boolean(),
});

export const SessionSetupRunsSchema = z.object({
	runs: z.array(SessionSetupRunSchema),
});

export const sessionSummaryLinksContract = {
	summaryLinks: oc
		.input(SessionSummaryLinksInputSchema)
		.output(SessionSummaryLinksSchema),
	setupText: oc
		.input(SessionSetupTextInputSchema)
		.output(SessionSetupTextSchema),
	setupRuns: oc
		.input(SessionSummaryLinksInputSchema)
		.output(SessionSetupRunsSchema),
};

export type SessionSetupFile = z.infer<typeof SessionSetupFileSchema>;
export type SessionPullRequest = z.infer<typeof SessionPullRequestSchema>;
export type SessionSummaryLinks = z.infer<typeof SessionSummaryLinksSchema>;
export type SessionSetupText = z.infer<typeof SessionSetupTextSchema>;
export type SessionSetupRun = z.infer<typeof SessionSetupRunSchema>;
export type SessionSetupRuns = z.infer<typeof SessionSetupRunsSchema>;
export type SessionSetupTextVersion = z.infer<
	typeof SessionSetupTextVersionSchema
>;
