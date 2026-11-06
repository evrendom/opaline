import { expect, test } from "bun:test";
import { renderRead } from "./analysis-renderers.js";
import { READ_OUTPUT, RUN_OUTPUT } from "./json-output.fixtures.js";
import { RUN_CUT_NOTE, readJson, runJson } from "./json-output.js";

const sessionUrl = (id: string) => `https://opaline.so/acme/sessions/${id}`;

const read = readJson(READ_OUTPUT, sessionUrl);
const run = runJson(RUN_OUTPUT, sessionUrl("sess-1"));

test("read json keeps the budgeted text, its cut marker and the omitted runs, with a link per run", () => {
	const text = renderRead(READ_OUTPUT);
	const json = JSON.parse(read);
	expect(json._markers).toEqual([
		"… [1 more runs omitted to fit the response size limit]",
	]);
	for (const marker of json._markers) expect(text).toContain(marker);
	const cut = json.reads[0].sections.at(-1).text as string;
	expect(cut).toMatch(/… \[truncated \d+ of \d+ chars — open it in Opaline/u);
	expect(json.reads[0]._opalineUrl).toBe(sessionUrl("sess-1"));
	expect(json._opalineUrl).toBe(sessionUrl("sess-1"));
});

test("run json has the run's address, its structure, the text view and the cut note", () => {
	expect(JSON.parse(run)).toMatchObject({
		tool: "run",
		ref: { sessionId: "sess-1", agentId: "", turn: 1 },
		view: { requests: [{ record: 5 }, { record: 8 }] },
		_markers: [RUN_CUT_NOTE],
		_opalineUrl: sessionUrl("sess-1"),
	});
});
