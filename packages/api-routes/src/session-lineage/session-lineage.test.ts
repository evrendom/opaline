import { describe, expect, test } from "bun:test";
import {
	extractChildLineageEvidence,
	extractNativeCodexLineageEvidence,
} from "./child-provenance.js";
import { correlateSessionLineage } from "./correlate.js";
import { extractLaunchAnchors } from "./launch-evidence.js";
import { classifyShellLaunch } from "./shell-launch.js";
import type {
	ChildLineageEvidence,
	LaunchAnchor,
	RawLineageSession,
} from "./types.js";

const ORGANIZATION_ID = "org";
const USER_ID = "user";
const WORKDIR = "/repo";

describe("native Codex lineage extraction", () => {
	test("accepts matching explicit spawn metadata", () => {
		const content = [
			codexLine("2026-09-18T09:25:51.697Z", "session_meta", {
				cwd: WORKDIR,
				id: "child",
				originator: "codex_sdk_ts",
				parent_thread_id: "parent",
				session_id: "parent",
				source: {
					subagent: {
						thread_spawn: {
							agent_nickname: "Hegel",
							agent_path: "/root/review",
							depth: 1,
							parent_thread_id: "parent",
						},
					},
				},
				thread_source: "subagent",
			}),
			codexLine("2026-09-18T09:25:52.000Z", "turn_context", {
				model: "gpt-5.6-sol",
			}),
		].join("\n");

		expect(
			extractNativeCodexLineageEvidence(
				createRawSession({ content, sessionId: "child", source: "codex" }),
			),
		).toEqual({
			agentNickname: "Hegel",
			agentPath: "/root/review",
			childSessionId: "child",
			depth: 1,
			model: "gpt-5.6-sol",
			parentSessionId: "parent",
			sessionDate: "2026-08-22T05:41:37.000Z",
			startTs: "2026-09-18T09:25:51.697Z",
			workdir: WORKDIR,
		});
	});

	test("rejects mismatched identities, cycles, and non-subagent sessions", () => {
		const create = (metadata: Record<string, unknown>, sessionId = "child") =>
			extractNativeCodexLineageEvidence(
				createRawSession({
					content: codexLine("2026-09-18T09:25:51.697Z", "session_meta", {
						id: "child",
						parent_thread_id: "parent",
						session_id: "parent",
						source: {
							subagent: {
								thread_spawn: { parent_thread_id: "parent" },
							},
						},
						thread_source: "subagent",
						...metadata,
					}),
					sessionId,
					source: "codex",
				}),
			);

		expect(create({}, "different-upload-id")).toBeUndefined();
		expect(create({ parent_thread_id: "other" })).toBeUndefined();
		expect(create({ session_id: "root-of-nested-tree" })).toMatchObject({
			parentSessionId: "parent",
		});
		expect(
			create({
				parent_thread_id: "child",
				session_id: "child",
				source: {
					subagent: { thread_spawn: { parent_thread_id: "child" } },
				},
			}),
		).toBeUndefined();
		expect(create({ thread_source: "cli" })).toBeUndefined();
	});
});

describe("shell-carried launch classification", () => {
	test("rejects probes and resumes", () => {
		expect(classifyShellLaunch("which codex && codex --version")).toEqual({
			disposition: "probe",
			targetProvider: "openai",
		});
		expect(classifyShellLaunch("codex exec --help")).toEqual({
			disposition: "probe",
			targetProvider: "openai",
		});
		expect(classifyShellLaunch("codex exec resume --last")).toEqual({
			disposition: "resume",
			targetProvider: "openai",
		});
		expect(classifyShellLaunch("claude --resume child-id -p task")).toEqual({
			disposition: "resume",
			targetProvider: "claude",
		});
	});

	test("extracts models and shell-unquoted prompts", () => {
		expect(
			classifyShellLaunch(
				"codex exec -m gpt-5.5 --sandbox read-only 'Review parent'\\''s change'",
			),
		).toEqual({
			disposition: "launch",
			model: "gpt-5.5",
			prompt: "Review parent's change",
			targetProvider: "openai",
		});
		expect(
			classifyShellLaunch(
				"claude -p --model claude-fable-5 --effort high 'Make a plan'",
			),
		).toEqual({
			disposition: "launch",
			model: "claude-fable-5",
			prompt: "Make a plan",
			targetProvider: "claude",
		});
		expect(
			classifyShellLaunch(
				"env -u CODEX_API_KEY codex exec -m gpt-5.5 'Run task' > run.log 2>&1",
			),
		).toEqual({
			disposition: "launch",
			model: "gpt-5.5",
			prompt: "Run task",
			targetProvider: "openai",
		});
	});
});

describe("launch evidence extraction", () => {
	test("extracts nested Codex operations with an operation ordinal", () => {
		const content = [
			codexLine("2026-08-22T05:41:37.000Z", "session_meta", {
				cwd: WORKDIR,
				id: "parent",
				originator: "codex_cli_rs",
			}),
			codexLine("2026-08-22T05:41:38.000Z", "response_item", {
				call_id: "carrier",
				input: `
const prompt = "Make parent's plan";
const quoted = \`'\${prompt.replaceAll("'", "'\\\\''")}'\`;
await tools.exec_command({ cmd: "pwd", workdir: "${WORKDIR}" });
await tools.exec_command({ cmd: \`claude -p --model claude-fable-5 \${quoted}\`, workdir: "${WORKDIR}" });`,
				name: "exec",
				type: "custom_tool_call",
			}),
		].join("\n");
		const anchors = extractLaunchAnchors(
			createRawSession({ content, sessionId: "parent", source: "codex" }),
		);

		expect(anchors).toHaveLength(1);
		expect(anchors[0]).toMatchObject({
			operationOrdinal: 1,
			prompt: "Make parent's plan",
			targetModel: "claude-fable-5",
			targetProvider: "claude",
			toolUseId: "carrier",
			workdir: WORKDIR,
		});
	});

	test("extracts a Claude Bash launch and its echoed child id", () => {
		const childId = "01a0245f-854b-78d2-b98a-8bbaafcbc35f";
		const content = [
			JSON.stringify({
				cwd: WORKDIR,
				message: {
					content: [
						{
							id: "bash-1",
							input: {
								command: "codex exec -m gpt-5.5 'Do the work'",
							},
							name: "Bash",
							type: "tool_use",
						},
					],
				},
				timestamp: "2026-08-21T12:50:34.345Z",
				type: "assistant",
			}),
			JSON.stringify({
				message: {
					content: [
						{
							content: `session id: ${childId}`,
							tool_use_id: "bash-1",
							type: "tool_result",
						},
					],
				},
				type: "user",
			}),
		].join("\n");

		expect(
			extractLaunchAnchors(
				createRawSession({
					content,
					sessionId: "claude-parent",
					source: "claude_code",
				}),
			),
		).toMatchObject([
			{
				echoedSessionIds: [childId],
				prompt: "Do the work",
				targetModel: "gpt-5.5",
				toolUseId: "bash-1",
			},
		]);
	});
});

describe("child provenance", () => {
	test("excludes native Codex children and distinguishes failed shell children", () => {
		const failed = extractChildLineageEvidence(
			createRawSession({
				content: [
					codexLine("2026-08-21T12:48:51.903Z", "session_meta", {
						cwd: WORKDIR,
						id: "failed-child",
						originator: "codex_exec",
						thread_source: "user",
					}),
					codexLine("2026-08-21T12:48:55.047Z", "turn_context", {
						model: "gpt-5.6",
					}),
				].join("\n"),
				sessionId: "failed-child",
				source: "codex",
			}),
		);

		expect(failed).toMatchObject({
			assistantMessageCount: 0,
			model: "gpt-5.6",
			outcome: "failed",
		});

		const native = extractChildLineageEvidence(
			createRawSession({
				content: codexLine("2026-08-21T12:48:51.903Z", "session_meta", {
					id: "native-child",
					originator: "codex_exec",
					thread_source: "subagent",
				}),
				sessionId: "native-child",
				source: "codex",
			}),
		);
		expect(native).toBeUndefined();
	});

	test("accepts the verified sdk-cli Claude child shape", () => {
		const content = [
			JSON.stringify({
				cwd: WORKDIR,
				entrypoint: "sdk-cli",
				message: { content: "Make a plan", role: "user" },
				parentUuid: null,
				sessionId: "fable-child",
				timestamp: "2026-08-22T05:41:39.211Z",
				type: "user",
			}),
			JSON.stringify({
				message: {
					content: [{ text: "Plan", type: "text" }],
					model: "claude-fable-5",
					role: "assistant",
				},
				sessionId: "fable-child",
				type: "assistant",
			}),
		].join("\n");

		expect(
			extractChildLineageEvidence(
				createRawSession({
					content,
					sessionId: "fable-child",
					source: "claude_code",
				}),
			),
		).toMatchObject({
			assistantMessageCount: 1,
			entrypoint: "sdk-cli",
			model: "claude-fable-5",
			outcome: "successful",
			rootPrompt: "Make a plan",
		});
	});
});

describe("lineage correlation", () => {
	test("keeps the first-uploaded child in incremental and rebuild orderings", () => {
		const anchor = createAnchor({ prompt: "same" });
		const childA = createChild({
			childFirstIngestedAt: "2026-08-22T05:41:40.000Z",
			childSessionId: "child-a",
			childStartTs: "2026-08-22T05:41:39.000Z",
			model: "claude-fable-5",
			rootPrompt: "same",
		});
		const childB = createChild({
			childFirstIngestedAt: "2026-08-22T05:42:00.000Z",
			childSessionId: "child-b",
			childStartTs: "2026-08-22T05:41:38.000Z",
			model: "claude-sonnet-4-5",
			rootPrompt: "same",
		});

		const incremental = correlateSessionLineage([anchor], [childA]);
		const rebuilt = correlateSessionLineage([anchor], [childB, childA]);

		expect(incremental.edges[0]?.child.childSessionId).toBe("child-a");
		expect(rebuilt.edges[0]?.child.childSessionId).toBe("child-a");
		expect(rebuilt.edges[0]?.child.model).toBe("claude-fable-5");
	});

	test("lets failed children consume retry anchors", () => {
		const firstAnchor = createAnchor({
			anchorTs: "2026-08-22T05:41:37.000Z",
			operationOrdinal: 0,
			prompt: "same",
		});
		const secondAnchor = createAnchor({
			anchorTs: "2026-08-22T05:42:37.000Z",
			operationOrdinal: 1,
			prompt: "same",
		});
		const failed = createChild({
			childFirstIngestedAt: "2026-08-22T05:41:38.000Z",
			childSessionId: "failed",
			outcome: "failed",
			rootPrompt: "same",
		});
		const successful = createChild({
			childFirstIngestedAt: "2026-08-22T05:42:38.000Z",
			childSessionId: "successful",
			rootPrompt: "same",
		});

		const result = correlateSessionLineage(
			[firstAnchor, secondAnchor],
			[successful, failed],
		);

		expect(result.edges).toMatchObject([
			{ child: { childSessionId: "failed" }, countable: false },
			{ child: { childSessionId: "successful" }, countable: true },
		]);
		expect(result.edges[0]?.anchor.operationOrdinal).toBe(0);
		expect(result.edges[1]?.anchor.operationOrdinal).toBe(1);
	});

	test("does not resolve one prompt-matched child across different parents", () => {
		const child = createChild({ childSessionId: "shared", rootPrompt: "same" });
		const result = correlateSessionLineage(
			[
				createAnchor({ parentSessionId: "parent-a", prompt: "same" }),
				createAnchor({ parentSessionId: "parent-b", prompt: "same" }),
			],
			[child],
		);

		expect(result.edges).toHaveLength(0);
		expect(result.unmatchedChildIds).toEqual(["claude_code:shared"]);
	});

	test("never counts a temporal-only Claude candidate", () => {
		const result = correlateSessionLineage(
			[createAnchor({ prompt: "one" })],
			[createChild({ rootPrompt: "two" })],
		);

		expect(result.edges).toHaveLength(0);
	});
});

function createRawSession(
	overrides: Partial<RawLineageSession> &
		Pick<RawLineageSession, "content" | "sessionId" | "source">,
): RawLineageSession {
	return {
		content: overrides.content,
		firstIngestedAt: overrides.firstIngestedAt ?? "2026-08-22T05:41:40.000Z",
		latestIngestedAt: overrides.latestIngestedAt ?? "2026-08-22T05:41:40.000Z",
		organizationId: overrides.organizationId ?? ORGANIZATION_ID,
		projectPath: overrides.projectPath ?? WORKDIR,
		sessionDate: overrides.sessionDate ?? "2026-08-22T05:41:37.000Z",
		sessionId: overrides.sessionId,
		source: overrides.source,
		userId: overrides.userId ?? USER_ID,
	};
}

function createAnchor(overrides: Partial<LaunchAnchor>): LaunchAnchor {
	return {
		anchorTs: overrides.anchorTs ?? "2026-08-22T05:41:37.000Z",
		command: overrides.command ?? "claude -p 'same'",
		echoedSessionIds: overrides.echoedSessionIds ?? [],
		operationOrdinal: overrides.operationOrdinal ?? 0,
		organizationId: overrides.organizationId ?? ORGANIZATION_ID,
		parentIngestedAt: overrides.parentIngestedAt ?? "2026-08-22T05:41:38.000Z",
		parentSessionDate:
			overrides.parentSessionDate ?? "2026-08-22T05:41:37.000Z",
		parentSessionId: overrides.parentSessionId ?? "parent",
		parentSource: overrides.parentSource ?? "codex",
		prompt: overrides.prompt ?? "same",
		targetModel: overrides.targetModel ?? "claude-fable-5",
		targetProvider: overrides.targetProvider ?? "claude",
		toolUseId: overrides.toolUseId ?? "carrier",
		userId: overrides.userId ?? USER_ID,
		workdir: overrides.workdir ?? WORKDIR,
	};
}

function createChild(
	overrides: Partial<ChildLineageEvidence>,
): ChildLineageEvidence {
	return {
		assistantMessageCount: overrides.assistantMessageCount ?? 1,
		childFirstIngestedAt:
			overrides.childFirstIngestedAt ?? "2026-08-22T05:41:40.000Z",
		childLatestIngestedAt:
			overrides.childLatestIngestedAt ?? "2026-08-22T05:41:40.000Z",
		childSessionDate: overrides.childSessionDate ?? "2026-08-22T05:41:39.000Z",
		childSessionId: overrides.childSessionId ?? "child",
		childSource: overrides.childSource ?? "claude_code",
		childStartTs: overrides.childStartTs ?? "2026-08-22T05:41:39.000Z",
		entrypoint: overrides.entrypoint ?? "sdk-cli",
		model: overrides.model ?? "claude-fable-5",
		organizationId: overrides.organizationId ?? ORGANIZATION_ID,
		originator: overrides.originator,
		outcome: overrides.outcome ?? "successful",
		provider: overrides.provider ?? "claude",
		rootPrompt: overrides.rootPrompt ?? "same",
		threadSource: overrides.threadSource,
		userId: overrides.userId ?? USER_ID,
		workdir: overrides.workdir ?? WORKDIR,
	};
}

function codexLine(
	timestamp: string,
	type: string,
	payload: Readonly<Record<string, unknown>>,
): string {
	return JSON.stringify({ payload, timestamp, type });
}
