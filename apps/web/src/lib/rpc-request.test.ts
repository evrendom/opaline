import { expect, it } from "vitest";
import { workspaceRequestHeaders } from "./rpc-request";

it("names the URL's workspace on every request, and nothing outside a workspace", () => {
	expect(workspaceRequestHeaders("/acme/sessions/abc")).toEqual({
		"x-opaline-workspace": "acme",
	});
	expect(workspaceRequestHeaders("/acme")).toEqual({
		"x-opaline-workspace": "acme",
	});
	for (const path of ["/", "/welcome", "/login", "/session/abc", "/admin"])
		expect(workspaceRequestHeaders(path)).toEqual({});
});
