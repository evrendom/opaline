import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PG_CONNECTION_STRING ??= "postgres://unused@127.0.0.1:1/unused";
const { buildLocalSessionInput } = await import("./session-input.js");
const { chooseWorkspace, geminiCliProjectRoot } = await import(
	"./gemini-session.js"
);

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

async function home(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "opaline-gemini-"));
	directories.push(directory);
	return directory;
}

const SESSION = "8d1f6a6e-5b0c-4e45-9a0e-1f3f0c7e2b11";

function jsonl(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

test("a Gemini CLI session imports as a gemini session with its folder and subagents", async () => {
	const root = await home();
	const project = join(root, "repo");
	const chats = join(root, ".gemini", "tmp", "repo", "chats");
	await mkdir(join(chats, SESSION), { recursive: true });
	await mkdir(project, { recursive: true });
	await writeFile(
		join(root, ".gemini", "tmp", "repo", ".project_root"),
		project,
	);
	const sessionPath = join(chats, "session-2026-11-20T10-00-8d1f6a6e.jsonl");
	await writeFile(
		sessionPath,
		jsonl([
			{
				sessionId: SESSION,
				projectHash: "h",
				startTime: "2026-11-20T10:00:00.000Z",
				lastUpdated: "2026-11-20T10:00:00.000Z",
				kind: "main",
			},
			{
				id: "u1",
				timestamp: "2026-11-20T10:00:01.000Z",
				type: "user",
				content: [{ text: "Find the callers" }],
			},
			{
				id: "g1",
				timestamp: "2026-11-20T10:00:04.000Z",
				type: "gemini",
				content: "",
				model: "gemini-4-neon",
				tokens: {
					input: 9000,
					output: 100,
					cached: 6000,
					thoughts: 40,
					tool: 0,
					total: 9140,
				},
				toolCalls: [
					{
						id: "call_1",
						name: "invoke_agent",
						args: {
							agent_name: "codebase_investigator",
							prompt: "Find callers",
						},
						result: [
							{
								functionResponse: {
									id: "call_1",
									name: "invoke_agent",
									response: { output: "3 callers" },
								},
							},
						],
						status: "success",
						agentId: "sub-1",
						timestamp: "2026-11-20T10:00:20.000Z",
					},
				],
			},
		]),
	);
	await writeFile(
		join(chats, SESSION, "sub-1.jsonl"),
		jsonl([
			{
				sessionId: "sub-1",
				projectHash: "h",
				startTime: "2026-11-20T10:00:05.000Z",
				lastUpdated: "2026-11-20T10:00:05.000Z",
				kind: "subagent",
			},
			{
				id: "s1",
				timestamp: "2026-11-20T10:00:05.000Z",
				type: "user",
				content: "Find callers",
			},
			{
				id: "s2",
				timestamp: "2026-11-20T10:00:15.000Z",
				type: "gemini",
				content: "3 callers",
				model: "gemini-4-hydrogen",
				tokens: {
					input: 2000,
					output: 50,
					cached: 0,
					thoughts: 0,
					tool: 0,
					total: 2050,
				},
			},
		]),
	);

	const prepared = await buildLocalSessionInput({
		sessionPath,
		source: "gemini",
		change: null,
		organizationId: "org",
		now: Date.now(),
	});

	expect(prepared.kind).toBe("ready");
	if (prepared.kind !== "ready") return;
	expect(prepared.input.source).toBe("gemini");
	expect(prepared.input.sessionId).toBe(SESSION);
	expect(prepared.input.projectPath).toBe(project);
	expect(prepared.input.content).toContain('"model":"gemini-4-neon"');
	expect(prepared.input.subagents?.map((subagent) => subagent.agentId)).toEqual(
		["sub-1"],
	);
	expect(prepared.input.subagents?.[0]?.content).toContain(
		'"isSidechain":true',
	);
	expect(prepared.files.map((file) => file.path)).toEqual([
		sessionPath,
		join(chats, SESSION, "sub-1.jsonl"),
	]);
});

test("a session with only startup records is skipped", async () => {
	const root = await home();
	const chats = join(root, ".gemini", "tmp", "repo", "chats");
	await mkdir(chats, { recursive: true });
	const sessionPath = join(chats, "session-2026-11-20T10-00-8d1f6a6e.jsonl");
	await writeFile(
		sessionPath,
		jsonl([
			{
				sessionId: SESSION,
				projectHash: "h",
				startTime: "2026-11-20T10:00:00.000Z",
				lastUpdated: "2026-11-20T10:00:00.000Z",
			},
		]),
	);
	const prepared = await buildLocalSessionInput({
		sessionPath,
		source: "gemini",
		change: null,
		organizationId: "org",
		now: Date.now(),
	});
	expect(prepared.kind).toBe("skipped");
});

test("an Antigravity conversation imports from its full transcript", async () => {
	const root = await home();
	const logs = join(
		root,
		".gemini",
		"antigravity-cli",
		"brain",
		"conv-1",
		".system_generated",
		"logs",
	);
	await mkdir(logs, { recursive: true });
	const steps = [
		{
			step_index: 0,
			type: "USER_INPUT",
			status: "DONE",
			content: "Run the tests",
			created_at: "2026-11-21T09:00:00Z",
		},
		{
			step_index: 1,
			type: "PLANNER_RESPONSE",
			status: "DONE",
			created_at: "2026-11-21T09:00:02Z",
			model: "gemini-4-neon",
			tool_calls: [
				{
					name: "run_command",
					args: { CommandLine: '"bun test"', Cwd: `"${root}"` },
				},
			],
		},
		{
			step_index: 2,
			type: "GENERIC",
			status: "DONE",
			output: "12 pass",
			created_at: "2026-11-21T09:00:09Z",
		},
	];
	await writeFile(
		join(logs, "transcript.jsonl"),
		jsonl(steps.map((step) => ({ ...step, output: undefined }))),
	);
	await writeFile(join(logs, "transcript_full.jsonl"), jsonl(steps));
	const prepared = await buildLocalSessionInput({
		sessionPath: join(logs, "transcript.jsonl"),
		source: "gemini",
		change: null,
		organizationId: "org",
		now: Date.now(),
	});
	expect(prepared.kind).toBe("ready");
	if (prepared.kind !== "ready") return;
	expect(prepared.input.sessionId).toBe("conv-1");
	expect(prepared.input.projectPath).toBe(root);
	expect(prepared.input.content).toContain("12 pass");
	expect(prepared.input.content).toContain('"name":"Bash"');
});

test("a Gemini CLI project folder resolves from projects.json when it has no .project_root", async () => {
	const root = await home();
	await mkdir(join(root, ".gemini", "tmp", "opaline"), { recursive: true });
	await writeFile(
		join(root, ".gemini", "projects.json"),
		JSON.stringify({ projects: { "/Users/me/opaline": "opaline" } }),
	);
	expect(
		await geminiCliProjectRoot(join(root, ".gemini", "tmp", "opaline")),
	).toBe("/Users/me/opaline");
	// Older versions named the folder by the path's SHA-256.
	const hashed = new Bun.CryptoHasher("sha256")
		.update("/Users/me/opaline")
		.digest("hex");
	await mkdir(join(root, ".gemini", "tmp", hashed), { recursive: true });
	expect(await geminiCliProjectRoot(join(root, ".gemini", "tmp", hashed))).toBe(
		"/Users/me/opaline",
	);
});

test("Antigravity run by T3 Code: its folder, title and subagents come from its conversation database", async () => {
	const root = await home();
	const repo = join(root, "portfolio");
	await mkdir(join(repo, ".git"), { recursive: true });
	const appData = join(
		root,
		".t3",
		"userdata",
		"providers",
		"antigravity",
		"ab12",
		"antigravity-acp",
	);
	const logsOf = async (id: string) => {
		const logs = join(appData, "brain", id, ".system_generated", "logs");
		await mkdir(logs, { recursive: true });
		return logs;
	};
	const parentLogs = await logsOf("parent-1");
	const parentSteps = [
		{
			step_index: 0,
			source: "USER_EXPLICIT",
			type: "USER_INPUT",
			status: "DONE",
			created_at: "2026-11-21T17:00:00Z",
			content: "<USER_REQUEST>\nRefine the cards\n</USER_REQUEST>",
		},
		{
			step_index: 1,
			source: "MODEL",
			type: "PLANNER_RESPONSE",
			status: "DONE",
			created_at: "2026-11-21T17:00:05Z",
			model: "gemini-4-neon-xhigh",
			input_tokens: 2000,
			cache_read_tokens: 30000,
			output_tokens: 400,
			tool_calls: [
				{
					name: "invoke_subagent",
					args: { Prompt: "Audit", Role: "Auditor", TypeName: "self" },
				},
			],
		},
		{
			step_index: 2,
			source: "MODEL",
			type: "GENERIC",
			status: "DONE",
			created_at: "2026-11-21T17:00:07Z",
			content:
				'Created the following subagent:\n{\n  "conversationId": "child-1"\n}',
		},
	];
	await writeFile(join(parentLogs, "transcript.jsonl"), jsonl(parentSteps));
	await writeFile(
		join(parentLogs, "transcript_full.jsonl"),
		jsonl(parentSteps),
	);
	const childLogs = await logsOf("child-1");
	await writeFile(
		join(childLogs, "transcript_full.jsonl"),
		jsonl([
			{
				step_index: 0,
				source: "USER_EXPLICIT",
				type: "USER_INPUT",
				status: "DONE",
				created_at: "2026-11-21T17:00:07Z",
				content: "Audit",
			},
			{
				step_index: 1,
				source: "MODEL",
				type: "PLANNER_RESPONSE",
				status: "DONE",
				created_at: "2026-11-21T17:01:00Z",
				model: "gemini-4-neon-high",
				input_tokens: 900,
				cache_read_tokens: 0,
				output_tokens: 120,
				content: "Done.",
			},
		]),
	);
	await writeFile(join(childLogs, "transcript.jsonl"), "");
	const database = new Database(join(appData, "conversation_summaries.db"));
	database.run(
		"CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT '', workspace_uris text NOT NULL, parent_conversation_id text NOT NULL DEFAULT '')",
	);
	const insert = database.prepare(
		"INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)",
	);
	insert.run(
		"parent-1",
		"Refining Cognitive Bias Cards",
		JSON.stringify([`file://${repo}`]),
		"",
	);
	insert.run("child-1", "", JSON.stringify([`file://${repo}`]), "parent-1");
	database.close();

	const parent = await buildLocalSessionInput({
		sessionPath: join(parentLogs, "transcript.jsonl"),
		source: "gemini",
		change: null,
		organizationId: "org",
		now: Date.now(),
	});
	expect(parent.kind).toBe("ready");
	if (parent.kind !== "ready") return;
	expect(parent.input.sessionId).toBe("parent-1");
	expect(parent.input.projectPath).toBe(repo);
	expect(parent.input.content).toContain(
		'"summary":"Refining Cognitive Bias Cards"',
	);
	expect(parent.input.content).toContain('"content":"Refine the cards"');
	expect(parent.input.subagents?.map((subagent) => subagent.agentId)).toEqual([
		"child-1",
	]);
	expect(parent.input.subagents?.[0]?.content).toContain('"output_tokens":120');

	const child = await buildLocalSessionInput({
		sessionPath: join(childLogs, "transcript.jsonl"),
		source: "gemini",
		change: null,
		organizationId: "org",
		now: Date.now(),
	});
	expect(child).toMatchObject({
		kind: "skipped",
		reason: "a Gemini subagent, imported with its parent",
	});
});

test("a conversation that worked outside its workspace folders is placed in the repository it touched", () => {
	const raw = jsonl([
		{
			type: "PLANNER_RESPONSE",
			tool_calls: [
				{ name: "read_file", args: { Path: "/w/wt/apps/a.ts" } },
				{ name: "edit_file", args: { Path: "/w/wt/apps/b.ts" } },
			],
		},
	]);
	expect(
		chooseWorkspace(["/w/main"], raw, (path) =>
			path.startsWith("/w/wt/") ? "/w/wt" : null,
		),
	).toBe("/w/wt");
	expect(
		chooseWorkspace(["/w/a", "/w/main"], `${raw}"/w/main/x"`, () => null),
	).toBe("/w/main");
});
