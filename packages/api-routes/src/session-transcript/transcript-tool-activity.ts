import { z } from "zod";
import { getCodexOperationMetadata } from "./codex-activity-graph.js";
import {
	classifyShellCommandActivities,
	getRawToolInput,
	getTranscriptToolFileActivities,
	readWebActions,
	translateCodexToolCall,
} from "./codex-tool-translation.js";

const ActivityKindSchema = z.enum([
	"skill",
	"reading",
	"searching",
	"editing",
	"writing",
	"viewing",
	"executing",
	"planning",
	"delegating",
	"web-research",
	"interacting",
	"external",
	"unmapped",
]);

export const TranscriptToolActivitySchema = z
	.object({
		kind: ActivityKindSchema,
		verb: z.string(),
		label: z.string().optional(),
		actions: z.array(
			z
				.object({
					kind: ActivityKindSchema,
					verb: z.string(),
					targets: z.array(z.string()),
				})
				.strict(),
		),
		files: z.array(
			z
				.object({
					operation: z.enum(["created", "deleted", "edited", "read", "viewed"]),
					path: z.string(),
				})
				.strict(),
		),
		skills: z.array(z.string()),
		status: z.enum(["failed", "succeeded", "unrecorded"]),
		sharedResultId: z.string().optional(),
	})
	.strict();

export type TranscriptToolActivity = z.infer<
	typeof TranscriptToolActivitySchema
>;
type Action = TranscriptToolActivity["actions"][number];

/** One semantic description per actual tool call, shared by the API, cards and counts. */
export function deriveTranscriptToolActivity(event: {
	toolName: string;
	input: Readonly<Record<string, unknown>>;
	provider?: "claude" | "codex";
	result?: { isError: boolean };
}): TranscriptToolActivity {
	const input = getRawToolInput(event.input);
	const name =
		event.toolName.split(/\.|__/u).at(-1)?.toLowerCase() ?? event.toolName;
	const codex =
		event.provider === "codex" ||
		(event.provider !== "claude" &&
			getCodexOperationMetadata(event.input) !== undefined);
	const translation = codex
		? translateCodexToolCall(event.toolName, event.input)
		: undefined;
	const command =
		translation?.command ??
		(name === "bash" ? string(input.command) : undefined);
	const actions = command
		? translation?.activity === "reading"
			? translation.files.map(
					(file): Action => ({
						kind: skillName(file.path) ? "skill" : "reading",
						verb: skillName(file.path) ? "Loaded skill" : "Read",
						targets: [file.path],
					}),
				)
			: shellActions(command)
		: codex && translation?.activity === "web-research"
			? readWebActions(input).map(
					(action): Action => ({
						kind: "web-research",
						verb: action.verb,
						targets: action.target ? [action.target] : [],
					}),
				)
			: [
					translation
						? {
								kind: translation.activity,
								verb: translation.verb,
								targets:
									translation.files.length > 0
										? translation.files.map((file) => file.path)
										: translation.primaryLabel
											? [translation.primaryLabel]
											: [],
							}
						: nativeAction(name, input),
				];
	const files =
		event.result?.isError || translation?.success === false
			? []
			: command && translation?.activity !== "reading"
				? classifyShellCommandActivities(command).flatMap((part) =>
						part.files.map((file) => ({
							operation: "read" as const,
							path: file.path,
						})),
					)
				: [
						...getTranscriptToolFileActivities(
							event.toolName,
							event.input,
							event.provider,
						),
					];
	const skills = [
		...new Set(
			actions
				.filter((action) => action.kind === "skill")
				.flatMap((action) =>
					action.targets.map((target) => skillName(target) ?? target),
				),
		),
	];
	const hasSkills = skills.length > 0;
	const primary = actions[0] ?? {
		kind: "unmapped" as const,
		verb: "Used",
		targets: [],
	};
	const kind = hasSkills ? "skill" : (translation?.activity ?? primary.kind);
	const label = hasSkills
		? skills.join(", ")
		: (translation?.primaryLabel ??
			(primary.targets.length > 1
				? `${primary.targets.length} files`
				: primary.targets[0]));
	const metadata = getCodexOperationMetadata(event.input);
	return {
		kind,
		verb: hasSkills
			? name === "skill"
				? "Used skill"
				: "Loaded skill"
			: (translation?.verb ?? primary.verb),
		...(label ? { label } : {}),
		actions,
		files,
		skills,
		status:
			event.result?.isError || translation?.success === false
				? "failed"
				: event.result || translation?.success === true
					? "succeeded"
					: "unrecorded",
		...(metadata?.carrierId && metadata.hasSharedOutput
			? { sharedResultId: `batch:${metadata.carrierId}` }
			: {}),
	};
}

function shellActions(command: string): Action[] {
	return classifyShellCommandActivities(command).flatMap((part): Action[] => {
		if (part.activity === "reading") {
			return part.files.map((file) => ({
				kind: skillName(file.path) ? "skill" : "reading",
				verb: skillName(file.path) ? "Loaded skill" : "Read",
				targets: [file.path],
			}));
		}
		return [
			{
				kind: part.activity,
				verb: part.activity === "searching" ? "Searched" : "Ran",
				targets: [part.command],
			},
		];
	});
}

function nativeAction(
	name: string,
	input: Readonly<Record<string, unknown>>,
): Action {
	const path =
		string(input.file_path) ??
		string(input.notebook_path) ??
		string(input.path);
	if (name === "skill")
		return {
			kind: "skill",
			verb: "Used skill",
			targets: [string(input.skill) ?? string(input.command) ?? "Skill"],
		};
	if (name === "read" && path)
		return {
			kind: skillName(path) ? "skill" : "reading",
			verb: skillName(path) ? "Loaded skill" : "Read",
			targets: [path],
		};
	if (["edit", "multiedit", "notebookedit", "write"].includes(name))
		return {
			kind: name === "write" ? "writing" : "editing",
			verb: name === "write" ? "Wrote" : "Edited",
			targets: path ? [path] : [],
		};
	if (name === "grep" || name === "glob")
		return {
			kind: "searching",
			verb: "Searched",
			targets: [string(input.pattern) ?? ""],
		};
	if (name === "webfetch" || name === "websearch")
		return {
			kind: "web-research",
			verb: name === "webfetch" ? "Opened" : "Searched",
			targets: [string(input.url) ?? string(input.query) ?? ""],
		};
	if (name === "agent" || name === "task")
		return {
			kind: "delegating",
			verb: "Delegated",
			targets: [
				string(input.description) ?? string(input.subagent_type) ?? "Agent",
			],
		};
	if (name === "todowrite")
		return { kind: "planning", verb: "Updated todos", targets: [] };
	return { kind: "external", verb: "Used", targets: [name] };
}

function skillName(path: string): string | undefined {
	return /(?:^|\/)([^/]+)\/SKILL(?:\.md)?$/iu.exec(
		path.replaceAll("\\", "/"),
	)?.[1];
}

function string(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}
