import { beforeEach, expect, test } from "bun:test";
import { filterSessionTextFields } from "@rudel/secret-filter";
import {
	clearFilteredLines,
	filterStream,
	slimAndFilterSecrets,
} from "./ingest-filter.core.js";

const KEY =
	"sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrSt-AA";

const record = (text: string) =>
	JSON.stringify({ type: "user", message: { content: text } });

beforeEach(() => clearFilteredLines());

function sorted(counts: Readonly<Record<string, number>>) {
	return Object.entries(counts).sort();
}

test("a local import's JSON Lines are filtered one record at a time to the same bytes as the whole stream", () => {
	const content = [
		record("hello"),
		record(`use ${KEY} now`),
		record("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"),
		"",
		record("bye"),
	].join("\n");
	const subagent = [record(`again ${KEY}`), record("clean")].join("\n");
	const expected = filterSessionTextFields({
		content,
		subagents: [{ agentId: "a1", content: subagent }],
	});
	// The second pass is served from the remembered lines.
	for (let pass = 0; pass < 2; pass += 1) {
		const result = slimAndFilterSecrets({
			content,
			subagents: [{ agentId: "a1", content: subagent }] as never,
			slimmed: true,
		});
		expect(result.content).toBe(expected.content);
		expect(result.subagents?.[0]?.content).toBe(
			expected.subagents?.[0]?.content,
		);
		expect(sorted(result.counts)).toEqual(sorted(expected.counts));
		expect(result.redactedBytes).toBe(expected.redactedBytes);
		expect(result.content).not.toContain(KEY);
	}
});

test("a grown transcript keeps the earlier lines' redactions", () => {
	const first = [record(`use ${KEY}`), record("one")].join("\n");
	filterStream(first);
	const grown = `${first}\n${record("two")}\n${record(`and ${KEY}`)}`;
	const result = filterStream(grown);
	const expected = filterSessionTextFields({ content: grown, subagents: [] });
	expect(result.text).toBe(expected.content);
	expect(sorted(result.counts)).toEqual(sorted(expected.counts));
});

test("text that is not JSON Lines is filtered whole", () => {
	const document = JSON.stringify(
		{ messages: [{ text: `use ${KEY}` }] },
		null,
		2,
	);
	const expected = filterSessionTextFields({
		content: document,
		subagents: [],
	});
	expect(filterStream(document).text).toBe(expected.content);
});
