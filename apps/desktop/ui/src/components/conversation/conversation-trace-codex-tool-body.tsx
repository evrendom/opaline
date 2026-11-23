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
			className="grid gap-l"
			data-trace-codex-details
			data-trace-activity-kind={activity.kind}
		>
			{activity.status === "failed" ? (
				<p className="text-body-l text-error">
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
				<p className="text-body-l text-ink-3">
					Output is shared with other calls below.
				</p>
			) : (
				<p className="text-body-l text-ink-3">
					No result recorded for this call.
				</p>
			)}
			<RawToolDetails input={input} result={result} toolName={toolName} />
		</div>
	);
}

function ActivityTargets({ activity }: { activity: TranscriptToolActivity }) {
	return (
		<ul aria-label="Tool actions" className="grid gap-m">
			{keyActions(activity.actions).map(({ action, key }) => (
				<li
					className="flex min-w-0 items-start gap-m text-body-l"
					data-trace-activity-kind={action.kind}
					key={key}
				>
					<TraceIcon
						icon={CONVERSATION_TOOL_ICONS[activityIcon(action.kind)]}
						toolIcon={activityIcon(action.kind)}
						tone="neutral"
					/>
					<div className="grid min-w-0 gap-xxs">
						<span className="text-ink-3">{action.verb}</span>
						{[...new Set(action.targets)].map((target) => (
							<code
								className="break-words whitespace-pre-wrap font-data text-body-m"
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
			<summary className="w-fit text-body-m text-ink-3">Raw data</summary>
			{open ? (
				<div className="mt-m grid gap-l">
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
		<div className="grid gap-l" data-trace-codex-patch-details>
			{translation.files.map((file) => (
				<div
					className="grid gap-xs"
					key={`${file.operation}:${file.path}:${file.movePath ?? ""}`}
				>
					{file.movePath ? (
						<p className="font-data text-body-m text-ink-3">
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
		<div className="grid gap-l" data-trace-codex-plan-details>
			{translation.planExplanation ? (
				<p className="text-body-l">{translation.planExplanation}</p>
			) : null}
			<ul aria-label="Plan steps" className="grid gap-s">
				{translation.planSteps.map((item) => (
					<li
						className="flex items-start gap-m text-body-l"
						data-plan-status={item.status}
						key={`${item.status}:${item.step}`}
					>
						<span className="font-data text-body-s text-ink-3">
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
