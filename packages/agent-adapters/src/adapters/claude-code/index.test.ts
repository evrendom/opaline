import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "./index.js";

const line = (record: unknown) => `${JSON.stringify(record)}\n`;
const turn = (type: "user" | "assistant", text: string) =>
	line({
		type,
		timestamp: "2026-11-01T10:00:00.000Z",
		message: { role: type, content: text },
	});

test("uploads referenced, unreferenced and nested subagent transcripts of the session only", async () => {
	const projectDir = await mkdtemp(join(tmpdir(), "opaline-claude-subagents-"));
	const sessionId = "session-with-subagents";
	const subagentsDir = join(projectDir, sessionId, "subagents");
	await mkdir(subagentsDir, { recursive: true });
	const transcriptPath = join(projectDir, `${sessionId}.jsonl`);
	await writeFile(
		transcriptPath,
		turn("user", "run the review") +
			line({
				type: "user",
				timestamp: "2026-11-01T10:01:00.000Z",
				toolUseResult: { agentId: "referenced" },
			}) +
			turn("assistant", "done"),
	);
	await writeFile(
		join(subagentsDir, "agent-referenced.jsonl"),
		turn("assistant", "launching a helper") +
			line({ toolUseResult: { agentId: "nested" } }),
	);
	await writeFile(
		join(subagentsDir, "agent-nested.jsonl"),
		turn("assistant", "nested work"),
	);
	await writeFile(
		join(subagentsDir, "agent-from-skill.jsonl"),
		turn("assistant", "a skill launched me"),
	);
	await writeFile(
		join(subagentsDir, "agent-from-skill.meta.json"),
		JSON.stringify({ agentType: "general-purpose" }),
	);
	await writeFile(
		join(projectDir, "agent-other-session.jsonl"),
		turn("assistant", "another session's legacy subagent"),
	);

	const request = await claudeCodeAdapter.buildUploadRequest(
		{ sessionId, transcriptPath, projectPath: "/repo" },
		{ gitInfo: {}, uploadMode: "manual" },
	);

	expect(request.subagents?.map((subagent) => subagent.agentId)).toEqual([
		"referenced",
		"from-skill",
		"nested",
	]);
	expect(
		request.subagents?.find((subagent) => subagent.agentId === "from-skill")
			?.content,
	).toBe(turn("assistant", "a skill launched me"));
	await rm(projectDir, { recursive: true });
});
