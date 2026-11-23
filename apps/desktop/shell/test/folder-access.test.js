const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	askForSessionFolders,
	codexCwd,
	geminiProjectRoots,
	guardedFolders,
} = require("../folder-access");

const home = "/Users/ada";
const none = async () => [];

describe("guarded folders", () => {
	test("Documents, Desktop, Downloads and iCloud are asked for when a session ran there", async () => {
		expect(
			await guardedFolders(
				{
					claudeFolders: [
						"-Users-ada-Documents-ChatGPT-opaline",
						"-Users-ada-Library-Mobile-Documents-com-apple-CloudDocs-x",
					],
					codexPaths: [
						"/Users/ada/Desktop/notes",
						"/Users/ada/downloads/repo/../repo",
					],
				},
				{ home, list: none },
			),
		).toEqual([
			"/Users/ada/Desktop",
			"/Users/ada/Documents",
			"/Users/ada/Downloads",
			"/Users/ada/Library/Mobile Documents",
		]);
	});

	test("code folders and look-alike names are not asked for", async () => {
		expect(
			await guardedFolders(
				{
					claudeFolders: [
						"-Users-ada-coding-projects-opaline",
						"-Users-ada-DocumentsX",
						"-Users-ada",
					],
					codexPaths: ["/Users/ada/Documents-old/app", "/private/tmp"],
				},
				{ home, list: none },
			),
		).toEqual([]);
	});

	test("a cloud provider or a disk is asked for only when a session ran inside it", async () => {
		const listed = {
			"/Users/ada/Library/CloudStorage": [
				"/Users/ada/Library/CloudStorage/GoogleDrive-a",
				"/Users/ada/Library/CloudStorage/Dropbox",
			],
			"/Volumes": ["/Volumes/External", "/Volumes/Macintosh HD"],
		};
		expect(
			await guardedFolders(
				{
					claudeFolders: ["-Users-ada-Library-CloudStorage-GoogleDrive-a-b"],
					codexPaths: ["/Volumes/External/code"],
				},
				{ home, list: async (folder) => listed[folder] ?? [] },
			),
		).toEqual([
			"/Users/ada/Library/CloudStorage/GoogleDrive-a",
			"/Volumes/External",
		]);
	});
});

describe("asking", () => {
	let root;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-folder-access-"));
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	test("a Codex transcript's folder is read from the start of its first line", async () => {
		const file = path.join(root, "rollout.jsonl");
		fs.writeFileSync(
			file,
			`${JSON.stringify({ type: "session_meta", payload: { id: "a", cwd: '/Users/ada/Documents/app "x"', instructions: "y".repeat(20_000) } })}\n`,
		);
		expect(await codexCwd(file)).toBe('/Users/ada/Documents/app "x"');
		expect(await codexCwd(path.join(root, "missing.jsonl"))).toBeUndefined();
	});

	test("folders are read one at a time and each answer is reported", async () => {
		const claudeRoot = path.join(root, "projects");
		fs.mkdirSync(path.join(claudeRoot, encodeURIComponent("x")), {
			recursive: true,
		});
		fs.mkdirSync(
			path.join(
				claudeRoot,
				`${os.homedir().replace(/[^A-Za-z0-9]/gu, "-")}-Documents-app`,
			),
		);
		fs.mkdirSync(
			path.join(
				claudeRoot,
				`${os.homedir().replace(/[^A-Za-z0-9]/gu, "-")}-Desktop-app`,
			),
		);
		let reading = 0;
		const read = async (folder) => {
			reading += 1;
			expect(reading).toBe(1);
			await new Promise((resolve) => setTimeout(resolve, 5));
			reading -= 1;
			if (folder.endsWith("Desktop"))
				throw Object.assign(new Error("denied"), { code: "EPERM" });
			return [];
		};
		const answers = await askForSessionFolders({
			claudeRoot,
			codexFiles: [],
			platform: "darwin",
			read,
		});
		expect(answers.map(({ folder, granted }) => ({ folder, granted }))).toEqual(
			[
				{ folder: path.join(os.homedir(), "Desktop"), granted: false },
				{ folder: path.join(os.homedir(), "Documents"), granted: true },
			],
		);
	});

	test("other systems are never asked", async () => {
		expect(
			await askForSessionFolders({
				claudeRoot: root,
				codexFiles: [],
				platform: "linux",
			}),
		).toEqual([]);
	});
});

describe("Gemini", () => {
	let root;
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-gemini-folders-"));
	});
	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	test("the folders Gemini CLI ran in come from projects.json and each .project_root", async () => {
		fs.mkdirSync(path.join(root, "tmp", "site"), { recursive: true });
		fs.writeFileSync(
			path.join(root, "tmp", "site", ".project_root"),
			"/Users/ada/Desktop/site\n",
		);
		fs.writeFileSync(
			path.join(root, "projects.json"),
			JSON.stringify({
				projects: { "/Users/ada/Documents/app": "app", "/": "root" },
			}),
		);
		const roots = await geminiProjectRoots(root);
		expect(roots.sort()).toEqual([
			"/Users/ada/Desktop/site",
			"/Users/ada/Documents/app",
		]);
		expect(
			await guardedFolders(
				{ claudeFolders: [], codexPaths: [], geminiPaths: roots },
				{ home, list: none },
			),
		).toEqual(["/Users/ada/Desktop", "/Users/ada/Documents"]);
	});
});
