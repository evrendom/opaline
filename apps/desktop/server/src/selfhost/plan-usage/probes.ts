import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	claudeReadings,
	codexReadings,
	type PlanProvider,
	type PlanReading,
} from "./readings.js";

type Environment = Readonly<Record<string, string | undefined>>;

const PROBE_TIMEOUT_MS = 25_000;

export type ProbeOutcome =
	| {
			readonly provider: PlanProvider;
			readonly readings: PlanReading[];
			readonly response: unknown;
	  }
	| {
			readonly provider: PlanProvider;
			readonly error: string;
			readonly response?: unknown;
	  };

export type PlanProbe = () => Promise<ProbeOutcome>;

export function findBinary(name: string, env: Environment): string | null {
	const home = env.HOME?.trim() || homedir();
	const directories = [
		...(env.PATH ?? "").split(delimiter).filter(Boolean),
		join(home, ".local", "bin"),
		join(home, ".claude", "local"),
		join(home, ".bun", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
	];
	for (const directory of directories) {
		const candidate = join(directory, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return null;
}

interface Question {
	readonly command: string;
	readonly args: readonly string[];
	readonly lines: readonly unknown[];
	readonly answer: (message: Record<string, unknown>) => unknown;
	readonly env: Environment;
	readonly timeoutMs?: number;
}

export function askProcess(question: Question): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = spawn(question.command, [...question.args], {
			cwd: tmpdir(),
			env: { ...question.env } as NodeJS.ProcessEnv,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let pending = "";
		let errors = "";
		let settled = false;
		const finish = (outcome: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill("SIGTERM");
			outcome();
		};
		const timer = setTimeout(
			() => finish(() => reject(new Error("no answer in time"))),
			question.timeoutMs ?? PROBE_TIMEOUT_MS,
		);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			pending += chunk;
			let newline = pending.indexOf("\n");
			while (newline >= 0) {
				const line = pending.slice(0, newline).trim();
				pending = pending.slice(newline + 1);
				newline = pending.indexOf("\n");
				if (!line.startsWith("{")) continue;
				let message: unknown;
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				const found = question.answer(message as Record<string, unknown>);
				if (found !== undefined) finish(() => resolve(found));
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			errors = (errors + chunk).slice(-400);
		});
		child.on("error", (error) => finish(() => reject(error)));
		child.on("exit", (code) =>
			finish(() =>
				reject(
					new Error(
						errors.trim().split("\n").at(-1) || `exited with code ${code}`,
					),
				),
			),
		);
		child.stdin.on("error", () => {});
		for (const line of question.lines)
			child.stdin.write(`${JSON.stringify(line)}\n`);
	});
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function claudeProbe(env: Environment = process.env): PlanProbe {
	return async () => {
		const command = findBinary("claude", env);
		if (!command)
			return { provider: "claude", error: "Claude Code is not installed" };
		try {
			const response = await askProcess({
				command,
				args: [
					"-p",
					"--no-session-persistence",
					"--strict-mcp-config",
					"--setting-sources",
					"",
					"--disable-slash-commands",
					"--input-format",
					"stream-json",
					"--output-format",
					"stream-json",
					"--verbose",
				],
				lines: [
					{
						type: "control_request",
						request_id: "plan-usage",
						request: { subtype: "get_usage" },
					},
				],
				answer: (reply) => {
					if (reply.type !== "control_response") return undefined;
					const body = reply.response as Record<string, unknown> | undefined;
					if (body?.request_id !== "plan-usage") return undefined;
					return body.subtype === "success"
						? (body.response ?? null)
						: { failed: body.error ?? "refused" };
				},
				env,
			});
			const readings = claudeReadings(response);
			return readings
				? { provider: "claude", readings, response }
				: {
						provider: "claude",
						error: "This Claude Code login has no plan limits to report",
						response,
					};
		} catch (error) {
			return { provider: "claude", error: message(error) };
		}
	};
}

export function codexProbe(env: Environment = process.env): PlanProbe {
	return async () => {
		const command = findBinary("codex", env);
		if (!command) return { provider: "codex", error: "Codex is not installed" };
		try {
			const response = await askProcess({
				command,
				args: ["app-server"],
				lines: [
					{
						jsonrpc: "2.0",
						id: 1,
						method: "initialize",
						params: {
							clientInfo: {
								name: "opaline",
								title: "Opaline",
								version: "1.0.0",
							},
						},
					},
					{ jsonrpc: "2.0", method: "initialized" },
					{ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read" },
				],
				answer: (reply) => {
					if (reply.id !== 2) return undefined;
					return reply.result ?? { failed: reply.error ?? "refused" };
				},
				env,
			});
			const readings = codexReadings(response);
			return readings
				? { provider: "codex", readings, response }
				: {
						provider: "codex",
						error: "This Codex login has no plan limits to report",
						response,
					};
		} catch (error) {
			return { provider: "codex", error: message(error) };
		}
	};
}
