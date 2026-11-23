import { useId, useState } from "react";
import { Pressable } from "@/app/ui/pressable";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { formatShellOutput } from "./conversation-tools";
import {
	TraceAlertIcon,
	TraceChevronDownIcon,
	TraceChevronRightIcon,
	TraceTerminalIcon,
} from "./conversation-trace-glyphs";

interface ToolInvocationProps {
	toolName: string;
	input: Record<string, unknown>;
	result?: {
		content: string | Array<{ type: string; text?: string; source?: unknown }>;
		is_error?: boolean;
	};
	className?: string;
}

export function ToolInvocation({
	toolName,
	input,
	result,
	className,
}: ToolInvocationProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const panelId = useId();

	// Format input for display
	const formatInput = () => {
		const keys = Object.keys(input);
		if (keys.length === 0) return "No parameters";

		const important = keys.slice(0, 2);
		const summary = important
			.map((key) => {
				const value = input[key];
				if (typeof value === "string" && value.length > 50) {
					return `${key}: "${value.slice(0, 50)}..."`;
				}
				if (typeof value === "string") {
					return `${key}: "${value}"`;
				}
				return `${key}: ${JSON.stringify(value)}`;
			})
			.join(", ");

		return keys.length > 2 ? `${summary}, +${keys.length - 2} more` : summary;
	};

	// Format result content
	const getResultContent = (): string => {
		if (!result) return "";

		if (typeof result.content === "string") {
			return result.content;
		}

		if (Array.isArray(result.content)) {
			return result.content
				.map((item) => item.text || JSON.stringify(item))
				.join("\n");
		}

		return JSON.stringify(result.content, null, 2);
	};

	const hasResult = result?.content;
	const isError = result?.is_error;
	const output = formatShellOutput(getResultContent());

	return (
		<div
			className={cn(
				"overflow-hidden corner-l edge-m",
				isError ? "border-line bg-error-tint" : "border-line bg-inset",
				className,
			)}
		>
			<Pressable
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				aria-expanded={isExpanded}
				aria-controls={panelId}
				className={cn(
					"flex min-w-0 w-full items-center gap-l",
					"px-xl py-xl",
					"text-left",
					"transition-colors",
					"hover:bg-field",
				)}
			>
				{isExpanded ? (
					<TraceChevronDownIcon className="size-4 shrink-0 text-ink-3" />
				) : (
					<TraceChevronRightIcon className="size-4 shrink-0 text-ink-3" />
				)}
				<div
					className={cn(
						"flex size-8 shrink-0 items-center justify-center",
						"corner-full edge-m",
						"border-line bg-canvas",
					)}
				>
					{isError ? (
						<TraceAlertIcon className="size-4 text-error" />
					) : (
						<TraceTerminalIcon className="size-4 text-ink" />
					)}
				</div>
				<div className="grid min-w-0 flex-1 gap-xs">
					<p
						className={cn(
							"font-data text-body-xl font-heavy",
							isError ? "text-error" : "text-ink",
						)}
					>
						{toolName}
					</p>
					<p className="truncate text-body-xl text-ink-3">{formatInput()}</p>
				</div>
			</Pressable>

			{isExpanded && (
				<div
					id={panelId}
					className="space-y-xl edge-t-m border-line px-xl py-xl"
				>
					{/* Tool Input */}
					<CodeBlock
						code={JSON.stringify(input, null, 2)}
						filename="Input"
						language="json"
					/>

					{/* Tool Result */}
					{hasResult && (
						<CodeBlock
							code={output.text}
							filename={isError ? "Error Output" : "Output"}
							language={output.language}
							showLineNumbers
						/>
					)}
				</div>
			)}
		</div>
	);
}
