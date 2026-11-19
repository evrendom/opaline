import { expect, test } from "bun:test";
import {
	isFamilyMemberRow,
	sessionRowKey,
	transcriptSubagentId,
	withTranscriptSubagent,
} from "./session-row-key";

const parent = { source: "claude_code" as const, session_id: "p" };
const agent = {
	...parent,
	subagent_of: {
		agent_id: "a1",
		kind: "agent" as const,
		session_id: "p",
		source: "claude_code" as const,
	},
};
const child = {
	source: "codex" as const,
	session_id: "c",
	subagent_of: {
		agent_id: null,
		kind: "child" as const,
		session_id: "p",
		source: "codex" as const,
	},
};
const linked = {
	...child,
	subagent_of: { ...child.subagent_of, kind: "linked" as const },
};

test("a subagent inside a transcript gets its own row key", () => {
	expect(sessionRowKey(parent)).toBe("claude_code:p");
	expect(sessionRowKey(agent)).toBe("claude_code:p:a1");
	expect(sessionRowKey(child)).toBe("codex:c");
	expect(transcriptSubagentId(agent)).toBe("a1");
	expect(transcriptSubagentId(child)).toBeNull();
});

test("a subagent inside a transcript opens its parent on that subagent", () => {
	expect(withTranscriptSubagent("/w/sessions/p", agent)).toBe(
		"/w/sessions/p?sessionTab=detail&agent=a1&subagent=a1",
	);
	expect(withTranscriptSubagent("/w/sessions/p?from=x", agent)).toBe(
		"/w/sessions/p?from=x&sessionTab=detail&agent=a1&subagent=a1",
	);
	expect(withTranscriptSubagent("/w/sessions/c", child)).toBe("/w/sessions/c");
	expect(withTranscriptSubagent(undefined, agent)).toBeUndefined();
});

test("only rows already inside a parent's family cost are family members", () => {
	expect(isFamilyMemberRow(agent)).toBe(true);
	expect(isFamilyMemberRow(child)).toBe(true);
	expect(isFamilyMemberRow(linked)).toBe(false);
	expect(isFamilyMemberRow({ subagent_of: undefined })).toBe(false);
});
