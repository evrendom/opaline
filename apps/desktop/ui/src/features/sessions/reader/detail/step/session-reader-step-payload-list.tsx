import { getRawToolInput } from "@rudel/api-routes";
import { MessageContent } from "@/components/conversation/MessageContent";
import { mcpTool } from "../../model/session-reader-mcp-tool";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../../model/session-reader-model";
import { formatSpanDuration } from "../waterfall/session-reader-waterfall-chips";
import { CommandLines } from "./session-reader-command-steps";
import { McpCall } from "./session-reader-mcp-call";
import type { Payload } from "./session-reader-step-payload";
import {
	EditDiff,
	getToolResultView,
	ShellCommandBlock,
	shellCommandParts,
	ToolArguments,
} from "./session-reader-step-payloads";
import { toolSearchPayloads } from "./session-reader-tool-search";

function MarkdownBody({ text }: { text: string }) {
	return (
		<div className="text-body-l">
			<MessageContent content={text} />
		</div>
	);
}

function wordCount(value: string): number {
	return value.split(/\s+/u).filter(Boolean).length;
}

export function stepPayloads(
	step: SessionReaderStep,
	carded: boolean,
	waterfall: SessionReaderWaterfall,
	written?: SessionReaderStep,
): Payload[] {
	if (step.writes) {
		const event = written?.toolEvent;
		if (!event) return [];
		const shell = shellCommandParts(event);
		return [
			{
				show: "body",
				body: shell ? (
					<CommandLines
						command={shell.full}
						fallback={<ShellCommandBlock event={event} />}
						renderEdit={(edit) => <EditDiff edit={edit} />}
					/>
				) : mcpTool(event.toolName) ? (
					<McpCall event={event} />
				) : (
					<ToolArguments event={event} />
				),
				label: `The ${written?.command?.lead ?? written?.name ?? "next"} call it wrote`,
				value:
					shell?.full ?? JSON.stringify(getRawToolInput(event.input), null, 2),
			},
		];
	}
	if (step.kind === "thinking") {
		if (carded) return [];
		return step.text
			? [{ label: "Thinking", prose: true, show: "text", value: step.text }]
			: [];
	}
	if (step.kind === "message") {
		return step.text
			? [
					{
						body: <MarkdownBody text={step.text} />,
						label: "Output",
						show: "body",
						value: step.text,
					},
				]
			: [];
	}
	if (step.harness === "member" && step.text)
		return [
			{
				body: <MarkdownBody text={step.text} />,
				label: "Message",
				show: "body",
				value: step.text,
			},
		];
	if (step.compaction?.summary)
		return [
			{
				body: <MarkdownBody text={step.compaction.summary} />,
				label: "Summary",
				show: "body",
				value: step.compaction.summary,
			},
		];
	const event = step.toolEvent;
	if (!event) return [];
	const payloads: Payload[] = [];
	if (event.background?.result)
		payloads.push({
			label: "Report",
			prose: true,
			show: "text",
			value: event.background.result,
		});
	const input = getRawToolInput(event.input);
	const prompt = step.kind === "agent" ? agentPrompt(input) : null;
	if (prompt) {
		payloads.push({
			label:
				step.promptUntilMs !== undefined
					? `Prompt · written in ${formatSpanDuration(step.promptUntilMs - step.startMs)}`
					: "Prompt",
			prose: true,
			show: "text",
			value: prompt,
		});
	}
	if (event.skillContent) {
		const { content } = event.skillContent;
		if (typeof input.args === "string" && input.args.trim())
			payloads.push({
				label: "Args",
				prose: true,
				show: "text",
				value: input.args,
			});
		payloads.push({
			body: <MarkdownBody text={content} />,
			hint: `${wordCount(content).toLocaleString()} words`,
			label: "Skill",
			show: "body",
			value: content,
		});
		return payloads;
	}
	const searched = toolSearchPayloads(step, waterfall);
	if (searched) return [...payloads, ...searched];
	if (Object.keys(input).length > 0 && !carded && !prompt) {
		payloads.push({
			body: <ToolArguments event={event} />,
			label: "Arguments",
			show: "body",
			value: JSON.stringify(input, null, 2),
		});
	}
	if (step.result && !carded) {
		const view = getToolResultView(event, step.result);
		payloads.push(
			view.language
				? {
						label: "Result",
						language: view.language,
						show: "code",
						startLine: view.startLine,
						value: view.text,
					}
				: { label: "Result", show: "text", value: view.text },
		);
	}
	return payloads;
}

function agentPrompt(input: Record<string, unknown>): string | null {
	for (const key of ["prompt", "message", "task"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return null;
}
