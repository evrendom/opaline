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
					className="corner-zero bg-transparent px-zero py-zero [&>div]:px-zero"
					code={value.trim()}
					language={sql ? "sql" : code ? "javascript" : "text"}
				/>
			);
		return (
			<span className="text-body-l whitespace-pre-wrap [overflow-wrap:anywhere]">
				{value}
			</span>
		);
	}
	if (value !== null && typeof value === "object")
		return <JsonTree value={value} />;
	return <span className="font-data text-body-m">{String(value)}</span>;
}

export function McpCall({ event }: { event: ToolEvent }) {
	const named = mcpTool(event.toolName);
	const input = Object.entries(getRawToolInput(event.input));
	return (
		// design-escape-ok(opacity): no role renders this; dark:bg-canvas/25
		<div className="flex flex-col divide-y divide-line-soft corner-m edge-m border-line-soft bg-canvas px-l dark:bg-canvas/25">
			{named ? (
				<p className="flex min-w-0 items-baseline gap-s py-m">
					<span className="shrink-0 corner-xs bg-field px-xs text-body-xs font-medium text-ink-3">
						{named.server}
					</span>
					<span className="min-w-0 truncate font-data text-body-m">
						{named.tool}
					</span>
				</p>
			) : null}
			{input.map(([key, value]) => (
				<div key={key} className="flex min-w-0 flex-col gap-xs py-m">
					{input.length > 1 ? (
						<span className="text-body-s text-ink-3">{argumentLabel(key)}</span>
					) : null}
					<ArgumentValue name={key} value={value} />
				</div>
			))}
		</div>
	);
}
