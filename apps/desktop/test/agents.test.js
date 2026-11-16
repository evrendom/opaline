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

const { writeMarketplace } = require("../agents");

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
