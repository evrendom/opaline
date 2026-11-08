import { afterEach, describe, expect, test } from "bun:test";
import {
	pickedAgentOf,
	pickedRunOf,
	pickOf,
	placePick,
	readPick,
	syncPick,
	writePick,
} from "./reader-params";
import { SESSION_VIEW_HREFS } from "./session-reader-tabs";

const sorted = (params: URLSearchParams | string) =>
	[...new URLSearchParams(params).entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");

const globals = globalThis as { window?: unknown };
const hadWindow = "window" in globals;
const originalWindow = globals.window;
function at(search: string) {
	globals.window = { location: { search } };
}
afterEach(() => {
	if (hadWindow) globals.window = originalWindow;
	else delete globals.window;
});

describe("writePick", () => {
	test("a run: its turn follows it, no subagent", () => {
		const params = new URLSearchParams("sessionTab=files&subagent=s&agent=s");
		writePick(params, pickOf("r1", null));
		expect(sorted(params)).toBe("run=r1&sessionTab=files&turn=r1");
	});

	test("a subagent of a run: read on its own in the detail too", () => {
		const params = new URLSearchParams();
		writePick(params, pickOf("r1", "s1"));
		expect(sorted(params)).toBe("agent=s1&run=r1&subagent=s1&turn=r1");
	});

	test("the entire session: every pick param let go", () => {
		const params = new URLSearchParams(
			"run=r1&turn=r1&subagent=s1&agent=s1&file=a.ts",
		);
		writePick(params, pickOf(null, null));
		expect(sorted(params)).toBe("file=a.ts");
	});

	test("a subagent with no run is no pick at all", () => {
		const params = new URLSearchParams("run=r0&turn=r0");
		writePick(params, pickOf(null, "s1"));
		expect(sorted(params)).toBe("");
	});
});

describe("syncPick", () => {
	test("the detail's params set to the run and subagent a view wrote", () => {
		const params = new URLSearchParams("run=r2&subagent=s2&turn=r1&agent=s1");
		syncPick(params);
		expect(sorted(params)).toBe("agent=s2&run=r2&subagent=s2&turn=r2");
	});

	test("a subagent alone is let go, with the detail's", () => {
		const params = new URLSearchParams("subagent=s2&agent=s2&turn=r1");
		syncPick(params);
		expect(sorted(params)).toBe("");
	});
});

describe("SESSION_VIEW_HREFS", () => {
	const page =
		"sessionTab=files&file=a.ts&read=c1&run=r1&turn=r1&subagent=s1&agent=s1&call=e1&setup=CLAUDE.md&pr=o%2Fn%2312&ci=9";

	test("ci: the whole session's CI, the other views' picks let go", () => {
		at(`?${page}`);
		expect(sorted(SESSION_VIEW_HREFS.ci({ pr: "o/n#3" }).slice(1))).toBe(
			"pr=o/n#3&sessionTab=ci",
		);
		expect(sorted(SESSION_VIEW_HREFS.ci({ ci: "77" }).slice(1))).toBe(
			"ci=77&sessionTab=ci",
		);
	});

	test("file: on a file, under a run when given", () => {
		at(`?${page}`);
		expect(
			sorted(SESSION_VIEW_HREFS.file({ file: "b.ts", run: "r9" }).slice(1)),
		).toBe("file=b.ts&run=r9&sessionTab=files&turn=r9");
		expect(sorted(SESSION_VIEW_HREFS.file({ file: "b.ts" }).slice(1))).toBe(
			"file=b.ts&sessionTab=files",
		);
	});

	test("setup: the whole session's setup, on a file", () => {
		at(`?${page}`);
		expect(sorted(SESSION_VIEW_HREFS.setup("AGENTS.md").slice(1))).toBe(
			"sessionTab=setup&setup=AGENTS.md",
		);
		expect(sorted(SESSION_VIEW_HREFS.setup().slice(1))).toBe(
			"sessionTab=setup",
		);
	});

	test("subagent: the detail, reading it with no run", () => {
		at(`?${page}`);
		expect(sorted(SESSION_VIEW_HREFS.subagent("s7").slice(1))).toBe(
			"agent=s7&call=e1&sessionTab=detail&subagent=s7",
		);
	});

	test("the summary is the view with no sessionTab", () => {
		at("?sessionTab=summary&run=r1&turn=r1");
		expect(SESSION_VIEW_HREFS.subagent("s1")).toBe(
			"?sessionTab=detail&agent=s1&subagent=s1",
		);
	});
});

describe("the pick an address names", () => {
	test("the entire session, a run, a subagent of it", () => {
		expect(readPick(new URLSearchParams(""))).toEqual({ kind: "session" });
		expect(readPick(new URLSearchParams("run=r1&turn=r1"))).toEqual({
			kind: "run",
			run: "r1",
		});
		expect(
			readPick(new URLSearchParams("run=r1&subagent=s1&agent=s1")),
		).toEqual({ kind: "subagent", run: "r1", subagent: "s1" });
	});

	test("a subagent with no run: unplaced, till its launch places it", () => {
		const pick = readPick(new URLSearchParams("subagent=s1&agent=s1"));
		expect(pick).toEqual({ kind: "unplaced", subagent: "s1" });
		expect(pickedRunOf(pick)).toBeNull();
		expect(pickedAgentOf(pick)).toBeNull();
		const placed = placePick(pick, new Map([["s1", "r7"]]));
		expect(placed).toEqual({ kind: "subagent", run: "r7", subagent: "s1" });
		expect([pickedRunOf(placed), pickedAgentOf(placed)]).toEqual(["r7", "s1"]);
		expect(placePick(pick, new Map())).toBe(pick);
	});

	test("written and read back, the same pick", () => {
		for (const pick of [
			pickOf(null, null),
			pickOf("r1", null),
			pickOf("r1", "s1"),
		]) {
			const params = new URLSearchParams("sessionTab=files");
			writePick(params, pick);
			expect(readPick(params)).toEqual(pick);
		}
	});
});
