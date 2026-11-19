import { expect, test } from "bun:test";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../../model/session-reader-model";
import { toolSearchFields, toolSearchOf } from "./session-reader-tool-search";

const searchStep = (query: string, names: string[]) =>
	({
		toolEvent: {
			input: { max_results: 4, query },
			result: {
				content: names.map((tool_name) => ({
					type: "structured",
					value: { tool_name, type: "tool_reference" },
				})),
				isError: false,
			},
			toolName: "ToolSearch",
		},
	}) as unknown as SessionReaderStep;

test("a tool search's loaded tools come from its tool references", () => {
	expect(
		toolSearchOf(
			searchStep("select:mcp__plugin_opaline_opaline__sql,WebFetch", [
				"mcp__plugin_opaline_opaline__sql",
				"WebFetch",
			]),
		),
	).toEqual({
		deferredTools: null,
		keywords: null,
		limit: 4,
		tools: ["mcp__plugin_opaline_opaline__sql", "WebFetch"],
	});
	expect(toolSearchOf(searchStep(" slack send ", []))).toEqual({
		deferredTools: null,
		keywords: "slack send",
		limit: 4,
		tools: [],
	});
});

test("a result with no tool references lists what its select named", () => {
	expect(
		toolSearchOf(searchStep("select:mcp__posthog__exec, WebFetch", []))?.tools,
	).toEqual(["mcp__posthog__exec", "WebFetch"]);
});

test("any other step is no tool search", () => {
	expect(
		toolSearchOf({ toolEvent: { input: {}, toolName: "Grep" } } as never),
	).toBeNull();
});

test("a tool search's facts: of how many, asked for, and used after", () => {
	const search = {
		...searchStep("select:mcp__opaline__sql,WebFetch", [
			"mcp__opaline__sql",
			"WebFetch",
		]),
		startMs: 10,
	} as SessionReaderStep;
	(search.toolEvent as { toolSearch?: unknown }).toolSearch = {
		deferredTools: 61,
	};
	const call = (toolName: string, startMs: number) =>
		({ startMs, toolEvent: { toolName } }) as unknown as SessionReaderStep;
	const waterfall = {
		allSteps: [
			call("WebFetch", 5),
			search,
			call("mcp__opaline__sql", 20),
			call("mcp__opaline__sql", 30),
		],
	} as unknown as SessionReaderWaterfall;
	expect(toolSearchFields(search, waterfall)).toEqual([
		{ label: "Loaded", value: "2 of 61 tools" },
		{ label: "Asked for", value: "Up to 4 tools" },
		{ label: "Used", value: "1 of 2 in this run" },
	]);
});
