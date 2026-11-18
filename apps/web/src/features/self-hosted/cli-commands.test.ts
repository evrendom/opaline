import { describe, expect, it } from "vitest";
import { getCliSetupCommands } from "@/components/analytics/cli-setup-commands";
import {
	CLI_API_KEY_PLACEHOLDER,
	claudeMcpAddCommand,
	cliConnectCommand,
	cliInstallAndLoginCommand,
	cliLoginCommand,
	codexMcpConfig,
	cursorMcpConfig,
	serverArguments,
} from "./cli-commands";
import { teammateSetupSteps } from "./teammate-setup";

describe("CLI commands on opaline.so", () => {
	it("stay exactly as they were", () => {
		expect(
			cliConnectCommand(
				"npx opaline@latest",
				"ABCD-1234",
				"https://opaline.so",
			),
		).toBe("npx opaline@latest --code ABCD-1234");
		expect(cliLoginCommand("https://opaline.so")).toBe(
			"npx opaline@latest login",
		);
		expect(getCliSetupCommands("https://opaline.so")[0].command).toBe(
			"npm install -g opaline@latest && opaline login --api-base https://opaline.so",
		);
	});
});

describe("CLI commands for any other server", () => {
	it("name the server on localhost", () => {
		expect(
			cliConnectCommand(
				"npx opaline@latest",
				"ABCD-1234",
				"http://localhost:4011",
			),
		).toBe(
			"npx opaline@latest --code ABCD-1234 --server http://localhost:4011",
		);
		expect(cliLoginCommand("http://127.0.0.1:4790")).toBe(
			"npx opaline@latest login --server http://127.0.0.1:4790",
		);
	});

	it("name a self-hosted https server", () => {
		expect(cliLoginCommand("https://opaline.acme.lan/")).toBe(
			"npx opaline@latest login --server https://opaline.acme.lan",
		);
		expect(cliInstallAndLoginCommand("https://opaline.acme.lan")).toBe(
			"npm install -g opaline@latest && opaline login --server https://opaline.acme.lan",
		);
	});

	it("opt in to plaintext http only for a server on the network, which the CLI refuses otherwise", () => {
		expect(serverArguments("http://192.168.2.74:4100")).toEqual([
			"--server",
			"http://192.168.2.74:4100",
			"--allow-insecure-api-base",
		]);
		expect(serverArguments("http://localhost:4100")).toEqual([
			"--server",
			"http://localhost:4100",
		]);
		expect(serverArguments("https://opaline.acme.lan")).toEqual([
			"--server",
			"https://opaline.acme.lan",
		]);
	});

	it("give teammates sign-in, upload and MCP steps for this server", () => {
		expect(
			teammateSetupSteps("http://localhost:4790").map((step) => step.command),
		).toEqual([
			"npx opaline@latest login --server http://localhost:4790",
			"npx opaline@latest upload",
			"opaline mcp install",
		]);
	});
});

describe("manual MCP setup", () => {
	const origin = "http://localhost:4790";

	it("registers Claude Code over HTTP with a placeholder key", () => {
		expect(claudeMcpAddCommand(origin)).toBe(
			`claude mcp add --scope user --transport http opaline http://localhost:4790/api/mcp --header "Authorization: Bearer ${CLI_API_KEY_PLACEHOLDER}"`,
		);
	});

	it("writes the Codex and Cursor entries the CLI writes, never with a real key", () => {
		expect(codexMcpConfig(origin)).toBe(
			[
				"[mcp_servers.opaline]",
				'url = "http://localhost:4790/api/mcp"',
				"",
				"[mcp_servers.opaline.http_headers]",
				`Authorization = "Bearer ${CLI_API_KEY_PLACEHOLDER}"`,
			].join("\n"),
		);
		expect(JSON.parse(cursorMcpConfig(origin))).toEqual({
			mcpServers: {
				opaline: {
					url: "http://localhost:4790/api/mcp",
					headers: { Authorization: `Bearer ${CLI_API_KEY_PLACEHOLDER}` },
				},
			},
		});
	});
});
