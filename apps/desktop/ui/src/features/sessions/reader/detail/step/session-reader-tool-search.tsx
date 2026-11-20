import { getToolPresentation } from "@/components/conversation/conversation-tools";
import { CONVERSATION_TOOL_ICONS } from "@/components/conversation/conversation-trace-tool-icons";
import { mcpTool } from "../../model/session-reader-mcp-tool";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../../model/session-reader-model";
import { LANE_LOOK } from "../../model/session-reader-step-lanes";
import { OpalChip } from "../waterfall/session-reader-waterfall-chips";
import type { FieldSpec } from "./session-reader-step-fields";
import type { Payload } from "./session-reader-step-payload";

export type ToolSearch = {
	deferredTools: number | null;
	keywords: string | null;
	limit: number | null;
	tools: string[];
};

export function toolSearchOf(step: SessionReaderStep): ToolSearch | null {
	const event = step.toolEvent;
	if (event?.toolName !== "ToolSearch") return null;
	const query = typeof event.input.query === "string" ? event.input.query : "";
	const content = event.result?.content;
	const tools = Array.isArray(content)
		? content.flatMap((block) => {
				if (block.type !== "structured") return [];
				const value = block.value;
				const name =
					value && typeof value === "object" && !Array.isArray(value)
						? (value as Record<string, unknown>).tool_name
						: undefined;
				return typeof name === "string" ? [name] : [];
			})
		: [];
	const picked = query.startsWith("select:");
	const limit = event.input.max_results;
	return {
		deferredTools: event.toolSearch?.deferredTools ?? null,
		keywords: picked ? null : query.trim() || null,
		limit: typeof limit === "number" ? limit : null,
		tools:
			tools.length > 0 || !picked
				? tools
				: query
						.slice("select:".length)
						.split(",")
						.map((name) => name.trim())
						.filter(Boolean),
	};
}

function callsAfter(
	step: SessionReaderStep,
	tools: readonly string[],
	waterfall: SessionReaderWaterfall,
): Map<string, number> {
	const calls = new Map(tools.map((tool) => [tool, 0]));
	for (const each of waterfall.allSteps) {
		const name = each.toolEvent?.toolName;
		if (name && calls.has(name) && each.startMs >= step.startMs)
			calls.set(name, (calls.get(name) ?? 0) + 1);
	}
	return calls;
}

const tools = (count: number) => `${count} ${count === 1 ? "tool" : "tools"}`;

export function toolSearchFields(
	step: SessionReaderStep,
	waterfall: SessionReaderWaterfall,
): FieldSpec[] {
	const search = toolSearchOf(step);
	if (!search) return [];
	const loaded = search.tools.length;
	const used = [...callsAfter(step, search.tools, waterfall).values()].filter(
		(count) => count > 0,
	).length;
	return [
		{
			label: "Loaded",
			value:
				search.deferredTools === null
					? tools(loaded)
					: `${loaded} of ${tools(search.deferredTools)}`,
		},
		...(search.limit === null
			? []
			: [{ label: "Asked for", value: `Up to ${tools(search.limit)}` }]),
		{
			label: "Used",
			value: loaded === 0 ? "—" : `${used} of ${loaded} in this run`,
		},
	];
}

function toolLabel(toolName: string): string {
	const named = mcpTool(toolName);
	return named ? `${named.server}:${named.tool}` : toolName;
}

function ToolSearchLoaded({
	calls,
	tools,
}: {
	calls: ReadonlyMap<string, number>;
	tools: readonly string[];
}) {
	if (tools.length === 0)
		return <p className="text-body-m text-ink-3">Nothing matched.</p>;
	return (
		<ul className="-mx-m flex flex-col">
			{tools.map((tool) => {
				const Glyph =
					CONVERSATION_TOOL_ICONS[getToolPresentation(tool).icon] ??
					LANE_LOOK.tools.glyph;
				const count = calls.get(tool) ?? 0;
				return (
					<li
						key={tool}
						title={tool}
						className="flex min-w-0 items-center gap-m corner-s px-m py-xs"
					>
						<OpalChip tint={LANE_LOOK.tools.tint} className="size-4">
							<Glyph aria-hidden="true" className="size-2.5 text-success" />
						</OpalChip>
						<span
							className={
								count > 0
									? "min-w-0 truncate text-body-m"
									: "min-w-0 truncate text-body-m text-ink-3"
							}
						>
							{toolLabel(tool)}
						</span>
						<span
							className="ml-auto shrink-0 text-body-s tabular-nums text-ink-3"
							title={
								count > 0
									? `Called ${count} ${count === 1 ? "time" : "times"} after it loaded`
									: "Not called after it loaded, in this run"
							}
						>
							{count > 0 ? `×${count}` : "not used"}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

export function toolSearchPayloads(
	step: SessionReaderStep,
	waterfall: SessionReaderWaterfall,
): Payload[] | null {
	const search = toolSearchOf(step);
	if (!search) return null;
	return [
		...(search.keywords
			? [
					{
						label: "Searched for",
						prose: true,
						show: "text",
						value: search.keywords,
					} as const,
				]
			: []),
		{
			body: (
				<ToolSearchLoaded
					calls={callsAfter(step, search.tools, waterfall)}
					tools={search.tools}
				/>
			),
			hint: tools(search.tools.length),
			label: "Tools",
			show: "body",
			value: search.tools.join("\n"),
		},
	];
}
