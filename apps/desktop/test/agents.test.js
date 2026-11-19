const { afterEach, beforeEach, expect, mock, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let root;

mock.module("electron", () => ({
	app: {
		getVersion: () => "0.0.0",
		getPath: (name) => path.join(root, name),
	},
}));

const {
	EARLIER_INSTRUCTION_LINES,
	INSTRUCTION_LINE,
	addInstructionLine,
	instructionFile,
	offerInstructionLine,
	removeInstructionLine,
	removeInstructionLines,
	updateInstructionLines,
	writeMarketplace,
} = require("../agents");

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-desktop-agents-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const pluginDir = path.join(__dirname, "..", "..", "..", "plugins", "opaline");
const server = { mcpUrl: "http://127.0.0.1:4100/api/mcp", apiKey: "key-1" };
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("both agents' plugins ping the local server from their Stop and SessionEnd hooks", () => {
	const { root: marketplace } = writeMarketplace({ pluginDir, server });
	const script = path.join(root, "userData", "bin", "opaline-hook");
	const claude = read(
		path.join(marketplace, "opaline-claude", "hooks", "hooks.json"),
	);
	const codex = read(
		path.join(marketplace, "opaline-codex", "hooks", "hooks.json"),
	);
	expect(claude.hooks.Stop[0].hooks).toEqual([
		{ type: "command", command: `"${script}" claude` },
	]);
	expect(codex.hooks.Stop[0].hooks).toEqual([
		{ type: "command", command: `"${script}" codex` },
	]);
	expect(codex.hooks.SessionEnd[0].hooks).toEqual([
		{ type: "command", command: `"${script}" codex`, timeout: 3 },
	]);
	expect(
		read(path.join(marketplace, "opaline-codex", ".mcp.json")).mcpServers
			.opaline.http_headers,
	).toEqual({ Authorization: "Bearer key-1" });
});

test("the plugin version follows what the plugins contain, so a changed key reinstalls them", () => {
	const first = writeMarketplace({ pluginDir, server }).version;
	expect(writeMarketplace({ pluginDir, server }).version).toBe(first);
	expect(
		writeMarketplace({ pluginDir, server: { ...server, apiKey: "key-2" } })
			.version,
	).not.toBe(first);
});

const text = (file) => fs.readFileSync(file, "utf8");

test("the installed plugin carries the skills, playbook files and manifests of plugins/opaline", () => {
	const { root: marketplace, version } = writeMarketplace({
		pluginDir,
		server,
	});
	const baseVersion = read(
		path.join(pluginDir, ".claude-plugin", "plugin.json"),
	).version;
	expect(version).toMatch(
		new RegExp(`^${baseVersion.replaceAll(".", "\\.")}-local\\.[0-9a-f]{10}$`),
	);
	for (const agent of ["claude", "codex"]) {
		const target = path.join(marketplace, `opaline-${agent}`);
		const skill = text(path.join(target, "skills", "opaline", "SKILL.md"));
		expect(skill).toBe(
			text(path.join(pluginDir, "skills", "opaline", "SKILL.md")),
		);
		expect(skill).toContain("Nothing leaves this Mac");
		expect(skill).toContain("open the Opaline app and connect their agents");
		expect(skill).toContain("open in the Opaline app, never in a browser");
		for (const line of skill
			.split("\n")
			.filter((line) => /browser/i.test(line)))
			expect(line).toContain("never in a browser");
		expect(text(path.join(target, "skills", "setup", "SKILL.md"))).toBe(
			text(path.join(pluginDir, "skills", "setup", "SKILL.md")),
		);
		for (const shared of [
			"retro.md",
			"classic.md",
			"examples.md",
			"large-results.md",
			"scripts/print_summary.py",
		])
			expect(text(path.join(target, "skills", "opaline", shared))).toBe(
				text(path.join(pluginDir, "skills", "opaline", shared)),
			);
		for (const named of skill.match(/`[a-z-]+\.md`/g) ?? [])
			expect(
				fs.existsSync(
					path.join(target, "skills", "opaline", named.slice(1, -1)),
				),
			).toBe(true);
		for (const manifest of [
			".claude-plugin/plugin.json",
			".codex-plugin/plugin.json",
		]) {
			const value = read(path.join(target, manifest));
			expect(value.version).toBe(version);
			expect(value.description).toContain("on this Mac");
		}
		const codex = read(path.join(target, ".codex-plugin", "plugin.json"));
		expect(codex.extensions["com.openai"]).toEqual({
			onboardingSkill: "./skills/setup/SKILL.md",
		});
		expect(fs.existsSync(path.join(target, "assets", "opaline.png"))).toBe(
			true,
		);
	}
});

test("nothing in the plugin's manifests or skills sends the user to opaline.so or talks about a team", () => {
	const files = [
		".claude-plugin/plugin.json",
		".codex-plugin/plugin.json",
		"skills/opaline/SKILL.md",
		"skills/setup/SKILL.md",
	].map((file) => path.join(pluginDir, file));
	const found = [];
	for (const file of files) {
		const content = text(file).replace(
			/"(url|homepage|websiteURL)": "https:\/\/opaline\.so"/g,
			"",
		);
		for (const phrase of [
			/opaline\.so/i,
			/\bteam'?s?\b/i,
			/teammate/i,
			/\bmembers?\b/i,
			/billing/i,
			/sign in/i,
			/share it with/i,
		]) {
			const match = content.match(phrase);
			if (match) found.push([path.relative(pluginDir, file), match[0]]);
		}
	}
	expect(found).toEqual([]);
});

test("the skills have valid front matter, and the opaline skill triggers on session analysis in either agent", () => {
	for (const skill of ["opaline", "setup"]) {
		const content = text(path.join(pluginDir, "skills", skill, "SKILL.md"));
		const front = /^---\n([\s\S]*?)\n---\n/.exec(content);
		const parsed = Bun.YAML.parse(front?.[1] ?? "");
		expect(parsed.name).toBe(skill);
		expect(parsed.description.length).toBeGreaterThan(20);
		expect(parsed.description.length).toBeLessThanOrEqual(1024);
	}
	const description = Bun.YAML.parse(
		/^---\n([\s\S]*?)\n---\n/.exec(
			text(path.join(pluginDir, "skills", "opaline", "SKILL.md")),
		)[1],
	).description;
	for (const trigger of [
		"Claude Code",
		"Codex",
		"analyse, review or retro my agent sessions",
		"where did it get stuck",
		"why was that run slow or expensive",
		"compare Claude Code and Codex runs",
		"cost",
	])
		expect(description).toContain(trigger);
});

test("changing the skill text changes the plugin version", () => {
	const first = writeMarketplace({ pluginDir, server }).version;
	const changed = path.join(root, "changed-plugin");
	fs.cpSync(pluginDir, changed, { recursive: true });
	fs.appendFileSync(
		path.join(changed, "skills", "opaline", "SKILL.md"),
		"\nMore.\n",
	);
	expect(writeMarketplace({ pluginDir: changed, server }).version).not.toBe(
		first,
	);
});

const fakeHome = () => {
	const home = path.join(root, "home");
	return {
		CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
		CODEX_HOME: path.join(home, "codex-home"),
	};
};

test("the instruction files follow CLAUDE_CONFIG_DIR and CODEX_HOME, else the home folder", () => {
	expect(instructionFile("claude", {})).toBe(
		path.join(os.homedir(), ".claude", "CLAUDE.md"),
	);
	expect(instructionFile("codex", {})).toBe(
		path.join(os.homedir(), ".codex", "AGENTS.md"),
	);
	const env = fakeHome();
	expect(instructionFile("claude", env)).toBe(
		path.join(env.CLAUDE_CONFIG_DIR, "CLAUDE.md"),
	);
	expect(instructionFile("codex", env)).toBe(
		path.join(env.CODEX_HOME, "AGENTS.md"),
	);
});

test("the line is appended once after the user's own text, and removing it gives that text back", () => {
	const file = path.join(root, "home", ".claude", "CLAUDE.md");
	for (const original of [
		"# Mine\n\n- keep this\n",
		"# Mine\n- no newline at the end",
		"ends with a gap\n\n",
	]) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, original);
		expect(addInstructionLine(file)).toBe(true);
		const added = text(file);
		expect(added.startsWith(original)).toBe(true);
		expect(added.endsWith(`${INSTRUCTION_LINE}\n`)).toBe(true);
		expect(addInstructionLine(file)).toBe(false);
		expect(text(file)).toBe(added);
		expect(removeInstructionLine(file)).toBe(true);
		expect(text(file)).toBe(
			original.endsWith("\n") ? original : `${original}\n`,
		);
		expect(removeInstructionLine(file)).toBe(false);
	}
});

test("a missing instruction file is created with the line, and removed again when the line was all it held", () => {
	const file = path.join(root, "home", "codex-home", "AGENTS.md");
	expect(addInstructionLine(file)).toBe(true);
	expect(text(file)).toBe(`${INSTRUCTION_LINE}\n`);
	expect(removeInstructionLine(file)).toBe(true);
	expect(fs.existsSync(file)).toBe(false);
});

test("a line the user moved between their own lines is found, and only it is removed", () => {
	const file = path.join(root, "home", ".claude", "CLAUDE.md");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `one\n\n  ${INSTRUCTION_LINE}\ntwo\n`);
	expect(addInstructionLine(file)).toBe(false);
	expect(removeInstructionLine(file)).toBe(true);
	expect(text(file)).toBe("one\n\ntwo\n");
});

test("Connect asks once; a yes adds the line to every connected agent's file, later connects add it without asking", async () => {
	const env = fakeHome();
	fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
	fs.writeFileSync(instructionFile("claude", env), "");
	const asked = [];
	const confirm = async (files) => {
		asked.push(files);
		return true;
	};
	const first = await offerInstructionLine({
		keys: ["claude", "codex"],
		env,
		confirm,
	});
	expect(asked).toEqual([
		[instructionFile("claude", env), instructionFile("codex", env)],
	]);
	expect(first).toEqual({
		answer: "accepted",
		added: [instructionFile("claude", env), instructionFile("codex", env)],
	});
	expect(text(instructionFile("codex", env))).toBe(`${INSTRUCTION_LINE}\n`);
	fs.rmSync(instructionFile("claude", env));
	expect(
		await offerInstructionLine({ keys: ["codex", "claude"], env, confirm }),
	).toEqual({ answer: "accepted", added: [] });
	expect(fs.existsSync(instructionFile("claude", env))).toBe(false);
	expect(
		await offerInstructionLine({ keys: ["claude"], env, confirm }),
	).toEqual({ answer: "accepted", added: [] });
	expect(fs.existsSync(instructionFile("claude", env))).toBe(false);
	fs.writeFileSync(instructionFile("claude", env), "");
	expect(
		await offerInstructionLine({ keys: ["claude"], env, confirm }),
	).toEqual({ answer: "accepted", added: [instructionFile("claude", env)] });
	expect(asked).toHaveLength(1);
	expect(text(instructionFile("claude", env))).toBe(`${INSTRUCTION_LINE}\n`);
	expect(removeInstructionLines({ keys: ["claude", "codex"], env })).toEqual([
		instructionFile("claude", env),
		instructionFile("codex", env),
	]);
	expect(fs.existsSync(instructionFile("claude", env))).toBe(false);
});

test("a no is remembered: nothing is written and Connect does not ask again", async () => {
	const env = fakeHome();
	let asks = 0;
	const confirm = async () => {
		asks += 1;
		return false;
	};
	for (let attempt = 0; attempt < 2; attempt += 1)
		expect(
			await offerInstructionLine({ keys: ["claude", "codex"], env, confirm }),
		).toEqual({ answer: "declined", added: [] });
	expect(asks).toBe(1);
	expect(fs.existsSync(path.join(root, "home"))).toBe(false);
	const file = instructionFile("claude", env);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${INSTRUCTION_LINE}\n`);
	expect(removeInstructionLines({ keys: ["claude"], env })).toEqual([]);
	expect(text(file)).toBe(`${INSTRUCTION_LINE}\n`);
});

test("without a CLAUDE.md none is created: only AGENTS.md is offered and written", async () => {
	const env = fakeHome();
	const asked = [];
	const confirm = async (files) => {
		asked.push(files);
		return true;
	};
	expect(
		await offerInstructionLine({ keys: ["claude", "codex"], env, confirm }),
	).toEqual({ answer: "accepted", added: [instructionFile("codex", env)] });
	expect(asked).toEqual([[instructionFile("codex", env)]]);
	expect(fs.existsSync(instructionFile("claude", env))).toBe(false);
	expect(addInstructionLine(instructionFile("claude", env))).toBe(false);
	expect(fs.existsSync(instructionFile("claude", env))).toBe(false);
});

test("with only Claude Code connected and no CLAUDE.md, nothing is asked or written", async () => {
	const env = fakeHome();
	let asks = 0;
	const confirm = async () => {
		asks += 1;
		return true;
	};
	expect(
		await offerInstructionLine({ keys: ["claude"], env, confirm }),
	).toEqual({ answer: "no file", added: [] });
	expect(asks).toBe(0);
	expect(fs.existsSync(path.join(root, "home"))).toBe(false);
});

test("an earlier line is swapped for the current one in place, and removing finds either", async () => {
	const env = fakeHome();
	const [earlier] = EARLIER_INSTRUCTION_LINES;
	const claude = instructionFile("claude", env);
	const codex = instructionFile("codex", env);
	for (const file of [claude, codex]) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `one\n  ${earlier}\ntwo\n`);
	}
	expect(updateInstructionLines({ keys: ["claude"], env })).toEqual([]);
	await offerInstructionLine({
		keys: ["codex"],
		env,
		confirm: async () => true,
	});
	expect(text(codex)).toBe(`one\n  ${INSTRUCTION_LINE}\ntwo\n`);
	expect(updateInstructionLines({ keys: ["claude", "codex"], env })).toEqual([
		claude,
	]);
	expect(text(claude)).toBe(`one\n  ${INSTRUCTION_LINE}\ntwo\n`);
	expect(updateInstructionLines({ keys: ["claude"], env })).toEqual([]);
	fs.writeFileSync(claude, `one\n${earlier}\n`);
	expect(removeInstructionLine(claude)).toBe(true);
	expect(text(claude)).toBe("one\n");
});
