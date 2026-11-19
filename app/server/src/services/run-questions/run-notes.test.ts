import { expect, test } from "bun:test";
import { composeRunNote } from "./run-notes.js";

const DIGEST = [
	{ name: "prompt", text: "fix the failing login test\n" },
	{ name: "files edited", text: "src/auth.ts" },
	{ name: "checks after last edit", text: "fail\ttest\tbun test" },
	{ name: "failed calls", text: "12\tBash\terror: expected 200, got 401" },
	{ name: "final", text: "Fixed! The test now passes." },
	{ name: "next prompt reaction", text: "negative" },
];

test("a run note is the prompt, the tools with their counts, the failed calls, the final message and the next prompt's reaction, and nothing else", () => {
	expect(
		composeRunNote({
			promptHead: "fix the failing",
			sections: DIGEST,
			tools: [
				{ name: "Grep", calls: 9 },
				{ name: "Edit", calls: 2 },
			],
		}),
	).toBe(
		[
			"prompt:\nfix the failing login test",
			"tools: Grep×9, Edit×2",
			"failed calls (record, tool, error line):\n12\tBash\terror: expected 200, got 401",
			"final message:\nFixed! The test now passes.",
			"how the next prompt reacted:\nnegative",
		].join("\n\n"),
	);
});

test("a subagent's run starts from its task; without a digest the note falls back to the prompt head", () => {
	expect(
		composeRunNote({
			promptHead: "ignored",
			sections: [{ name: "task", text: "find the config loader" }],
			tools: [],
		}),
	).toBe(
		"task from the parent agent:\nfind the config loader\n\ntools: none recorded",
	);
	expect(
		composeRunNote({
			promptHead: "rename the helper",
			sections: [],
			tools: [],
		}),
	).toBe("prompt:\nrename the helper\n\ntools: none recorded");
});

test("secrets never leave in a note, and a long note is cut to its cap", () => {
	const note = composeRunNote({
		promptHead: "",
		sections: [
			{ name: "prompt", text: "deploy with key AKIACANARY234567ABCD" },
			{ name: "final", text: "x".repeat(10_000) },
		],
		tools: [],
	});
	expect(note).not.toContain("AKIACANARY234567ABCD");
	expect(note.length).toBe(6_000);
	expect(note.endsWith("…")).toBe(true);
});
