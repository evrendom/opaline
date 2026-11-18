import { oc } from "@orpc/contract";
import { z } from "zod";
import { RepositoryRunCallSchema } from "./repository-runs.js";
import { RepositoryInputSchema } from "./schemas/repositories.js";

export const REPORT_ELEMENT_LIMIT = 200;
export const REPORT_PATCHES_PER_CALL = 50;
export const REPORT_FIX_TEXT_LIMIT = 8000;

const ref = z.string().min(1).max(1000);
const line = z.number().int().positive();
const runRef = { runId: ref };

export const REPORT_KINDS = [
	"retro",
	"setup",
	"findability",
	"cost",
	"incident",
	"trend",
] as const;

const REFERENCES = [
	"Run",
	"RunCall",
	"Session",
	"File",
	"Skill",
	"McpServer",
	"PullRequest",
	"CiRun",
] as const;

const EVIDENCE = [
	"Measure",
	"Moment",
	"SetupLine",
	"Timeline",
	"Prose",
	...REFERENCES,
] as const;

export const REPORT_CATALOG = {
	Report: {
		description:
			"The root, one per report. It opens with one Prose that answers the question in one or two sentences, then at most one Measure, then the Problems, most costly first; an incident report holds a Timeline instead of Problems. Keep it short: three or four Problems at most.",
		props: z
			.object({
				title: z.string().min(1).max(120),
				kind: z.enum(REPORT_KINDS),
			})
			.strict(),
		children: ["Problem", ...EVIDENCE],
	},
	Problem: {
		description:
			"One problem of the repo's agent work, as one plain sentence a reader gets at a glance. Holds at most one Measure first, then two or three Moments that show it, the SetupLine that caused it if any, and the Fix last.",
		props: z
			.object({
				title: z.string().min(1).max(200),
				strength: z.enum(["strong", "some", "weak"]),
				step: ref.optional(),
			})
			.strict(),
		children: [...EVIDENCE, "Fix"],
	},
	Measure: {
		description:
			"Numbers from an sql result you ran (its sr_ id). number shows one value of `column`; table lists the rows by `columns`: what each row is (a prompt or name column, or run_id) then the one or two numbers that matter, never more than three, and only the first five rows show; trend shows `column` over the result's first column. Sort the result the way the reader should read it. Never write a number anywhere else.",
		props: z
			.object({
				result: z.string().regex(/^sr_[A-Za-z0-9_-]+$/u),
				shape: z.enum(["number", "table", "trend"]),
				column: z.string().min(1).max(200).optional(),
				columns: z.array(z.string().min(1).max(200)).max(3).optional(),
				label: z.string().min(1).max(120),
			})
			.strict(),
		children: [],
	},
	Moment: {
		description:
			"The exact point a problem shows: one call of a run, or the user's next prompt after it (the correction, the re-ask, the pasted error). `note` is one short sentence saying what happened there; it is all the reader sees until they open it.",
		props: z
			.object({
				...runRef,
				at: z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("call"), callId: ref }).strict(),
					z.object({ kind: z.literal("next_prompt") }).strict(),
				]),
				note: z.string().min(1).max(300),
			})
			.strict(),
		children: [],
	},
	SetupLine: {
		description:
			"Lines of a setup file (instruction, AGENTS.md, skill, MCP instructions) as one version of it read, from setup_files.",
		props: z
			.object({
				setupFile: ref,
				version: ref,
				from: line,
				to: line,
			})
			.strict(),
		children: [],
	},
	Fix: {
		description:
			"The change that prevents the problem: an edit of a setup file or a file of the repo, as the text before and after (before is empty for a new file), and why it helps.",
		props: z
			.object({
				target: z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("setup"), setupFile: ref }).strict(),
					z.object({ kind: z.literal("path"), path: ref }).strict(),
				]),
				before: z.string().max(REPORT_FIX_TEXT_LIMIT),
				after: z.string().min(1).max(REPORT_FIX_TEXT_LIMIT),
				why: z.string().min(1).max(500),
			})
			.strict(),
		children: [],
	},
	Timeline: {
		description:
			"One run's calls in order, for an incident: what it was asked, what it did, where it broke. `highlight` names the calls that matter.",
		props: z
			.object({
				...runRef,
				highlight: z.array(ref).max(20).optional(),
			})
			.strict(),
		children: ["Moment", "Prose"],
	},
	Prose: {
		description:
			"A sentence or two of markdown that ties the evidence next to it together. No numbers: those come from Measures.",
		props: z.object({ markdown: z.string().min(1).max(1200) }).strict(),
		children: [],
	},
	Run: {
		description: "One run of a session, with its prompt and what it touched.",
		props: z.object({ ...runRef }).strict(),
		children: [],
	},
	RunCall: {
		description:
			"One tool call of a run as Opaline shows it: an edit as its diff, a read as the lines read, a shell command with its output, a skill or MCP call with its input and output.",
		props: z.object({ ...runRef, callId: ref }).strict(),
		children: [],
	},
	Session: {
		description: "A session, as a row of the Sessions list.",
		props: z.object({ sessionId: ref }).strict(),
		children: [],
	},
	File: {
		description:
			"A file of the repo, with how many sessions changed or read it.",
		props: z.object({ path: ref }).strict(),
		children: [],
	},
	Skill: {
		description: "A skill the repo's sessions loaded, by its setup file id.",
		props: z.object({ setupFile: ref }).strict(),
		children: [],
	},
	McpServer: {
		description: "An MCP server the repo's sessions called.",
		props: z.object({ server: ref }).strict(),
		children: [],
	},
	PullRequest: {
		description: "A pull request of the repo, with its CI.",
		props: z.object({ node: ref }).strict(),
		children: [],
	},
	CiRun: {
		description: "One CI run of the repo.",
		props: z.object({ node: ref }).strict(),
		children: [],
	},
} as const satisfies Record<
	string,
	{
		description: string;
		props: z.ZodType;
		children: readonly string[];
	}
>;

export type ReportComponent = keyof typeof REPORT_CATALOG;

const componentNames = Object.keys(REPORT_CATALOG) as [
	ReportComponent,
	...ReportComponent[],
];

export const ReportElementSchema = z
	.object({
		type: z.enum(componentNames),
		props: z.record(z.string(), z.unknown()),
		children: z.array(ref).max(REPORT_ELEMENT_LIMIT),
	})
	.strict();

export const ReportSpecSchema = z
	.object({
		root: ref,
		elements: z.record(ref, ReportElementSchema),
	})
	.strict();

export const ReportPatchSchema = z
	.object({
		op: z.enum(["add", "replace", "remove"]),
		path: z.string().regex(/^\/(root|elements\/[^/]+)$/u),
		value: z.unknown().optional(),
	})
	.strict();

export const RepositoryReportInputSchema = z
	.object({
		analysis: ref,
		repoKey: ref,
		patches: z.array(ReportPatchSchema).min(1).max(REPORT_PATCHES_PER_CALL),
	})
	.strict();

export const ReportIssueSchema = z.object({
	element: z.string().nullable(),
	code: z.enum([
		"unknown_type",
		"invalid_props",
		"missing_root",
		"root_not_report",
		"dangling_child",
		"child_not_allowed",
		"shared_child",
		"unseen_reference",
		"too_many_elements",
	]),
	message: z.string(),
});

export const RepositoryReportResultSchema = z.object({
	elements: z.number().int().nonnegative(),
	issues: z.array(ReportIssueSchema),
});

export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportElement = z.infer<typeof ReportElementSchema>;
export type ReportSpec = z.infer<typeof ReportSpecSchema>;
export type ReportPatch = z.infer<typeof ReportPatchSchema>;
export type ReportIssue = z.infer<typeof ReportIssueSchema>;

export function reportIssues(spec: ReportSpec): ReportIssue[] {
	const issues: ReportIssue[] = [];
	const issue = (
		element: string | null,
		code: ReportIssue["code"],
		message: string,
	) => issues.push({ element, code, message });
	if (Object.keys(spec.elements).length > REPORT_ELEMENT_LIMIT)
		issue(
			null,
			"too_many_elements",
			`A report holds at most ${REPORT_ELEMENT_LIMIT} elements.`,
		);
	const root = spec.elements[spec.root];
	if (!root)
		issue(
			spec.root,
			"missing_root",
			`The root "${spec.root}" is not an element.`,
		);
	else if (root.type !== "Report")
		issue(spec.root, "root_not_report", "The root must be a Report.");
	const parentOf = new Map<string, string>();
	for (const [id, element] of Object.entries(spec.elements)) {
		const entry = REPORT_CATALOG[element.type];
		const props = entry.props.safeParse(element.props);
		if (!props.success)
			issue(
				id,
				"invalid_props",
				props.error.issues
					.map((each) => `${each.path.join(".") || "props"}: ${each.message}`)
					.join("; "),
			);
		const allowed: readonly string[] = entry.children;
		for (const child of element.children) {
			const target = spec.elements[child];
			if (!target) {
				issue(id, "dangling_child", `Child "${child}" is not an element.`);
				continue;
			}
			if (!allowed.includes(target.type))
				issue(
					id,
					"child_not_allowed",
					allowed.length === 0
						? `${element.type} takes no children.`
						: `${element.type} holds ${allowed.join(", ")}, not ${target.type}.`,
				);
			const parent = parentOf.get(child);
			if (parent && parent !== id)
				issue(
					child,
					"shared_child",
					`"${child}" sits under both "${parent}" and "${id}".`,
				);
			parentOf.set(child, id);
		}
	}
	return issues;
}

export function reportReferences(spec: ReportSpec): {
	results: string[];
	sessions: string[];
	runs: string[];
	calls: { runId: string; callId: string }[];
	setupFiles: string[];
	paths: string[];
	nodes: string[];
} {
	const results = new Set<string>();
	const sessions = new Set<string>();
	const runs = new Set<string>();
	const calls = new Map<string, { runId: string; callId: string }>();
	const setupFiles = new Set<string>();
	const paths = new Set<string>();
	const nodes = new Set<string>();
	for (const element of Object.values(spec.elements)) {
		const props = element.props as Record<string, unknown>;
		const text = (value: unknown) => (typeof value === "string" ? value : null);
		const runId = text(props.runId);
		if (runId) runs.add(runId);
		const at = props.at as Record<string, unknown> | undefined;
		const callId = text(props.callId) ?? text(at?.callId);
		if (runId && callId) calls.set(`${runId} ${callId}`, { runId, callId });
		const sessionId = text(props.sessionId);
		if (sessionId) sessions.add(sessionId);
		const result = text(props.result);
		if (result) results.add(result);
		const target = props.target as Record<string, unknown> | undefined;
		for (const setupFile of [text(props.setupFile), text(target?.setupFile)])
			if (setupFile) setupFiles.add(setupFile);
		for (const path of [text(props.path), text(target?.path)])
			if (path) paths.add(path);
		const node = text(props.node);
		if (node) nodes.add(node);
	}
	return {
		results: [...results],
		sessions: [...sessions],
		runs: [...runs],
		calls: [...calls.values()],
		setupFiles: [...setupFiles],
		paths: [...paths],
		nodes: [...nodes],
	};
}

export type ParsedRunId = {
	userId: string;
	source: string;
	sessionId: string;
	agentId: string;
	startRecord: number;
};

export function parseRunId(runId: string): ParsedRunId | null {
	const parts = runId.split("/").map((part) => {
		try {
			return decodeURIComponent(part);
		} catch {
			return part;
		}
	});
	if (parts.length !== 5) return null;
	const [userId, source, sessionId, agentId, start] = parts as [
		string,
		string,
		string,
		string,
		string,
	];
	const startRecord = Number(start);
	if (!sessionId || !Number.isInteger(startRecord) || startRecord < 0)
		return null;
	return { userId, source, sessionId, agentId, startRecord };
}

export const REPORT_EVIDENCE_LIMIT = 100;

export const ReportRunsInputSchema = RepositoryInputSchema.extend({
	runIds: z.array(ref).min(1).max(REPORT_EVIDENCE_LIMIT),
}).strict();

export const ReportRunSchema = z.object({
	runId: z.string(),
	sessionId: z.string(),
	agentId: z.string(),
	startRecord: z.number().int().nonnegative(),
	turn: z.number().int().nonnegative(),
	turnId: z.string().nullable(),
	startedAt: z.string(),
	prompt: z.string().nullable(),
	nextPrompt: z.string().nullable(),
});

export const ReportCallsInputSchema = RepositoryInputSchema.extend({
	calls: z
		.array(z.object({ runId: ref, callId: ref }).strict())
		.min(1)
		.max(REPORT_EVIDENCE_LIMIT),
}).strict();

export const ReportCallSchema = RepositoryRunCallSchema.extend({
	runId: z.string(),
});

export const repositoryReportContract = {
	reportRuns: oc
		.input(ReportRunsInputSchema)
		.output(z.object({ runs: z.array(ReportRunSchema) })),
	reportCalls: oc
		.input(ReportCallsInputSchema)
		.output(z.object({ calls: z.array(ReportCallSchema) })),
};

export type ReportRun = z.infer<typeof ReportRunSchema>;
export type ReportCall = z.infer<typeof ReportCallSchema>;
