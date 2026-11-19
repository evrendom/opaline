import { expect, test } from "bun:test";
import {
	clickBox,
	clickThing,
	EMPTY,
	isLit,
	type Selection,
} from "./session-reader-context-selection";

const READ = "files:read";
const GIT = "program:git";

test("a click picks one alone, replacing what was picked", () => {
	let at: Selection = clickThing(EMPTY, READ, "a.ts", false);
	at = clickThing(at, READ, "b.ts", false);
	expect(at).toEqual({ lits: [{ key: READ, thing: "b.ts" }], zoom: READ });
	at = clickBox(at, GIT, false);
	expect(at).toEqual({ lits: [{ key: GIT, thing: null }], zoom: GIT });
});

test("the same one clicked again lets it go", () => {
	const once = clickThing(EMPTY, READ, "a.ts", false);
	expect(clickThing(once, READ, "a.ts", false)).toEqual({
		lits: [],
		zoom: READ,
	});
	const box = clickBox(EMPTY, READ, false);
	expect(clickBox(box, READ, false)).toEqual(EMPTY);
});

test("shift adds and takes away, nothing left behind", () => {
	let at = clickThing(EMPTY, READ, "a.ts", false);
	at = clickThing(at, READ, "b.ts", true);
	at = clickThing(at, GIT, "git diff", true);
	expect(at.lits).toHaveLength(3);
	at = clickThing(at, READ, "a.ts", true);
	at = clickThing(at, READ, "b.ts", true);
	at = clickThing(at, GIT, "git diff", true);
	expect(at.lits).toEqual([]);
});

test("a part whole and things of it are never picked together", () => {
	let at = clickBox(EMPTY, READ, false);
	expect(isLit(at.lits, READ, "a.ts")).toBe(true);
	at = clickThing(at, READ, "a.ts", false);
	expect(at.lits).toEqual([{ key: READ, thing: "a.ts" }]);
	at = clickBox(EMPTY, READ, false);
	at = clickThing(at, READ, "b.ts", true);
	expect(isLit(at.lits, READ, "a.ts")).toBe(false);
	expect(isLit(at.lits, READ, "b.ts")).toBe(false);
	at = clickThing(EMPTY, READ, "a.ts", false);
	at = clickThing(at, GIT, "git log", true);
	at = clickBox(at, READ, true);
	expect(at.lits).toEqual([{ key: GIT, thing: "git log" }]);
});

test("a run zoomed alone; with shift, what's picked kept", () => {
	const picked = clickThing(EMPTY, READ, "a.ts", false);
	expect(clickBox(picked, "run:1", false)).toEqual({ lits: [], zoom: "run:1" });
	expect(clickBox(picked, "run:1", true)).toEqual({
		lits: picked.lits,
		zoom: "run:1",
	});
	expect(clickBox({ lits: [], zoom: "run:1" }, "run:1", false)).toEqual(EMPTY);
});
