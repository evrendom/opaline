import {
	type CodexToolTranslation,
	deriveTranscriptToolActivity,
	getCodexOperationMetadata,
	getRawToolInput,
	readTranscriptToolOutputText,
	type TranscriptToolActivity,
} from "@rudel/api-routes";
import { useState } from "react";
import { CodeBlock } from "./CodeBlock";
import type { ToolIconName } from "./conversation-tools";
import type { TraceToolResult } from "./conversation-trace";
import { TraceIcon } from "./conversation-trace-icons";
import { TraceResultBody } from "./conversation-trace-result-body";
import { CONVERSATION_TOOL_ICONS } from "./conversation-trace-tool-icons";
import { MessageContent } from "./MessageContent";

type Props = {
	input: Record<string, unknown>;
	result: TraceToolResult | undefined;
	toolName: string;
	translation: CodexToolTranslation;
	activity?: TranscriptToolActivity;
};

export function CodexToolCallBody(props: Props) {
	const { input, result, toolName, translation } = props;
	const activity =
		props.activity ??
		deriveTranscriptToolActivity({
			input,
			result,
			toolName,
			provider: "codex",
		});
	const rawInput = getRawToolInput(input);
	const agentMessage =
		translation.activity === "delegating"
			? [rawInput.message, rawInput.prompt].find(
					(value): value is string =>
						typeof value === "string" && value.length > 0,
				)
			: undefined;
	const showActions =
		activity.actions.length > 1 ||
		!["executing", "planning", "editing", "writing"].includes(activity.kind);
	const text = result
		? readTranscriptToolOutputText(result.content)
		: undefined;
	const file = activity.files.length === 1 ? activity.files[0] : undefined;
	const readableFile =
		file?.operation === "read" &&
		activity.actions.length === 1 &&
		text !== undefined &&
		!result?.isError;
	return (
		<div
			className="grid gap-3"
			data-trace-codex-details
			data-trace-activity-kind={activity.kind}
		>
			{activity.status === "failed" ? (
				<p className="text-[0.8125rem] text-[color:var(--dashboardy-danger-foreground)]">
					Call failed
					{translation.exitCode !== undefined
						? ` · Exit ${translation.exitCode}`
						: ""}
				</p>
			) : null}
			{showActions ? <ActivityTargets activity={activity} /> : null}
			{agentMessage ? <MessageContent content={agentMessage} /> : null}
			{translation.activity === "planning" ? (
				<PlanBody translation={translation} />
			) : null}
			{translation.resolvedToolName === "apply_patch" ? (
				<PatchBody translation={translation} />
			) : null}
			{translation.command && activity.kind === "executing" ? (
				<CodeBlock
					code={translation.command}
					filename="Command"
					language="bash"
				/>
			) : null}
			{translation.script !== undefined ? (
				<CodeBlock
					code={translation.script}
					filename={`Script · ${toolName}`}
					language="javascript"
					showLineNumbers
				/>
			) : null}
			{readableFile ||
			(activity.kind === "skill" && text !== undefined && !result?.isError) ? (
				<CodeBlock
					code={text}
					filename={readableFile ? file.path : "Skill output"}
					language={activity.kind === "skill" ? "markdown" : undefined}
					showLineNumbers
				/>
			) : result ? (
				<TraceResultBody
					result={text !== undefined ? { ...result, content: text } : result}
				/>
			) : activity.sharedResultId ? (
				<p className="text-[0.8125rem] text-[color:var(--dashboardy-muted)]">
					Output is shared with other calls below.
				</p>
			) : (
				<p className="text-[0.8125rem] text-[color:var(--dashboardy-muted)]">
					No result recorded for this call.
				</p>
			)}
			<RawToolDetails input={input} result={result} toolName={toolName} />
		</div>
	);
}

function ActivityTargets({ activity }: { activity: TranscriptToolActivity }) {
	return (
		<ul aria-label="Tool actions" className="grid gap-2">
			{keyActions(activity.actions).map(({ action, key }) => (
				<li
					className="flex min-w-0 items-start gap-2 text-[0.8125rem] leading-5"
					data-trace-activity-kind={action.kind}
					key={key}
				>
					<TraceIcon
						icon={CONVERSATION_TOOL_ICONS[activityIcon(action.kind)]}
						toolIcon={activityIcon(action.kind)}
						tone="neutral"
					/>
					<div className="grid min-w-0 gap-0.5">
						<span className="text-[color:var(--dashboardy-muted)]">
							{action.verb}
						</span>
						{[...new Set(action.targets)].map((target) => (
							<code
								className="break-words whitespace-pre-wrap font-mono text-[0.75rem]"
								key={target}
							>
								{target}
							</code>
						))}
					</div>
				</li>
			))}
		</ul>
	);
}

function RawToolDetails({
	input,
	result,
	toolName,
}: {
	input: Record<string, unknown>;
	result: TraceToolResult | undefined;
	toolName: string;
}) {
	const [open, setOpen] = useState(false);
	const metadata = getCodexOperationMetadata(input);
	return (
		<details
			data-trace-raw-details
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="w-fit cursor-pointer text-[0.75rem] text-[color:var(--dashboardy-muted)]">
				Raw data
			</summary>
			{open ? (
				<div className="mt-2 grid gap-3">
					<CodeBlock
						code={JSON.stringify(getRawToolInput(input), null, 2)}
						filename={`Raw input · ${toolName}`}
						language="json"
					/>
					{metadata?.carrierSource ? (
						<CodeBlock
							code={metadata.carrierSource}
							filename={`Raw script · ${metadata.carrierName ?? "exec"}`}
							language="javascript"
							showLineNumbers
						/>
					) : null}
					{result ? (
						<CodeBlock
							code={JSON.stringify(result.content, null, 2)}
							filename="Raw output"
							language="json"
						/>
					) : null}
				</div>
			) : null}
		</details>
	);
}

function PatchBody({ translation }: { translation: CodexToolTranslation }) {
	return (
		<div className="grid gap-3" data-trace-codex-patch-details>
			{translation.files.map((file) => (
				<div
					className="grid gap-1"
					key={`${file.operation}:${file.path}:${file.movePath ?? ""}`}
				>
					{file.movePath ? (
						<p className="font-mono text-[0.75rem] text-[color:var(--dashboardy-muted)]">
							Moved to {file.movePath}
						</p>
					) : null}
					<CodeBlock
						code={
							file.diff ??
							`*** ${file.operation.toUpperCase()} File: ${file.path}`
						}
						filename={file.path}
						language="diff"
						showLineNumbers
					/>
				</div>
			))}
		</div>
	);
}

function PlanBody({ translation }: { translation: CodexToolTranslation }) {
	return (
		<div className="grid gap-3" data-trace-codex-plan-details>
			{translation.planExplanation ? (
				<p className="text-[0.8125rem] leading-5">
					{translation.planExplanation}
				</p>
			) : null}
			<ul aria-label="Plan steps" className="grid gap-1.5">
				{translation.planSteps.map((item) => (
					<li
						className="flex items-start gap-2 text-[0.8125rem] leading-5"
						data-plan-status={item.status}
						key={`${item.status}:${item.step}`}
					>
						<span className="font-mono text-[0.6875rem] text-[color:var(--dashboardy-muted)]">
							{item.status.replaceAll("_", " ")}
						</span>
						<span>{item.step}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function activityIcon(kind: TranscriptToolActivity["kind"]): ToolIconName {
	switch (kind) {
		case "skill":
			return "sparkle";
		case "reading":
			return "file";
		case "searching":
			return "search";
		case "editing":
			return "pencil";
		case "writing":
			return "file-add";
		case "viewing":
			return "image";
		case "executing":
			return "terminal";
		case "planning":
			return "list";
		case "delegating":
			return "bot";
		case "web-research":
			return "globe";
		case "interacting":
			return "computer";
		default:
			return "wrench";
	}
}

function keyActions(actions: TranscriptToolActivity["actions"]) {
	const occurrences = new Map<string, number>();
	return actions.map((action) => {
		const signature = JSON.stringify(action);
		const occurrence = occurrences.get(signature) ?? 0;
		occurrences.set(signature, occurrence + 1);
		return { action, key: `${signature}:${occurrence}` };
	});
}
