import type { TranscriptSource } from "@rudel/api-routes/transcript-records";

export interface GitTranscriptFixture {
	source: TranscriptSource;
	content: string;
	subagents: Record<string, string>;
	timestamp: string;
}

export function claudeGitFixture(
	timestamp = new Date().toISOString(),
): GitTranscriptFixture {
	const pair = (
		callId: string,
		command: string,
		output: string,
		isError = false,
		toolName = "Bash",
	) => [
		JSON.stringify({
			type: "assistant",
			timestamp,
			cwd: "/work/opaline",
			gitBranch: "feat/observations",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: callId,
						name: toolName,
						input:
							toolName === "Bash"
								? { command }
								: {
										owner: "opalinehq",
										repo: "athena",
										title: "Observations",
										head: "feat/observations",
										base: "main",
									},
					},
				],
			},
		}),
		JSON.stringify({
			type: "user",
			timestamp,
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: callId,
						content: output,
						is_error: isError,
					},
				],
			},
		}),
	];
	return {
		source: "claude_code",
		timestamp,
		content: [
			JSON.stringify({
				type: "user",
				timestamp,
				message: {
					role: "user",
					content: "Ship git observations and open a PR",
				},
			}),
			...pair(
				"compound",
				"bun test && git commit -m 'feat: record observations'",
				"42 tests pass\n[feat/observations abc1234] feat: record observations\n 2 files changed, 18 insertions(+)",
			),
			...pair(
				"truncated",
				"git commit -m 'fix: preserve raw fallback'",
				`${"hook checked file\n".repeat(5_000)}[feat/observations def5678] fix: preserve raw fallback\n 1 file changed`,
			),
			...pair(
				"push",
				"git push origin feat/observations",
				"To github.com:opalinehq/athena.git\n   a1b2c3d..d4e5f6a  feat/observations -> feat/observations",
			),
			...pair(
				"gh-pr",
				"gh pr create --title 'Observations' --body-file /tmp/body.md",
				"https://github.com/opalinehq/athena/pull/133\n",
			),
			...pair(
				"mcp-pr",
				"",
				JSON.stringify({
					url: "https://api.github.com/repos/opalinehq/athena/pulls/134",
					html_url: "https://github.com/opalinehq/athena/pull/134",
					number: 134,
				}),
				false,
				"mcp__github__create_pull_request",
			),
			...pair(
				"failed",
				"git commit -m 'should not count'",
				"[feat/observations bad1234] should not count\nError: pre-commit hook failed",
				true,
			),
		].join("\n"),
		subagents: {
			"child-1": [
				JSON.stringify({
					type: "user",
					timestamp,
					isSidechain: true,
					agentId: "child-1",
					message: { role: "user", content: "Commit the regression tests" },
				}),
				...pair(
					"compound",
					"git commit -m 'test: regression coverage'",
					"[feat/tests cafe123] test: regression coverage\n 1 file changed",
				),
			].join("\n"),
		},
	};
}

export function codexGitFixture(
	timestamp = new Date().toISOString(),
): GitTranscriptFixture {
	const pair = (callId: string, command: string, output: string) => [
		JSON.stringify({
			type: "response_item",
			timestamp,
			payload: {
				type: "function_call",
				name: "exec_command",
				call_id: callId,
				arguments: JSON.stringify({ cmd: command }),
			},
		}),
		JSON.stringify({
			type: "response_item",
			timestamp,
			payload: {
				type: "function_call_output",
				call_id: callId,
				output: `Chunk ID: 71cc\nWall time: 0.020 seconds\nProcess exited with code 0\nFinal output:\n${output}`,
			},
		}),
	];
	return {
		source: "codex",
		timestamp,
		subagents: {},
		content: [
			JSON.stringify({
				type: "session_meta",
				timestamp,
				payload: {
					id: "codex-native-session",
					cwd: "/work/opaline",
					originator: "codex_cli_rs",
					git: {
						branch: "feat/codex",
						commit_hash: "a".repeat(40),
						repository_url:
							"https://user:password@github.com/opalinehq/athena.git",
					},
				},
			}),
			...pair(
				"codex-commit",
				"bun test && git -C /work/opaline commit -m 'feat: codex coverage'",
				"[feat/codex 123abcd] feat: codex coverage\n 1 file changed",
			),
			...pair(
				"codex-pr",
				"gh pr create --fill",
				"https://github.com/opalinehq/athena/pull/135",
			),
		].join("\n"),
	};
}

export function codexGitContinuationFixture(
	timestamp = new Date().toISOString(),
): GitTranscriptFixture {
	const call = (callId: string, name: string, args: object) =>
		JSON.stringify({
			type: "response_item",
			timestamp,
			payload: {
				type: "function_call",
				name,
				call_id: callId,
				arguments: JSON.stringify(args),
			},
		});
	const result = (callId: string, status: string, output = "") =>
		JSON.stringify({
			type: "response_item",
			timestamp,
			payload: {
				type: "function_call_output",
				call_id: callId,
				output: `Chunk ID: 71cc\nWall time: 0.020 seconds\n${status}\nFinal output:\n${output}`,
			},
		});
	const running = "Process running with session ID 42";
	const completed = "Process exited with code 0";
	return {
		source: "codex",
		timestamp,
		content: [
			call("commit", "exec_command", { cmd: "git commit -m 'fix: polling'" }),
			result("commit", running),
			call("poll", "write_stdin", { session_id: 42, chars: "" }),
			result("poll", running),
			call("done", "functions.write_stdin", { session_id: 42 }),
			result("done", completed, "[main abc1234] fix: polling"),
			call("push", "exec_command", { cmd: "git push origin main" }),
			result("push", running),
			call("push-done", "write_stdin", { session_id: 42 }),
			result("push-done", completed, "a1b2c3d..d4e5f6a main -> main"),
			call("failed", "exec_command", { cmd: "git commit -m 'failed'" }),
			result("failed", running),
			call("failed-done", "write_stdin", { session_id: 42 }),
			result(
				"failed-done",
				"Process exited with code 1",
				"[main bad1234] failed",
			),
			call("orphan", "write_stdin", { session_id: 99 }),
			result("orphan", completed, "[main bad5678] unrelated"),
		].join("\n"),
		subagents: {
			"child-1": [
				call("commit", "exec_command", { cmd: "git commit -m 'fix: child'" }),
				result("commit", running),
				call("done", "write_stdin", { session_id: 42 }),
				result("done", completed, "[child cafe123] fix: child"),
			].join("\n"),
			"child-2": [
				call("done", "write_stdin", { session_id: 42 }),
				result("done", completed, "[child bad9999] cross-agent"),
			].join("\n"),
		},
	};
}
