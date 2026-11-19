import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	sessionDetailWindowQueryKey,
	sessionDetailWindowQueryPrefix,
} from "./session-detail-fast-query";

describe("initial session message cache", () => {
	test("keeps opening messages isolated across revisions and removable by the window cache", () => {
		const client = new QueryClient();
		const request = {
			sessionId: "sample-session",
			mode: "initial",
			includeBodies: true,
		} as const;
		const oldKey = sessionDetailWindowQueryKey(request, "off", "revision-1");
		const newKey = sessionDetailWindowQueryKey(request, "off", "revision-2");
		client.setQueryData(oldKey, { body: "old messages" });
		expect(client.getQueryData<{ body: string }>(newKey)).toBeUndefined();
		client.setQueryData(newKey, { body: "new messages" });
		client.removeQueries({
			exact: true,
			queryKey: sessionDetailWindowQueryKey(request, "off", "revision-1"),
		});
		expect(client.getQueryData<{ body: string }>(oldKey)).toBeUndefined();
		expect(client.getQueryData<{ body: string }>(newKey)).toEqual({
			body: "new messages",
		});
		client.removeQueries({
			queryKey: sessionDetailWindowQueryPrefix(request.sessionId),
		});
		expect(client.getQueryData<{ body: string }>(newKey)).toBeUndefined();
		client.clear();
	});
});
