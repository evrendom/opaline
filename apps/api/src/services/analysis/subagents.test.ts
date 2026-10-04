import { expect, test } from "bun:test";
import {
	createSessionFamilies,
	descendantSessions,
	familyPosition,
} from "./lineage.js";
import {
	type ChildTask,
	type DelegationCall,
	linkSubagents,
	redactEncrypted,
} from "./subagents.js";

function call(
	record: number,
	atMs: number,
	tool: string,
	args: Record<string, string>,
	spawned = "",
	failed = false,
): DelegationCall {
	return {
		agentId: "",
		turn: 1,
		record,
		tool,
		atMs,
		args: JSON.stringify(args),
		spawned,
		failed,
	};
}

function task(
	atMs: number,
	text: string,
	delegation = true,
	turn = 1,
): ChildTask {
	return { turn, record: atMs, atMs, delegation, text };
}

test("spawns link to their threads by thread id, then by task path, regardless of order", () => {
	const links = linkSubagents(
		[
			call(3, 1_000, "spawn_agent", { message: "Review it" }, "child-old"),
			call(5, 2_000, "spawn_agent", { task_name: "tests" }, "/root/tests"),
			call(7, 3_000, "spawn_agent", { task_name: "review" }, "/root/review"),
		],
		[
			{
				sessionId: "child-review",
				tasks: [
					task(
						3_001,
						"Message Type: NEW_TASK\nTask name: /root/review\nPayload:",
					),
				],
			},
			{
				sessionId: "child-tests",
				tasks: [task(2_001, "Message Type: NEW_TASK\nTask name: /root/tests")],
			},
			{ sessionId: "child-old", tasks: [task(1_001, "Review it", false)] },
		],
	);
	expect(
		links.map((link) => [link.call.record, link.childSessionId, link.basis]),
	).toEqual([
		[3, "child-old", "thread id"],
		[5, "child-tests", "task name"],
		[7, "child-review", "task name"],
	]);
	expect(links[0]?.task?.text).toBe("Review it");
});

test("without a named thread, each child takes the latest earlier spawn; failed spawns and later spawns never match", () => {
	const links = linkSubagents(
		[
			call(2, 1_000, "spawn_agent", { message: "gAAAAA" }),
			call(4, 2_000, "spawn_agent", { message: "bad flag" }, "", true),
			call(6, 60_000, "spawn_agent", { message: "too late" }),
		],
		[
			{ sessionId: "early", tasks: [task(1_500, "Do the first thing")] },
			{ sessionId: "late", tasks: [task(3_000, "Do the second thing")] },
		],
	);
	expect(
		links.map((link) => [link.call.record, link.childSessionId, link.basis]),
	).toEqual([[2, "early", "time"]]);
});

test("follow-ups reach a thread by its task name and carry the task the thread recorded after them", () => {
	const links = linkSubagents(
		[
			call(3, 1_000, "spawn_agent", { task_name: "review" }, "/root/review"),
			call(9, 9_000, "followup_task", {
				target: "review",
				message: "gAAAAABqvTy3NRqfc6NxPuNOxz_RCS",
			}),
			call(11, 9_500, "send_message", { target: "unknown" }),
		],
		[
			{
				sessionId: "child",
				tasks: [
					task(1_001, "Task name: /root/review\nfirst"),
					task(9_001, "Task name: /root/review\nsecond", true, 2),
				],
			},
		],
	);
	expect(
		links.map((link) => [
			link.call.record,
			link.call.tool,
			link.childSessionId,
			link.task?.turn,
		]),
	).toEqual([
		[3, "spawn_agent", "child", 1],
		[9, "followup_task", "child", 2],
	]);
});

test("families resolve parents, roots and descendants per owner, and stop at cycles", () => {
	const families = createSessionFamilies([
		{ userId: "a", childSessionId: "c1", parentSessionId: "p" },
		{ userId: "a", childSessionId: "c2", parentSessionId: "p" },
		{ userId: "a", childSessionId: "g", parentSessionId: "c1" },
		{ userId: "b", childSessionId: "other", parentSessionId: "p" },
		{ userId: "a", childSessionId: "x", parentSessionId: "y" },
		{ userId: "a", childSessionId: "y", parentSessionId: "x" },
	]);
	expect(familyPosition(families, "a", "g")).toEqual({
		parentSessionId: "c1",
		rootSessionId: "p",
		depth: 2,
	});
	expect(familyPosition(families, "a", "p")).toEqual({
		parentSessionId: null,
		rootSessionId: "p",
		depth: 0,
	});
	expect(descendantSessions(families, "a", ["p"])).toEqual(["c1", "c2", "g"]);
	expect(descendantSessions(families, "b", ["p"])).toEqual(["other"]);
	expect(familyPosition(families, "a", "x").depth).toBe(1);
	expect(descendantSessions(families, "a", ["x"])).toEqual(["y"]);
});

test("encrypted delegation payloads are replaced, plain text is kept", () => {
	expect(
		redactEncrypted(
			'{"task_name":"review","message":"gAAAAABqvTvktoKr0mG1POcRDUOwiBy9eSTBRZSdTnb2AGan62Xewc=="}',
		),
	).toBe('{"task_name":"review","message":"[encrypted]"}');
	expect(redactEncrypted('{"message":"Review src/a.ts"}')).toBe(
		'{"message":"Review src/a.ts"}',
	);
});
