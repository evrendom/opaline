import { expect, test } from "bun:test";
import cases from "../__fixtures__/l1-facts/v9-cases.json" with {
	type: "json",
};
import { readClaudeLine } from "./claude-records.js";
import { readCodexLine } from "./codex-records.js";
import { censusRecordPaths, pathMatches } from "./fact-census.js";
import { createStreamState, isRecord } from "./line-items.js";
import { literalPatchHunks } from "./patch-hunks.js";
import { splitSessionTranscript } from "./split-transcript.js";
import { V9_SOURCE_FACTS } from "./v9-fact-sources.js";

for (const agent of ["claude_code", "codex"] as const) {
	const fixture = new URL(
		`../__fixtures__/l1-facts/${agent === "claude_code" ? "claude" : "codex"}-v9.jsonl`,
		import.meta.url,
	);
	test(`${agent}: every v9 source has a census witness and stored components`, async () => {
		const content = await Bun.file(fixture).text();
		const lines = content.trimEnd().split("\n");
		const rows = [
			...splitSessionTranscript({
				content,
				sessionDate: "2026-10-09T09:00:00Z",
				source: agent,
			}),
		];
		const missing: string[] = [];
		for (const witness of cases.filter((witness) => witness.agent === agent)) {
			const record: unknown = JSON.parse(lines[witness.line - 1] ?? "null");
			expect(isRecord(record)).toBe(true);
			if (!isRecord(record)) throw new Error("Invalid fixture");
			const paths = censusRecordPaths(record, agent);
			const duplicateText = new Set<string>();
			const components = rows
				.filter((row) => row.recordIdx === witness.line)
				.flatMap((row) => {
					const encoded = Object.entries(row.facts.extra).find(
						([key]) => key === witness.key,
					)?.[1];
					if (encoded === undefined) return [];
					const parsed: unknown = JSON.parse(encoded);
					if (!Array.isArray(parsed))
						throw new Error(`Invalid components: ${witness.key}`);
					return parsed.filter(isRecord);
				});
			censusRecordPaths(record, agent, (path, _key, value) => {
				if (
					typeof value === "string" &&
					pathMatches(witness.source, path) &&
					rows.some(
						(row) => row.recordIdx === witness.line && row.text === value,
					)
				)
					duplicateText.add(path);
				if (
					!witness.source.includes("~") &&
					pathMatches(witness.source, path) &&
					(value === null ||
						["string", "number", "boolean"].includes(typeof value))
				) {
					const values = components
						.filter((part) => part.path === path)
						.map((part) => part.value);
					expect(
						values.length > 0 ||
							([
								"tool_result_text_components",
								"instruction_text_components",
							].includes(witness.key) &&
								duplicateText.has(path)),
					).toBe(true);
					if (values.length > 0) {
						const expected =
							typeof value === "string" &&
							/\.(?:image_url|audio_url|data)$/u.test(path)
								? { present: true, inline: value.startsWith("data:") }
								: witness.key === "wall_time_ms_components" &&
										path.endsWith(".duration_seconds") &&
										typeof value === "number"
									? value * 1_000
									: witness.key === "patch_hunks_components" &&
											path.endsWith(".unified_diff") &&
											typeof value === "string"
										? { unified_diff: value, ...literalPatchHunks(value) }
										: value;
						expect(values).toEqual([expected]);
					}
				}
			});
			if (
				![...paths.keys()].some(
					(path) =>
						pathMatches(witness.source, path) ||
						pathMatches(witness.source, path, true),
				)
			)
				missing.push(`census: ${witness.source}`);
			if (
				!(
					[
						"tool_result_text_components",
						"instruction_text_components",
					].includes(witness.key) && duplicateText.size > 0
				) &&
				!rows.some(
					(row) =>
						row.recordIdx === witness.line &&
						Object.hasOwn(row.facts.extra, witness.key),
				)
			)
				missing.push(`parser: ${witness.source} -> ${witness.key}`);
		}
		expect(missing).toEqual([]);
	});
}

test("unified hunk ranges preserve written counts without inventing omitted counts", () => {
	expect(
		literalPatchHunks(
			"@@ -1 +2,0 @@\n-before\n@@ -10,2 +11,3 @@ section\n+after",
		),
	).toEqual({
		hunks: [
			{ old_start: "1", old_count: null, new_start: "2", new_count: "0" },
			{ old_start: "10", old_count: "2", new_start: "11", new_count: "3" },
		],
		more: 0,
	});
});

test("empty messages retain recorded metadata, but no synthetic metadata is fabricated", () => {
	const state = createStreamState("2026-10-09T09:00:00Z");
	const recorded = readClaudeLine(
		{
			type: "assistant",
			uuid: "recorded-uuid",
			parentUuid: null,
			message: { content: [] },
		},
		state,
	).items;
	expect(recorded).toHaveLength(1);
	expect(recorded[0]?.facts?.extra?.record_uuid_components).toContain(
		"recorded-uuid",
	);
	expect(
		readClaudeLine({ type: "assistant", message: { content: [] } }, state)
			.items[0]?.facts?.extra?.record_uuid_components,
	).toBeUndefined();
});

test("usage components distinguish absent thinking and tier fields from zero and null", () => {
	const claudeState = createStreamState("2026-10-09T09:00:00Z");
	const absentThinking = readClaudeLine(
		{ type: "assistant", message: { content: [] } },
		claudeState,
	).items;
	const zeroThinking = readClaudeLine(
		{
			type: "assistant",
			message: {
				content: [],
				usage: { output_tokens_details: { thinking_tokens: 0 } },
			},
		},
		claudeState,
	).items;
	const codexState = createStreamState("2026-10-09T09:00:00Z");
	const absentTier = readCodexLine(
		{
			type: "event_msg",
			payload: { type: "thread_settings_applied", thread_settings: {} },
		},
		codexState,
	).items;
	const nullTier = readCodexLine(
		{
			type: "event_msg",
			payload: {
				type: "thread_settings_applied",
				thread_settings: { service_tier: null },
			},
		},
		codexState,
	).items;
	const emptyTier = readCodexLine(
		{
			type: "event_msg",
			payload: {
				type: "thread_settings_applied",
				thread_settings: { service_tier: "" },
			},
		},
		codexState,
	).items;
	const counter =
		zeroThinking[0]?.facts?.extra?.reasoning_output_tokens_components;
	const tier = nullTier[0]?.facts?.extra?.service_tier_components;
	const empty = emptyTier[0]?.facts?.extra?.service_tier_components;
	if (counter === undefined || tier === undefined || empty === undefined)
		throw new Error("Missing literal usage witnesses");
	for (const row of absentThinking)
		expect(
			row.facts?.extra?.reasoning_output_tokens_components,
		).toBeUndefined();
	for (const row of absentTier)
		expect(row.facts?.extra?.service_tier_components).toBeUndefined();
	const values = (content: string) =>
		(JSON.parse(content) as { value: unknown }[]).map((part) => part.value);
	expect(values(counter)).toEqual([0]);
	expect(values(tier)).toEqual([null]);
	expect(values(empty)).toEqual([""]);
});

test("v9 scopes call inputs to their own call, not sibling calls", () => {
	const record = {
		type: "assistant",
		message: {
			content: [
				{
					type: "tool_use",
					id: "first",
					name: "Bash",
					input: { command: "echo first", description: "first description" },
				},
				{
					type: "tool_use",
					id: "second",
					name: "Bash",
					input: { command: "echo second", description: "second description" },
				},
			],
		},
	};
	const rows = readClaudeLine(
		record,
		createStreamState("2026-10-09T09:00:00Z"),
	).items;
	expect(rows[0]?.facts?.extra?.command_description_components).toContain(
		"first description",
	);
	expect(rows[0]?.facts?.extra?.command_description_components).not.toContain(
		"second description",
	);
	expect(rows[1]?.facts?.extra?.command_description_components).toContain(
		"second description",
	);
});

test("execution options exclude env and unknown fields, preserve false, empty and null", () => {
	const record = {
		type: "response_item",
		payload: {
			type: "function_call",
			name: "exec_command",
			call_id: "options",
			arguments: JSON.stringify({
				cmd: "echo safe",
				tty: false,
				shell: "",
				login: null,
				workdir: "/repo",
				env: { SECRET: "never-store" },
				unknown: "never-store",
			}),
		},
	};
	const row = readCodexLine(record, createStreamState("2026-10-09T09:00:00Z"))
		.items[0];
	const stored = row?.facts?.extra?.call_exec_options_components ?? "";
	expect(stored).toContain('"value":false');
	expect(stored).toContain('"value":""');
	expect(stored).toContain('"value":null');
	expect(stored).not.toContain("never-store");
	expect(stored).not.toContain("env");
});

test("image facts store presence and inline type, never bytes", () => {
	const record = {
		type: "response_item",
		payload: {
			type: "message",
			role: "user",
			content: [
				{
					type: "input_image",
					image_url: "data:image/png;base64,PRIVATE_BYTES",
					detail: "high",
				},
			],
		},
	};
	const stored = JSON.stringify(
		readCodexLine(record, createStreamState("2026-10-09T09:00:00Z")).items,
	);
	expect(stored).toContain("present");
	expect(stored).not.toContain("PRIVATE_BYTES");
});

test("refused changes remain requests and are never applied facts", () => {
	const record = {
		type: "event_msg",
		payload: {
			type: "item_completed",
			item: {
				type: "FileChange",
				id: "refused",
				status: "failed",
				changes: {
					"/repo/file": { type: "update", unified_diff: "-old\n+new" },
				},
			},
		},
	};
	const rows = readCodexLine(
		record,
		createStreamState("2026-10-09T09:00:00Z"),
	).items;
	expect(
		rows.some(
			(row) => row.facts?.extra?.applied_file_changes_components !== undefined,
		),
	).toBe(false);
	expect(rows.find((row) => row.kind === "tool_result")?.isError).toBe(true);
});

test("component clipping and omitted list entries are explicit for both agents", () => {
	for (const agent of ["claude_code", "codex"] as const) {
		const record =
			agent === "claude_code"
				? {
						type: "user",
						origin: {
							from: "x".repeat(5_000),
							hopChain: Array.from({ length: 2_000 }, () => "y".repeat(500)),
						},
					}
				: {
						type: "turn_context",
						payload: {
							workspace_roots: Array.from({ length: 2_000 }, () =>
								"y".repeat(500),
							),
						},
					};
		const rows =
			agent === "claude_code"
				? readClaudeLine(record, createStreamState("2026-10-09T09:00:00Z"))
						.items
				: readCodexLine(record, createStreamState("2026-10-09T09:00:00Z"))
						.items;
		const key =
			agent === "claude_code"
				? "prompt_origin_components"
				: "workspace_roots_components";
		const moreKey =
			agent === "claude_code"
				? "prompt_origin_components_more"
				: "workspace_roots_components_more";
		expect(rows[0]?.facts?.extra?.facts_clipped).toContain(key);
		expect(Number(rows[0]?.facts?.extra?.[moreKey])).toBeGreaterThan(0);
	}
});

test("all sourced v9 mappings have an explicit fixture case", () => {
	const missing = V9_SOURCE_FACTS.filter(
		(mapping) =>
			!cases.some(
				(witness) =>
					witness.agent === mapping.agent && witness.key === mapping.key,
			),
	);
	expect(missing).toEqual([]);
});

test("structured content preserves prototype-like and long literal object keys", () => {
	const structured: unknown = JSON.parse(
		'{"__proto__":{"literal":true},"constructor":false}',
	);
	if (!isRecord(structured)) throw new Error("Invalid witness");
	const longName = "name".repeat(1_250);
	structured[longName] = "written value";
	structured.token = "unformatted-private-value";
	structured.INTERNAL_API_KEY = "other-private-value";
	structured.refreshToken = "third-private-value";
	const rows = readClaudeLine(
		{
			type: "user",
			mcpMeta: { structuredContent: structured },
			message: {
				content: [{ type: "tool_result", tool_use_id: "mcp", content: "ok" }],
			},
		},
		createStreamState("2026-10-09T09:00:00Z"),
	).items;
	const encoded = rows[0]?.facts?.extra?.mcp_structured_content_components;
	if (encoded === undefined) throw new Error("Missing structured content");
	const components = JSON.parse(encoded) as {
		value: Record<string, unknown>;
	}[];
	const preserved = components[0]?.value;
	if (preserved === undefined) throw new Error("Missing literal component");
	expect(Object.hasOwn(preserved, "__proto__")).toBe(true);
	expect(preserved.__proto__).toEqual({ literal: true });
	expect(Object.getOwnPropertyDescriptor(preserved, "constructor")?.value).toBe(
		false,
	);
	expect(preserved[longName]).toBe("written value");
	expect(preserved.token).toBe("[redacted]");
	expect(preserved.INTERNAL_API_KEY).toBe("[redacted]");
	expect(preserved.refreshToken).toBe("[redacted]");
});
