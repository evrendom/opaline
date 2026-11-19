import { expect, test } from "bun:test";
import { createGitHubAuthorization, createGitHubSweepSource } from "./index.js";

test("sweep HTTP source keeps every event, paginates, and strips forbidden payload fields", async () => {
	const requests: URL[] = [];
	const sha = "a".repeat(40);
	const server: ReturnType<typeof Bun.serve> = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request): Response {
			const url = new URL(request.url);
			requests.push(url);
			expect(request.headers.get("authorization")).toBe("Bearer fixture");
			if (url.pathname.endsWith("/actions/runs"))
				return Response.json(
					{
						total_count: 2,
						workflow_runs: [
							{
								id: 1,
								head_sha: sha,
								event: "workflow_dispatch",
								status: "completed",
								conclusion: "failure",
								created_at: "2026-09-30T00:00:00Z",
								updated_at: "2026-09-30T01:00:00Z",
								head_commit: {
									message: "private",
									author: { email: "private@example.test" },
								},
							},
						],
					},
					{
						headers: {
							link: `<${server.url}repos/o/r/actions/runs?page=2>; rel="next"`,
						},
					},
				);
			if (url.pathname.endsWith("/statuses"))
				return Response.json([
					{
						id: 2,
						state: "pending",
						context: "external",
						created_at: "2026-09-30T00:00:00Z",
						updated_at: "2026-09-30T00:00:00Z",
						description: "waiting",
					},
					{
						id: 3,
						state: "failure",
						context: "external",
						created_at: "2026-09-30T01:00:00Z",
						updated_at: "2026-09-30T01:00:00Z",
					},
				]);
			if (url.pathname.endsWith("/pulls")) return Response.json([]);
			return Response.json({ message: "denied" }, { status: 404 });
		},
	});
	const source = createGitHubSweepSource({
		baseUrl: server.url.origin,
		authorization: createGitHubAuthorization("fixture"),
	});
	try {
		const runs = await source.runs(
			"/repos/o/r",
			"2026-09-01T00:00:00Z",
			"2026-10-01T00:00:00Z",
			1,
		);
		expect(runs.hasNext).toBe(true);
		expect(runs.data.workflow_runs[0]?.event).toBe("workflow_dispatch");
		expect(JSON.stringify(runs.data)).not.toContain("private");
		expect(requests[0]?.searchParams.has("event")).toBe(false);
		const statuses = await source.statuses("/repos/o/r", sha, 1);
		expect(statuses.data.statuses).toHaveLength(2);
		await source.pulls("/repos/o/r", 2);
		expect(requests.at(-1)?.searchParams.get("state")).toBe("all");
		expect(requests.at(-1)?.searchParams.get("sort")).toBe("updated");
		expect(requests.at(-1)?.searchParams.get("page")).toBe("2");
		await expect(source.attempt("/repos/o/r", "1", 1)).rejects.toMatchObject({
			status: 404,
		});
	} finally {
		await server.stop(true);
	}
});
