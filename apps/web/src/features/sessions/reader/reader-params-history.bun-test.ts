import { afterEach, expect, test } from "bun:test";
import { updateReaderParams, writeAgent, writePick } from "./reader-params";

const originalWindow = globalThis.window;
afterEach(() => {
	globalThis.window = originalWindow;
});

function at(search: string) {
	globalThis.window = { location: { search } } as typeof globalThis.window;
}

function run(update: (params: URLSearchParams) => void, replace?: boolean) {
	const calls: { params: string; replace: boolean }[] = [];
	updateReaderParams(
		(params, options) =>
			calls.push({ params: params.toString(), replace: options.replace }),
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
