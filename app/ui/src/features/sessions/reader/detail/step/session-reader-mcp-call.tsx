import { getRawToolInput, type TraceEvent } from "@rudel/api-routes";
import { mcpTool } from "../../model/session-reader-mcp-tool";
import { JsonTree } from "./session-reader-json-tree";
import { HighlightedCode } from "./session-reader-step-payloads";

type ToolEvent = Extract<TraceEvent, { kind: "tool" }>;

function argumentLabel(key: string): string {
	const words = key.replace(/([a-z])([A-Z])/gu, "$1 $2").replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

const SQL_KEYS = new Set(["sql", "query", "statement"]);

const CODE_KEYS = new Set(["code", "expression", "function", "js", "script"]);

function ArgumentValue({ name, value }: { name: string; value: unknown }) {
	if (typeof value === "string") {
		const sql =
			SQL_KEYS.has(name.toLowerCase()) &&
			/^\s*(?:select|with|insert|update|delete|create|alter|drop|show|describe|explain)\b/iu.test(
				value,
			);
		const code = CODE_KEYS.has(name.toLowerCase());
		if (sql || code || value.includes("\n"))
			return (
				<HighlightedCode
					className="rounded-none bg-transparent px-0 py-0 [&>div]:px-0"
					code={value.trim()}
					language={sql ? "sql" : code ? "javascript" : "text"}
				/>
			);
		return (
			<span className="text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">
				{value}
			</span>
		);
	}
	if (value !== null && typeof value === "object")
		return <JsonTree value={value} />;
	return <span className="font-mono text-xs">{String(value)}</span>;
}

export function McpCall({ event }: { event: ToolEvent }) {
	const named = mcpTool(event.toolName);
	const input = Object.entries(getRawToolInput(event.input));
	return (
		<div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-background px-3 dark:bg-black/25">
			{named ? (
				<p className="flex min-w-0 items-baseline gap-1.5 py-2">
					<span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] leading-4 font-medium text-muted-foreground">
						{named.server}
					</span>
					<span className="min-w-0 truncate font-mono text-xs">
						{named.tool}
					</span>
				</p>
			) : null}
			{input.map(([key, value]) => (
				<div key={key} className="flex min-w-0 flex-col gap-1 py-2">
					{input.length > 1 ? (
						<span className="text-[11px] text-muted-foreground">
							{argumentLabel(key)}
						</span>
					) : null}
					<ArgumentValue name={key} value={value} />
				</div>
			))}
		</div>
	);
}
