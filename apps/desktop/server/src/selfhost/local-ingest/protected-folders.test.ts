import { describe, expect, test } from "bun:test";
import {
	encodesProtectedPath,
	isProtectedPath,
	protectedFolders,
} from "./protected-folders.js";

const guarded = protectedFolders("/Users/ada", "darwin");

describe("protected folders", () => {
	test("paths in Documents, Desktop, Downloads, iCloud and other volumes are protected", () => {
		for (const path of [
			"/Users/ada/Documents",
			"/Users/ada/Documents/ChatGPT/opaline",
			"/Users/ada/documents/app",
			"/Users/ada/Desktop/notes.md",
			"/Users/ada/Downloads/repo/../repo",
			"/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/x",
			"/Users/ada/Library/CloudStorage/GoogleDrive-a/b",
			"/Volumes/External/code",
		])
			expect(isProtectedPath(path, guarded)).toBe(true);
	});

	test("the home folder, code folders and look-alike names are not", () => {
		for (const path of [
			"/Users/ada",
			"/Users/ada/coding-projects/opaline",
			"/Users/ada/Documents-old/app",
			"/Users/ada/.claude/projects",
			"/private/tmp",
		])
			expect(isProtectedPath(path, guarded)).toBe(false);
	});

	test("Claude Code's encoded project folder names are matched the same way", () => {
		expect(
			encodesProtectedPath("-Users-ada-Documents-ChatGPT-opaline", guarded),
		).toBe(true);
		expect(
			encodesProtectedPath(
				"-Users-ada-Library-Mobile-Documents-com-apple-CloudDocs-x",
				guarded,
			),
		).toBe(true);
		expect(
			encodesProtectedPath("-Users-ada-coding-projects-opaline", guarded),
		).toBe(false);
		expect(encodesProtectedPath("-Users-ada-DocumentsX", guarded)).toBe(false);
	});

	test("other systems have no protected folders", () => {
		expect(protectedFolders("/home/ada", "linux")).toEqual([]);
	});
});
