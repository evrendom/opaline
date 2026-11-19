import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRead } from "./analysis-renderers.js";
import { READ_OUTPUT, RUN_OUTPUT } from "./json-output.fixtures.js";
import { RUN_CUT_NOTE, readJson, runJson } from "./json-output.js";

const SCRIPTS = join(
	import.meta.dir,
	"../../../../plugin/skills/opaline/scripts",
);
const sessionUrl = (id: string) => `https://opaline.so/acme/sessions/${id}`;
const directory = mkdtempSync(join(tmpdir(), "opaline-skill-scripts-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const read = readJson(READ_OUTPUT, sessionUrl);
const run = runJson(RUN_OUTPUT, sessionUrl("sess-1"));

function persisted(name: string, json: string): string {
	const path = join(directory, `${name}.json`);
	writeFileSync(path, JSON.stringify([{ type: "text", text: json }]));
	return path;
}

const files = {
	read: persisted("read", read),
	run: persisted("run", run),
};

function script(
	name: string,
	file: string,
	env: Record<string, string> = {},
): { code: number; out: string; err: string } {
	const done = Bun.spawnSync(["python3", "-I", join(SCRIPTS, name), file], {
		env: { PATH: process.env.PATH ?? "", ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: done.exitCode,
		out: done.stdout.toString(),
		err: done.stderr.toString(),
	};
}

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

test("print_summary reads each persisted result", () => {
	const readOut = script("print_summary.py", files.read);
	expect(readOut.code).toBe(0);
	expect(readOut.out).toContain("not evidence of absence");
	expect(readOut.out).toContain("ERRORS: 1");
	expect(readOut.out).toContain("billing timeout");
	expect(readOut.out).toContain("1 more runs omitted");
	const runOut = script("print_summary.py", files.run);
	expect(runOut.out).toContain("Requests:  2  Calls: 1  Failed: 1");
	expect(runOut.out).toContain("No, the test still fails");
});

test("print_timeline orders requests and records, and marks failures", () => {
	const runOut = script("print_timeline.py", files.run);
	expect(runOut.code).toBe(0);
	expect(runOut.out).toContain("1. [request] q5  +0.0s  (4.0s) ERR");
	expect(runOut.out).toContain("2. [request] q8  +10.0s  (2.5s)");
	const readOut = script("print_timeline.py", files.read, { MAX_LEN: "40" });
	expect(readOut.out).toContain("4. [tool_result] Bash  (@7.0) ERR");
	expect(readOut.out).toContain("CUT");
});

test("extract_run prints one run in full and fails on no match", () => {
	const hit = script("extract_run.py", files.read, { RUN: "sess-1/main#1" });
	expect(hit.code).toBe(0);
	expect(hit.out).toContain("--- @7.0 tool_result Bash  [ERROR] ---");
	expect(hit.out).toContain("Details Details");
	const miss = script("extract_run.py", files.read, { RUN: "nope" });
	expect(miss.code).toBe(1);
	expect(miss.err).toContain("No run matching 'nope'");
	const usage = script("extract_run.py", files.read);
	expect(usage.code).toBe(1);
});

test("extract_conversation shows prompts, tool calls and results by role, head and tail", () => {
	const out = script("extract_conversation.py", files.read, { MAX_LEN: "60" });
	expect(out.code).toBe(0);
	expect(out.out).toContain("[USER]");
	expect(out.out).toContain("[tool_use: Bash] bun test billing");
	expect(out.out).toContain("[tool_result: toolu_1 ERROR]");
	expect(out.out).toMatch(/\.\.\. \[\d+ chars\] \.\.\./u);
	const runOut = script("extract_conversation.py", files.run);
	expect(runOut.out).toContain("[USER (next prompt)]");
});

test("search_runs finds a string anywhere and names the run it is in", () => {
	const out = script("search_runs.py", files.read, { SEARCH: "503" });
	expect(out.code).toBe(0);
	expect(out.out).toContain("[sess-1/main#1] .reads[0].sections[3].text");
	const none = script("search_runs.py", files.read, { SEARCH: "absent" });
	expect(none.err).toContain("Check the cut markers");
});

test("the skill names every script it ships, and ships every script it names", async () => {
	const docs = [...new Bun.Glob("*.md").scanSync(join(SCRIPTS, ".."))];
	const skill = (
		await Promise.all(
			docs.map((doc) => Bun.file(join(SCRIPTS, "..", doc)).text()),
		)
	).join("\n");
	const shipped = [...new Bun.Glob("*.py").scanSync(SCRIPTS)].sort();
	const named = [
		...new Set([...skill.matchAll(/scripts\/(\w+\.py)/gu)].map((m) => m[1])),
	].sort();
	expect(named).toEqual(shipped);
	expect(shipped).toHaveLength(6);
});

test("show_structure prints keys and types without values, from a file or stdin", () => {
	const out = script("show_structure.py", files.run);
	expect(out.code).toBe(0);
	expect(out.out).toContain("view: {...}");
	expect(out.out).toContain("text: str[");
	expect(out.out).not.toContain("billing");
	const plain = join(directory, "plain.json");
	writeFileSync(plain, read);
	const piped = Bun.spawnSync(
		["python3", "-I", join(SCRIPTS, "show_structure.py")],
		{ stdin: Bun.file(plain), stdout: "pipe" },
	);
	expect(piped.stdout.toString()).toContain("reads: [...] (1 items)");
});
