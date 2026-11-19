import { expect, test } from "bun:test";
import { updateReaderParams, writeAgent, writePick } from "./reader-params";

let current = new URLSearchParams();
function at(search: string) {
	current = new URLSearchParams(search);
}

function run(update: (params: URLSearchParams) => void, replace?: boolean) {
	const calls: { params: string; replace: boolean }[] = [];
	updateReaderParams(
		Object.assign(
			(params: URLSearchParams, options: { replace: boolean }) =>
				calls.push({ params: params.toString(), replace: options.replace }),
			{ current: () => current },
		),
		update,
		replace === undefined ? undefined : { replace },
	);
	return calls[0];
}

test("leaving a subagent for its session adds a history entry", () => {
	at("?sessionTab=detail&agent=a1&subagent=a1");
	expect(run((params) => writeAgent(params, null))).toEqual({
		params: "sessionTab=detail",
		replace: false,
	});
});

test("opening a subagent and switching tabs add history entries", () => {
	at("?sessionTab=detail");
	expect(
		run((params) =>
			writePick(params, { kind: "subagent", run: "t1", subagent: "a1" }),
		)?.replace,
	).toBe(false);
	expect(run((params) => params.set("sessionTab", "files"))?.replace).toBe(
		false,
	);
});

test("picking another run in the same agent and tab replaces the entry", () => {
	at("?sessionTab=detail&run=t1&turn=t1");
	expect(
		run((params) => writePick(params, { kind: "run", run: "t2" }))?.replace,
	).toBe(true);
});

test("an explicit replace wins", () => {
	at("?sessionTab=detail&agent=a1&subagent=a1");
	expect(run((params) => writeAgent(params, null), true)?.replace).toBe(true);
});
