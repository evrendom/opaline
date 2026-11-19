import { describe, expect, test } from "bun:test";
import { callHrefOf } from "./session-reader-summary-errors";

const from = (search: string) => new URLSearchParams(search);
const paramsOf = (href: string) =>
	Object.fromEntries(new URLSearchParams(href));

describe("callHrefOf", () => {
	test("a call in a run lets go of a subagent picked before", () => {
		const href = callHrefOf(
			from("sessionTab=summary&run=r0&turn=r0&subagent=s9&agent=s9"),
			{ run: "r1", step: "e1" },
		);
		expect(paramsOf(href)).toEqual({
			call: "e1",
			run: "r1",
			sessionTab: "detail",
			turn: "r1",
		});
	});

	test("a call in a subagent picks that subagent under its run", () => {
		const href = callHrefOf(from("sessionTab=summary&subagent=s9&agent=s9"), {
			run: "r1",
			step: "e1",
			subagent: "s2",
		});
		expect(paramsOf(href)).toEqual({
			agent: "s2",
			call: "e1",
			run: "r1",
			sessionTab: "detail",
			subagent: "s2",
			turn: "r1",
		});
	});
});
