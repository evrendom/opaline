import { describe, expect, test } from "bun:test";
import { liveSessionDetailRevision } from "@rudel/api-routes";
import { explainCommandQuery } from "./reader/detail/step/explain-command-query";
import { sessionRunAnswersQuery } from "./use-run-question-tags";
import { sessionFileChangesQuery } from "./use-session-file-changes";
import { sessionRunCiQuery } from "./use-session-run-ci";

describe("a session's file changes", () => {
	test("keyed by workspace, session and revision", () => {
		const query = sessionFileChangesQuery("org-1", "s-1", "rev-9");
		expect(query.queryKey[0]).toBe("org");
		expect(query.queryKey[1]).toBe("org-1");
		expect(query.queryKey.at(-1)).toBe("rev-9");
		expect(JSON.stringify(query.queryKey)).toContain('"s-1"');
		expect(query.staleTime).toBe(5 * 60 * 1000);
		expect(query.retry).toBe(false);
	});

	test("a running session's, under one key, kept half a minute", () => {
		const live = liveSessionDetailRevision({
			lastActivityAt: "2026-10-29T10:00:00.000Z",
		});
		const query = sessionFileChangesQuery("org-1", "s-1", live);
		expect(query.queryKey.at(-1)).toBe("live");
		expect(query.staleTime).toBe(30 * 1000);
	});
});

describe("a command explained", () => {
	test("one key per command, kept for good", () => {
		const query = explainCommandQuery("git status");
		expect([...query.queryKey]).toEqual(["explain-command", "git status"]);
		expect(query.staleTime).toBe(Number.POSITIVE_INFINITY);
		expect(query.gcTime).toBe(5 * 60_000);
	});
});

describe("what the reader waits on before laying a turn out", () => {
	test("its run answers and its CI: the workspace's, of the session", () => {
		for (const [key, name] of [
			[sessionRunAnswersQuery("org-1", "s-1").queryKey, "runAnswers"],
			[sessionRunCiQuery("org-1", "s-1").queryKey, "runCi"],
		] as const) {
			expect(key.slice(0, 2)).toEqual(["org", "org-1"]);
			expect(JSON.stringify(key)).toContain(`"${name}"`);
			expect(JSON.stringify(key)).toContain('"s-1"');
		}
		expect(sessionRunCiQuery("org-1", "s-1").queryKey).not.toEqual(
			sessionRunCiQuery("org-1", "s-2").queryKey,
		);
	});
});
