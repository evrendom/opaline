const { afterEach, beforeEach, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { KEEP_DAYS, keepClaudeTranscripts } = require("../stack/transcripts");

let root;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-transcripts-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test("Claude Code keeps its transcripts once the app has run", () => {
	const file = path.join(root, "settings.json");
	fs.writeFileSync(file, JSON.stringify({ model: "opus" }));
	expect(keepClaudeTranscripts(file)).toEqual({
		changed: true,
		days: KEEP_DAYS,
	});
	expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
		model: "opus",
		cleanupPeriodDays: KEEP_DAYS,
	});
	expect(keepClaudeTranscripts(file).changed).toBe(false);
});

test("a retention the user chose stays, and nothing is written without Claude Code", () => {
	const file = path.join(root, "settings.json");
	fs.writeFileSync(file, JSON.stringify({ cleanupPeriodDays: 7 }));
	expect(keepClaudeTranscripts(file)).toEqual({
		changed: false,
		reason: "user-setting",
		days: 7,
	});
	expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
		cleanupPeriodDays: 7,
	});
	const missing = path.join(root, "nope", "settings.json");
	expect(keepClaudeTranscripts(missing)).toEqual({
		changed: false,
		reason: "no-claude",
	});
	expect(fs.existsSync(missing)).toBe(false);
});

test("a settings file it cannot read is left alone", () => {
	const file = path.join(root, "settings.json");
	fs.writeFileSync(file, "{ not json");
	expect(keepClaudeTranscripts(file).reason).toBe("unreadable");
	expect(fs.readFileSync(file, "utf8")).toBe("{ not json");
});
