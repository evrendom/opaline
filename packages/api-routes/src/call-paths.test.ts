import { describe, expect, test } from "bun:test";
import { absolutePath, callDirectory } from "./call-paths.js";

describe("where a call's files are", () => {
	test("a command's leading cds move it, ~ from the session's home", () => {
		const session = "/Users/me/Documents/app";
		expect(callDirectory("cd ~/repo && sed -n 1,9p a.ts", session)).toBe(
			"/Users/me/repo",
		);
		expect(callDirectory("cd /x && cd y; cat a", session)).toBe("/x/y");
		expect(callDirectory('cd "$DIR" && cat a', session)).toBe(session);
		expect(callDirectory("cat a", session)).toBe(session);
		expect(callDirectory(undefined, session)).toBe(session);
	});

	test("paths made absolute against it; kept as named without one", () => {
		expect(absolutePath("src/a.ts", "/r")).toBe("/r/src/a.ts");
		expect(absolutePath("../../p.json", "/r/apps/web")).toBe("/r/p.json");
		expect(absolutePath("/abs/./a.ts", "/r")).toBe("/abs/a.ts");
		expect(absolutePath("src/a.ts", "")).toBe("src/a.ts");
	});

	test("a command's paths from the directory its cds leave it in", () => {
		expect(
			absolutePath(
				"types.ts",
				callDirectory("cd ~/repo/src && cat types.ts", "/Users/me/x"),
			),
		).toBe("/Users/me/repo/src/types.ts");
		expect(
			absolutePath("../b.ts", callDirectory("cd /a/b && cat ../b.ts", "")),
		).toBe("/a/b.ts");
		expect(
			absolutePath("a.ts", callDirectory("cd ~/repo && cat a.ts", "")),
		).toBe("~/repo/a.ts");
		expect(absolutePath("~/repo/a.ts", "/Users/me/x")).toBe(
			"/Users/me/repo/a.ts",
		);
		expect(
			absolutePath("a.ts", callDirectory('cd "$DIR" && cat a.ts', "")),
		).toBe("a.ts");
	});
});
