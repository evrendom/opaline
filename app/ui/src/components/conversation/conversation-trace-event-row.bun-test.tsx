// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: This golden-style renderer suite intentionally exercises every trace row variant together.

import { describe, expect, test } from "bun:test";
import { ok as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
	attachCodexCorrelation,
	translateCodexToolCall,
} from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { formatShellOutput } from "./conversation-tools";
import type { TraceEvent } from "./conversation-trace";
import { CodexToolCallBody } from "./conversation-trace-codex-tool-body";
import {
	ConversationTraceEventRow,
	ShellToolCallBody,
	ToolCallBody,
	ToolResultBody,
} from "./conversation-trace-event-row";
import {
	createTraceExpansionStore,
	TraceExpansionStoreProvider,
} from "./expandable-trace-row";

function renderExpandedEvent(event: TraceEvent) {
	const store = createTraceExpansionStore();
	store.setExpanded(`trace-event-${event.id}`, true);
	return renderToStaticMarkup(
		<TraceExpansionStoreProvider store={store}>
			<ConversationTraceEventRow event={event} />
		</TraceExpansionStoreProvider>,
	);
}

function renderCollapsedEvent(event: TraceEvent) {
	return renderToStaticMarkup(<ConversationTraceEventRow event={event} />);
}

describe("formatShellOutput", () => {
	test("unwraps a JSON body envelope into natural multiline output", () => {
		expect(
			formatShellOutput(
				JSON.stringify({
					body: "## Summary\n- first receipt\n- second receipt",
					headRefName: "feat/rate-card",
					state: "OPEN",
				}),
			),
		).toEqual({
			language: "text",
			text: "## Summary\n- first receipt\n- second receipt",
		});
	});

	test("pretty-prints JSON output that has no body envelope", () => {
		expect(formatShellOutput('{"status":"ok","count":2}')).toEqual({
			language: "json",
			text: '{\n  "status": "ok",\n  "count": 2\n}',
		});
	});
});

describe("ConversationTraceEventRow shell calls", () => {
	test("renders a Skill as a tag-only expandable file-style row", () => {
		const markup = renderExpandedEvent({
			id: "skill-1",
			input: {
				args: "model pricing rate card verification",
				skill: "claude-api",
			},
			kind: "tool",
			result: undefined,
			skillContent: {
				baseDirectory: "/private/tmp/bundled-skills/claude-api",
				content: "# Building with the Claude API\n\nUse the official SDK.",
			},
			timestamp: "2026-08-14T12:00:00.000Z",
			toolName: "Skill",
		});

		expect(markup).toContain("data-trace-skill-details");
		expect(markup).toContain("data-trace-skill-tag");
		expect(markup).toContain('data-trace-tag-context="sparkle"');
		expect(markup).toContain("claude-api");
		expect(markup).not.toContain(">Used<");
		expect(markup).not.toContain("model pricing rate card verification");
		expect(markup).not.toContain("data-trace-preview");
		expect(markup).not.toContain("data-trace-tool-label-group");
		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(1);
		expect(markup).toContain(">SKILL.md<");
		expect(markup).toContain('data-trace-code-header-icon="markdown"');
		expect(markup).not.toContain("Base directory");
		expect(markup).not.toContain("/private/tmp/bundled-skills/claude-api");
		expect(markup).toContain("Building with the Claude API");
		expect(
			markup.indexOf("data-trace-content-disclosure-icon"),
		).toBeGreaterThan(markup.indexOf("data-trace-skill-tag"));
		expect(markup).not.toContain(">Input<");
		expect(markup).not.toContain(">Output<");
		expect(markup).not.toContain("No result recorded for this call");
	});

	test("collapses reasoning only after the 1,500-character limit", () => {
		const preview = [
			"The  first\tline stays below the node.",
			"  The second line remains available.",
			"The third line remains available.",
			`The fourth line is clamped. ${"reasoning ".repeat(170)} sorry`,
		].join("\n");
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "reasoning-preview-1",
					kind: "reasoning",
					text: preview,
					timestamp: "2026-08-14T12:00:00.000Z",
				}}
			/>,
		);
		const headerStart = markup.indexOf("data-trace-row-header");
		const headerEnd = markup.indexOf("</div>", headerStart);

		expect(markup).toContain("data-trace-collapsed-preview");
		expect(
			markup.indexOf("The  first\tline stays below the node."),
		).toBeGreaterThan(headerEnd);
		expect(markup).toContain("data-trace-text-preview-tail");
		expect(markup).toContain("[…]");
		expect(markup).toContain('data-signal="apology"');
		expect(markup).toContain("max-w-[65ch]");
		expect(markup).toContain("whitespace-pre-wrap");
		expect(markup).toContain(
			"The  first\tline stays below the node.\n  The second line remains available.",
		);
		expect(markup).toContain(
			'class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" data-trace-text-preview-leading',
		);
		expect(markup).not.toContain("flex-1 truncate font-sans");
		expect(markup).toContain("data-trace-content-disclosure");
		expect(markup).not.toContain("data-trace-expanded-content");
	});

	test("shows short reasoning in full without a disclosure", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "reasoning-preview-short",
					kind: "reasoning",
					text: "A short reasoning preview.",
					timestamp: "2026-08-14T12:00:00.000Z",
				}}
			/>,
		);

		expect(markup).toContain("data-trace-static-content");
		expect(markup).not.toContain("data-trace-collapsed-preview");
		expect(markup).not.toContain("data-trace-content-disclosure");
		expect(markup).not.toContain("data-trace-content-disclosure-icon");
	});

	test("lets expanded reasoning use the same available row width", () => {
		const source = readFileSync(
			new URL("./conversation-trace-event-row.tsx", import.meta.url),
			"utf8",
		);

		expect(source).not.toContain("max-w-[80ch]");
	});

	test("reduces a collapsed Bash call to one compact command tag", () => {
		const markup = renderCollapsedEvent({
			id: "bash-1",
			input: {
				command: "bun test ./src/trace.test.ts",
				description: "Run the focused trace test",
			},
			kind: "tool",
			result: { content: "1 pass", isError: false },
			timestamp: "2026-08-14T12:00:00.000Z",
			toolName: "Bash",
		});

		expect(markup).toContain("data-trace-shell-command-tag");
		expect(markup).toContain("bun test ./src/trace.test.ts");
		expect(markup).not.toContain("Run the focused trace test");
		expect(markup).not.toContain("&quot;command&quot;");
		expect(markup).not.toContain(">Ran<");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain("data-trace-expanded-content");
		expect(markup).toContain("h-5");
		expect(markup).toContain("items-center");
		expect(markup).toContain("inline-flex h-5 items-center gap-1");
		expect(markup).toContain("rounded-[5px]");
		expect(markup).toContain("pl-1.5");
		expect(markup).not.toContain("pl-0.5");
		expect(markup).toContain("pr-1.5");
		expect(markup).toContain("dashboardy-mono");
		expect(markup).toContain(
			'<code class="min-w-0 truncate whitespace-pre font-mono font-normal tracking-normal [font-variant-ligatures:none]"',
		);
		expect(markup).toContain("data-trace-shell-command-preview");
		expect(
			markup.indexOf("data-trace-content-disclosure-icon"),
		).toBeGreaterThan(markup.indexOf("data-trace-shell-command-preview"));
		expect(markup).toContain("text-[0.75rem]/4");
		expect(markup).toContain("select-none");
		expect(markup.match(/data-trace-glyph/g)).toHaveLength(1);
		expect(markup).toContain('data-trace-tag-context="terminal"');
	});

	test("renders generic tool input and output with the shared code cards", () => {
		const markup = renderToStaticMarkup(
			<ToolCallBody
				input={{ query: "session failures" }}
				result={{ content: '{"matches":2}', isError: false }}
				toolName="WebSearch"
			/>,
		);

		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(2);
		expect(markup).toContain(">Input<");
		expect(markup).toContain(">Output<");
		expect(markup).toContain("matches");
		expect(markup).not.toContain("data-trace-code-header-icon");
	});

	test("does not infer diff colors from ordinary Bash output", () => {
		const markup = renderToStaticMarkup(
			<ShellToolCallBody
				command="printf status"
				result={{
					content: "- warning from stderr\n+ recovery message",
					isError: false,
				}}
			/>,
		);

		expect(markup).not.toContain('data-trace-code-line-kind="deletion"');
		expect(markup).not.toContain('data-trace-code-line-kind="addition"');
	});

	test("renders Claude Write as one file diff with line totals", () => {
		const markup = renderToStaticMarkup(
			<ToolCallBody
				input={{
					content:
						"export const first = 1;\nexport const second = 2;\nexport const third = 3;",
					file_path: "/workspace/src/generated.ts",
				}}
				result={{ content: "File written successfully", isError: false }}
				toolName="Write"
			/>,
		);

		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(1);
		expect(markup).toContain(">generated.ts<");
		expect(markup).not.toContain(">Input<");
		expect(markup).not.toContain(">Output<");
		expect(markup).not.toContain("File written successfully");
		expect(markup).toContain('data-trace-code-additions="3"');
		expect(markup).toContain('data-trace-code-deletions="0"');
		expect(markup).toContain(">+3<");
		expect(markup).toContain(">−0<");
		expect(markup.match(/data-trace-code-line-kind="addition"/g)).toHaveLength(
			3,
		);
	});

	test("keeps only the filename tag in a collapsed Write row", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "write-preview-1",
					input: {
						content: "export const answer = 42;",
						file_path: "/workspace/src/generated.ts",
					},
					kind: "tool",
					result: { content: "File written successfully", isError: false },
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "Write",
				}}
			/>,
		);

		expect(markup).toContain(">generated.ts<");
		expect(markup).not.toContain("data-trace-preview");
		expect(markup).toContain('data-trace-tool-icon="file-add"');
		expect(markup).not.toContain('data-trace-tool-icon="pencil"');
	});

	test("keeps only the filename tag in a collapsed Edit row", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "edit-preview-1",
					input: {
						file_path: "/workspace/src/generated.ts",
						new_string: "export const answer = 42;",
						old_string: "export const answer = 41;",
					},
					kind: "tool",
					result: { content: "File updated successfully", isError: false },
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "Edit",
				}}
			/>,
		);

		expect(markup).toContain(">generated.ts<");
		expect(markup).not.toContain("data-trace-preview");
		expect(markup).toContain('data-trace-tool-icon="pencil"');
		expect(markup).not.toContain('data-trace-tool-icon="file-add"');
	});

	test("renders Claude Edit old and new strings as one file diff", () => {
		const markup = renderToStaticMarkup(
			<ToolCallBody
				input={{
					file_path:
						"/workspace/.context/plans/token-class-accuracy-finding.md",
					new_string:
						"# Corrected finding\n\n> Updated context\n> with another detail.",
					old_string: "# Original finding",
					replace_all: false,
				}}
				result={{ content: "The file was updated.", isError: false }}
				toolName="Edit"
			/>,
		);

		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(1);
		expect(markup).toContain(">token-class-accuracy-finding.md<");
		expect(markup).toContain("Original finding");
		expect(markup).toContain("Corrected finding");
		expect(markup).not.toContain(">Input<");
		expect(markup).not.toContain(">Output<");
		expect(markup).not.toContain("The file was updated.");
		expect(markup).not.toContain("replace_all");
		expect(markup).toContain('data-trace-code-additions="4"');
		expect(markup).toContain('data-trace-code-deletions="1"');
		expect(markup.match(/data-trace-code-line-kind="deletion"/g)).toHaveLength(
			1,
		);
		expect(markup.match(/data-trace-code-line-kind="addition"/g)).toHaveLength(
			4,
		);
	});

	test("renders orphan results with the shared code card", () => {
		const markup = renderToStaticMarkup(
			<ToolResultBody result={{ content: "orphan output", isError: false }} />,
		);

		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(1);
		expect(markup).toContain(">Output<");
		expect(markup).toContain("orphan output");
	});

	test("renders image-only results as bounded images instead of code", () => {
		const markup = renderToStaticMarkup(
			<ToolResultBody
				result={{
					content: [
						{
							rawType: "input_image",
							source: {
								type: "url",
								url: "data:image/png;base64,AAAA",
							},
							type: "image",
						},
					],
					isError: false,
				}}
			/>,
		);

		expect(markup).toContain("data-trace-result-image");
		expect(markup).toContain("max-h-[32rem]");
		expect(markup).not.toContain("data-trace-code-block");
		expect(markup).not.toContain("input_image");
	});

	test("uses the TypeScript icon and brand color for TypeScript files", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "read-ts-1",
					input: { file_path: "/workspace/src/session-turns.ts" },
					kind: "tool",
					result: { content: "file contents", isError: false },
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "Read",
				}}
			/>,
		);

		expect(markup).toContain("session-turns.ts");
		expect(markup).toContain('data-trace-tag-context="typescript"');
		expect(markup).toContain("text-[#3178c6]");
		expect(markup).not.toContain("data-trace-preview");
	});

	test("uses the Markdown icon for Markdown file tags", () => {
		const markup = renderExpandedEvent({
			id: "write-markdown-1",
			input: {
				content: "# Release notes",
				file_path: "/workspace/CHANGELOG.md",
			},
			kind: "tool",
			result: { content: "File written successfully", isError: false },
			timestamp: "2026-08-14T12:00:00.000Z",
			toolName: "Write",
		});

		expect(markup).toContain("CHANGELOG.md");
		expect(markup).toContain('data-trace-tag-context="markdown"');
		expect(markup).toContain('data-trace-code-header-icon="markdown"');
	});

	test("separates inline file disclosure from the leading tool icon", () => {
		const markup = renderCollapsedEvent({
			id: "read-disclosure-1",
			input: { file_path: "/workspace/src/session-turns.ts" },
			kind: "tool",
			result: { content: "file contents", isError: false },
			timestamp: "2026-08-14T12:00:00.000Z",
			toolName: "Read",
		});

		expect(markup).toContain("data-trace-content-disclosure");
		expect(markup).toContain("data-trace-content-disclosure-icon");
		expect(markup).toContain('data-trace-tool-label-group="true"');
		expect(markup).toContain("items-center gap-1");
		expect(markup).toContain("items-center gap-0 text-left");
		expect(markup).toContain("pointer-events-none -ml-0.5 size-4");
		expect(markup).toContain("transition-transform duration-150");
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain(
			"oklch(from var(--constellation-tree-secondary, color(display-p3 0 0 0 / 60.8%)) calc(l + 0.16) c h)",
		);
		expect(markup).toContain('fill="currentColor"');
		expect(markup).toContain("M7 10.62");
		expect(markup).not.toContain("data-trace-collapsed-preview");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain('data-trace-disclosure-symbol="chevron"');
		expect(
			markup.indexOf("data-trace-content-disclosure-icon"),
		).toBeGreaterThan(markup.indexOf(">Read<"));
		expect(
			markup.indexOf("data-trace-content-disclosure-icon"),
		).toBeGreaterThan(markup.indexOf("session-turns.ts"));
	});

	test("renders Claude Read as one named file card with one line-number gutter", () => {
		const markup = renderToStaticMarkup(
			<ToolCallBody
				input={{ file_path: "/workspace/src/session-turns.ts" }}
				result={{
					content:
						"     1→export const first = 1;\n     2→export const second = 2;",
					isError: false,
				}}
				toolName="Read"
			/>,
		);

		expect(markup).toContain("export");
		expect(markup).toContain(">session-turns.ts<");
		expect(markup).toContain('data-trace-code-header-icon="typescript"');
		expect(markup.indexOf("data-trace-code-header-icon")).toBeLessThan(
			markup.indexOf("data-trace-code-file-label"),
		);
		expect(markup).not.toContain(">Input<");
		expect(markup).not.toContain(">Output<");
		expect(markup).not.toContain("1→");
		expect(markup).not.toContain("2→");
		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(1);
		expect(markup.match(/data-trace-code-line=/g)).toHaveLength(2);
	});

	test("uses the delegated model glyph in both the Opaline node and tag", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "agent-1",
					input: {
						description: "Review the trace",
						model: "opus",
						subagent_type: "general-purpose",
					},
					kind: "tool",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "Agent",
				}}
			/>,
		);

		expect(markup).toContain(">Delegated<");
		expect(markup).toContain('data-trace-icon-tone="claude"');
		expect(markup).toContain('data-trace-tag-context="delegated-model"');
		expect(markup.match(/viewBox="0 0 1200 1200"/g)).toHaveLength(2);
	});

	test("renders a classified Codex command as a semantic activity card", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "exec-1",
					input: { cmd: "rg --files apps/web/src" },
					kind: "tool",
					provider: "codex",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "exec_command",
				}}
			/>,
		);

		expect(markup).toContain(">Searched<");
		expect(markup).toContain('data-trace-primary-arg-label="true">rg --files');
		expect(markup).toContain('data-trace-tag-context="search"');
		expect(markup).toContain(
			'class="shrink-0" data-trace-primary-arg-suffix="true">apps/web/src',
		);
		expect(markup).not.toContain("data-trace-preview");
		expect(markup).not.toContain("&quot;cmd&quot;");
		expect(markup).not.toContain(">Used<");
	});

	test("renders the expanded input and output as two code cards", () => {
		const markup = renderToStaticMarkup(
			<ShellToolCallBody
				command={'printf "first\\nsecond\\n"'}
				result={{ content: "first\nsecond", isError: false }}
			/>,
		);

		expect(markup).toContain("data-trace-shell-command-details");
		expect(markup.match(/data-trace-code-block=/g)).toHaveLength(2);
		expect(markup.match(/data-trace-code-block-header=/g)).toHaveLength(2);
		expect(markup).toContain(">Input<");
		expect(markup).toContain(">Output<");
		expect(markup).toContain("printf");
		expect(markup).toContain("first");
		expect(markup).toContain("second");
		expect(markup.match(/data-trace-code-line-numbers="true"/g)).toHaveLength(
			2,
		);
	});

	test("unwraps body envelopes before rendering numbered output", () => {
		const markup = renderToStaticMarkup(
			<ShellToolCallBody
				command="gh pr view --json body,state"
				result={{
					content: JSON.stringify({
						body: "## Summary\n- all checks passed",
						state: "OPEN",
					}),
					isError: false,
				}}
			/>,
		);

		expect(markup).toContain("## Summary");
		expect(markup).toContain("all checks passed");
		expect(markup).not.toContain("&quot;body&quot;");
		expect(markup).not.toContain("headRefName");
		expect(markup.match(/data-trace-code-line=/g)).toHaveLength(3);
		expect(markup).not.toContain('data-trace-code-line-kind="deletion"');
	});
});

describe("ConversationTraceEventRow Codex parity", () => {
	test("uses the new-file icon for an add-only Codex patch", () => {
		const markup = renderCollapsedEvent({
			id: "codex-add-file",
			input: attachCodexCorrelation(
				{
					input:
						"*** Begin Patch\n*** Add File: src/new-file.ts\n+export const created = true;\n*** End Patch",
				},
				undefined,
			),
			kind: "tool",
			provider: "codex",
			result: undefined,
			timestamp: "2026-08-14T12:00:00.000Z",
			toolName: "apply_patch",
		});

		expect(markup).toContain(">Wrote<");
		expect(markup).toContain('data-trace-tool-icon="file-add"');
		expect(markup).not.toContain('data-trace-tool-icon="pencil"');
	});

	test("never sends explicit Claude provenance through Codex adapters", () => {
		const applyPatchMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "claude-apply-patch-collision",
					input: {
						input:
							"*** Begin Patch\n*** Add File: collision.ts\n+x\n*** End Patch",
					},
					kind: "tool",
					provider: "claude",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "apply_patch",
				}}
			/>,
		);
		const execMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "claude-exec-collision",
					input: { cmd: "sed -n '1,20p' collision.ts" },
					kind: "tool",
					provider: "claude",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "exec_command",
				}}
			/>,
		);
		const reasoningMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-looking-claude-id",
					kind: "reasoning",
					provider: "claude",
					text: "Claude reasoning",
					timestamp: "2026-08-14T12:00:00.000Z",
				}}
			/>,
		);
		const providerlessLegacyMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "providerless-legacy-marker",
					input: attachCodexCorrelation(
						{ cmd: "sed -n '1,20p' collision.ts" },
						undefined,
					),
					kind: "tool",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "exec_command",
				}}
			/>,
		);

		expect(applyPatchMarkup).toContain(">Used<");
		expect(execMarkup).toContain(">Used<");
		expect(execMarkup).not.toContain("data-trace-shell-command-tag");
		expect(reasoningMarkup).toContain(">Reasoning<");
		expect(reasoningMarkup).not.toContain("Reasoning summary");
		expect(providerlessLegacyMarkup).toContain(">Used<");
		expect(providerlessLegacyMarkup).not.toContain(">Read<");
	});

	test("keeps a classified Read range visible without a raw input preview", () => {
		const filename = `${"sessions-overview-filters-menu".padEnd(60, "x")}.tsx`;
		const input = attachCodexCorrelation(
			{ cmd: `sed -n '300,520p' src/${filename}` },
			undefined,
		);
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-read",
					input,
					kind: "tool",
					provider: "codex",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "exec_command",
				}}
			/>,
		);

		expect(markup).toContain(">Read<");
		expect(markup).toContain(filename);
		expect(markup).toContain(
			'class="shrink-0" data-trace-primary-arg-suffix="true">(300–520)',
		);
		expect(markup).toContain(
			'class="min-w-0 truncate" data-trace-primary-arg-label="true"',
		);
		expect(markup).toContain('data-trace-tag-context="typescript"');
		expect(markup).not.toContain("data-trace-preview");
		expect(markup).not.toContain("&quot;cmd&quot;");
		expect(markup).not.toContain(">Used<");
	});

	test("gives Claude and translated Codex Reads the same neutral node icon", () => {
		const filename = "session-turns.ts";
		const claudeMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "claude-read-parity",
					input: { file_path: `/workspace/src/${filename}` },
					kind: "tool",
					provider: "claude",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "Read",
				}}
			/>,
		);
		const codexMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-read-parity",
					input: attachCodexCorrelation(
						{ cmd: `sed -n '1,220p' /workspace/src/${filename}` },
						undefined,
					),
					kind: "tool",
					provider: "codex",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "exec_command",
				}}
			/>,
		);
		const neutralIconPattern =
			/<span class="[^"]*" data-trace-icon="true" data-trace-icon-tone="neutral"><svg[\s\S]*?<\/svg><\/span>/u;
		const claudeIcon = neutralIconPattern.exec(claudeMarkup)?.[0];
		const codexIcon = neutralIconPattern.exec(codexMarkup)?.[0];

		assert(claudeIcon);
		assert(codexIcon);
		expect(codexIcon).toBe(claudeIcon);
		expect(claudeMarkup).toContain('data-trace-tag-context="typescript"');
		expect(codexMarkup).toContain('data-trace-tag-context="typescript"');
	});

	test("renders script-tier cells as highlighted JavaScript", () => {
		const input = attachCodexCorrelation(
			{
				input:
					"const results = await Promise.all(cmds.map((cmd) => tools.exec_command({cmd})));",
			},
			undefined,
		);
		const translation = translateCodexToolCall("exec", input);
		const markup = renderToStaticMarkup(
			<CodexToolCallBody
				input={input}
				result={{ content: "done", isError: false }}
				toolName="exec"
				translation={translation}
			/>,
		);

		expect(translation.verb).toBe("Ran script");
		expect(markup).toContain("data-trace-codex-details");
		expect(markup).toContain("Script · exec");
		expect(markup).toContain("Promise.all");
		expect(markup).toContain('data-trace-code-header-icon="code"');
	});

	test("renders structured patch diffs with raw input behind a closed disclosure", () => {
		const input = attachCodexCorrelation(
			{
				input: "*** Begin Patch\n*** Add File: guessed.ts\n+x\n*** End Patch",
			},
			{
				changes: {
					"/repo/src/real.ts": {
						move_path: "/repo/src/moved.ts",
						type: "update",
						unified_diff: "@@ -1 +1 @@\n-old\n+new",
					},
				},
				success: true,
			},
		);
		const translation = translateCodexToolCall("apply_patch", input);
		const markup = renderToStaticMarkup(
			<CodexToolCallBody
				input={input}
				result={{ content: "Success", isError: false }}
				toolName="apply_patch"
				translation={translation}
			/>,
		);

		expect(markup).toContain("data-trace-codex-patch-details");
		expect(markup).toContain("/repo/src/real.ts");
		expect(markup).toContain("Moved to /repo/src/moved.ts");
		expect(markup).toContain("@@ -1 +1 @@");
		expect(markup).toContain("Raw data");
		expect(markup).not.toContain("Raw input · apply_patch");
		expect(markup).not.toContain("__rudel_codex_correlation");
	});

	test("adapts update_plan steps into an accessible checklist", () => {
		const input = attachCodexCorrelation(
			{
				explanation: "Work in order",
				plan: [
					{ status: "completed", step: "Parse" },
					{ status: "in_progress", step: "Render" },
				],
			},
			undefined,
		);
		const translation = translateCodexToolCall("update_plan", input);
		const markup = renderToStaticMarkup(
			<CodexToolCallBody
				input={input}
				result={undefined}
				toolName="update_plan"
				translation={translation}
			/>,
		);

		expect(markup).toContain('aria-label="Plan steps"');
		expect(markup).toContain('data-plan-status="completed"');
		expect(markup).toContain('data-plan-status="in_progress"');
		expect(markup).toContain("Work in order");
		expect(markup).toContain("Parse");
		expect(markup).toContain("Render");
	});

	test("distinguishes process polling, input sends, viewing, and reasoning summaries", () => {
		const pollMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-poll",
					input: attachCodexCorrelation(
						{ chars: "", session_id: 12 },
						undefined,
					),
					kind: "tool",
					provider: "codex",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "write_stdin",
				}}
			/>,
		);
		const inputMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-input",
					input: attachCodexCorrelation({ chars: "interrupt" }, undefined),
					kind: "tool",
					provider: "codex",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "write_stdin",
				}}
			/>,
		);
		const viewMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-view",
					input: attachCodexCorrelation({ path: "art/shot.png" }, undefined),
					kind: "tool",
					provider: "codex",
					result: undefined,
					timestamp: "2026-08-14T12:00:00.000Z",
					toolName: "view_image",
				}}
			/>,
		);
		const reasoningMarkup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "codex-reasoning",
					kind: "reasoning",
					provider: "codex",
					text: "Short summary",
					timestamp: "2026-08-14T12:00:00.000Z",
				}}
			/>,
		);

		expect(pollMarkup).toContain("Checked process");
		expect(inputMarkup).toContain("Sent input");
		expect(viewMarkup).toContain(">Viewed<");
		expect(viewMarkup).toContain("shot.png");
		expect(reasoningMarkup).toContain("Reasoning summary");
	});
});

test("Codex skill reads use a skill card with clean content and no exposed wrapper", () => {
	const markup = renderExpandedEvent({
		kind: "tool",
		id: "skill-read",
		timestamp: "2026-09-13T10:00:00.000Z",
		provider: "codex",
		toolName: "exec_command",
		input: { cmd: "cat /repo/.claude/skills/testing-bun/SKILL.md" },
		result: {
			isError: false,
			content: [
				{
					type: "text",
					rawType: "input_text",
					text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
				},
				{
					type: "text",
					rawType: "input_text",
					text: "# Test carefully\nVerify the result.",
				},
			],
		},
	});
	expect(markup).toContain("data-trace-skill-tag");
	expect(markup).toContain('data-trace-activity-kind="skill"');
	expect(markup).toContain('data-trace-code-header-icon="markdown"');
	expect(markup).toContain("Verify the result.");
	expect(markup).toContain("Raw data");
	expect(markup).not.toContain("Wall time");
	expect(markup).not.toContain("Raw input");
});

test("agent message cards show the recipient and instructions without raw transport", () => {
	const markup = renderExpandedEvent({
		kind: "tool",
		id: "agent-message",
		provider: "codex",
		timestamp: "2026-09-13T10:00:00.000Z",
		toolName: "collaboration.send_message",
		input: {
			target: "reviewer",
			message: "Check **result attribution** before release.",
		},
		result: undefined,
	});
	expect(markup).toContain("Messaged agent");
	expect(markup).toContain("reviewer");
	expect(markup).toContain("result attribution");
	expect(markup).toContain("Raw data");
	expect(markup).not.toContain("Raw input");
});
